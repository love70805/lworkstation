import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { db, saveProductCatalogRecord, getProductEditorSnapshot, getSelectionReferenceSnapshot, createWorkspaceBackupPayload, restoreWorkspaceBackupPayload, createOrGetMonthlyLedger, saveErpCostRequest } from "./database";
import { saveErpCatalogRequest, receiveErpCatalogInboxEnvelope } from "./repositories/erpCatalogRepository";
import { buildErpCatalogRequest, buildErpCatalogInboxEnvelope, ERP_CATALOG_GROUPS } from "../domain/erpCatalogRequest";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";
import { buildErpCostRequest } from "../domain/erpCosts";
import { buildErpCostBatchEnvelope } from "../domain/erpCostBatchEnvelope";
import { buildErpCostInboxEnvelope } from "../domain/erpInboxContract";

beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { db.close(); await db.delete(); });

it("projects a verified durable cost receipt while formal adoption is blocked, without widening original scope", async () => {
  const { product } = await saveProductCatalogRecord({ draft: { name: "人工档案", platformSkc: "SKC-A", variants: [{ platformSku: "SOLD-A" }] } });
  const ledger = await createOrGetMonthlyLedger({ period: "2026-08" });
  const expectedSkus = [{ platformSku: "SOLD-A", platformSkc: "SKC-A" }];
  const request = buildErpCostRequest({ id: "COST-REQ", workspaceId: product.workspaceId, ledgerId: ledger.id, ledgerPeriod: ledger.period, platformSkcs: ["SKC-A"], expectedSkus, requestedBy: "local-user", requestedAt: "2026-09-01T00:00:00.000Z" });
  await saveErpCostRequest(request);
  const mappings = [{ ...expectedSkus[0], productName: "ERP 档案", attribute: "红色" }, { platformSku: "UNSOLD-A", platformSkc: "SKC-A", productName: "ERP 档案", attribute: "蓝色" }];
  const batch = buildErpCostBatchEnvelope({ batchId: "COST-RAW", workspaceId: product.workspaceId, ledgerId: ledger.id, requestId: request.id, platformSkcs: ["SKC-A"], expectedSkus,
    results: [{ warehouseSku: "WH-A", mappings, previewUnitCost: 3 }],
    warehouseEvidence: [{ warehouseSku: "WH-A", evidenceComplete: false, purchaseRecords: [{ recordId: "PUR-A", purchaseDate: "2026-08-10", quantity: 1, unitPrice: 3 }] }],
  });
  const envelope = buildErpCostInboxEnvelope({ batch, deliveryId: "COST-DELIVERY" });
  await db.erpCostInbox.add({ id: "INBOX-RAW", workspaceId: product.workspaceId, ledgerId: ledger.id, requestId: request.id, batchId: batch.batchId, deliveryId: envelope.deliveryId, status: "pending", receivedAt: envelope.sentAt, adoption: { status: "blocked" }, envelope });
  const editor = await getProductEditorSnapshot({ productId: product.id });
  expect(editor.draft.name).toBe("人工档案");
  expect(editor.draft.variants.map(item => item.platformSku)).toEqual(["SOLD-A", "UNSOLD-A"]);
  expect(buildSelectionReferenceRows(await getSelectionReferenceSnapshot()).every(row => row.referenceUnitCost == null)).toBe(true);
  expect(await db.erpCostRows.count()).toBe(0);
  expect(await db.erpCostBatches.count()).toBe(0);
  expect(await db.profitLines.count()).toBe(0);
  await db.erpCostRequests.update(request.id, { platformSkcs: ["FOREIGN-SKC"] });
  expect((await getSelectionReferenceSnapshot()).erpCatalogRows).toHaveLength(0);
});

async function fixture() {
  const { product } = await saveProductCatalogRecord({ draft: { name: "人工主体", platformSkc: "SKC-A", productStatus: "off_sale", imageUrl: "", store: "合成店", variants: [{ platformSku: "SOLD-A", attribute: "人工属性" }] } });
  const request = buildErpCatalogRequest({ id: "CAT-REQ", workspaceId: product.workspaceId, ledgerPeriod: "2026-08", platformSkcs: ["SKC-A"], confirmedSkus: [{ platformSku: "SOLD-A", platformSkc: "SKC-A" }], sourceProductIds: [product.id], idempotencyKey: "catalog-fixture" });
  await saveErpCatalogRequest(request);
  const rows = ["SOLD-A", "UNSOLD-A"].map(platformSku => ({ platformSku, platformSkc: "SKC-A", warehouseSku: "WH", productName: "1个蓝色收腰神器-HHX sh680", attribute: "平台属性", imageUrl: "", storeName: "合成店", unitConversion: { warehouseUnits: 2, platformUnits: 1, source: "erp_platform_mapping", sourceRef: `map:${platformSku}` }, catalogMappings: [{ platformSku, platformSkc: "SKC-A", warehouseSku: "WH" }] }));
  const envelope = buildErpCatalogInboxEnvelope({ deliveryId: "CAT-DELIVERY", sentAt: "2026-09-29T00:00:00.000Z", catalog: { workspaceId: product.workspaceId, ledgerId: null, ledgerPeriod: "2026-08", requestId: request.id, batchId: "CAT-BATCH", generatedAt: "2026-09-29T00:00:00.000Z", query: { unit: "platform_skc", platformSkcs: ["SKC-A"] }, rows,
    coverage: Object.fromEntries(ERP_CATALOG_GROUPS.map(group => [group, { state: group === "images" ? "unavailable" : "complete", reasons: group === "images" ? ["image_not_provided"] : [] }])),
    warehouseEvidence: [{ warehouseSku: "WH", evidenceComplete: true, evidenceRef: "warehouse:WH", purchaseRecords: [{ recordId: "P1", warehouseSku: "WH", quantity: 4, unitPrice: 0.000001, purchaseDate: "2026-08-28", supplierName: "关联供应商", supplier1688Url: "https://detail.1688.com/offer/12345678901.html" }] }] } }, { request });
  return { product, request, envelope };
}

describe("independent trusted catalog lifecycle", () => {
  it("supersedes only a matching catalog request while keeping previous evidence immutable", async () => {
    const { request, envelope } = await fixture();
    await receiveErpCatalogInboxEnvelope({ envelope });
    const previous = (await db.settings.toArray()).find(item => item.kind === "erp_catalog_result");
    const replacement = buildErpCatalogRequest({ ...request, id: "RETRY-CAT", supersedesRequestId: request.id, missingGroups: ["images"], idempotencyKey: "retry-missing-images" });
    await saveErpCatalogRequest(replacement);
    expect((await db.settings.toArray()).find(item => item.kind === "erp_catalog_request" && item.request.id === request.id).status).toBe("superseded");
    expect((await db.settings.toArray()).find(item => item.kind === "erp_catalog_result")).toEqual(previous);
    await expect(receiveErpCatalogInboxEnvelope({ envelope })).rejects.toThrow("替代");
    await expect(saveErpCatalogRequest(buildErpCatalogRequest({ ...replacement, id: "BAD-RETRY", ledgerPeriod: "2026-09" }))).rejects.toThrow("同月份");
  });
  it("receives unsold SKU evidence without sales, adoption, or finalization; preserves user fields", async () => {
    const { product, envelope } = await fixture();
    const results = await Promise.all([receiveErpCatalogInboxEnvelope({ envelope }), receiveErpCatalogInboxEnvelope({ envelope })]);
    expect(results.filter(result => result.idempotent)).toHaveLength(1);
    db.close(); await db.open();
    const snapshot = await getSelectionReferenceSnapshot();
    const rows = buildSelectionReferenceRows(snapshot);
    expect(rows.find(row => row.platformSku === "UNSOLD-A")).toMatchObject({ referenceUnitCost: 0.000002, referenceKind: "erp_catalog_reference", latestQuantity: 0 });
    const editor = await getProductEditorSnapshot({ productId: product.id });
    expect(editor.draft).toMatchObject({ name: "人工主体", productStatus: "off_sale" });
    expect(editor.draft.variants).toHaveLength(2);
    expect(editor.draft.variants[0].attribute).toBe("人工属性");
    await saveProductCatalogRecord({ productId: product.id, draft: editor.draft });
    for (const table of [db.salesRows, db.erpCostRows, db.erpCostBatches, db.erpCostInbox, db.profitLines, db.costApprovals, db.supplierOffers]) expect(await table.count()).toBe(0);
    const backup = await createWorkspaceBackupPayload();
    await db.delete(); await db.open(); await restoreWorkspaceBackupPayload(backup);
    expect((await getProductEditorSnapshot({ productId: product.id })).draft.variants).toHaveLength(2);
    expect(buildSelectionReferenceRows(await getSelectionReferenceSnapshot()).find(row => row.platformSku === "UNSOLD-A").referenceUnitCost).toBe(0.000002);
  });

  it("requires persisted local identity and rejects a broadened request or a mutated retry", async () => {
    const { request, envelope } = await fixture();
    const foreign = buildErpCatalogRequest({ ...request, id: "UNKNOWN", platformSkcs: ["SKC-OTHER"], confirmedSkus: [{ platformSku: "OTHER", platformSkc: "SKC-OTHER" }] });
    await expect(saveErpCatalogRequest(foreign)).rejects.toThrow("缺少本机");
    await expect(receiveErpCatalogInboxEnvelope({ envelope: { ...envelope, catalog: { ...envelope.catalog, requestId: "UNKNOWN" } } })).rejects.toThrow("匹配");
    await receiveErpCatalogInboxEnvelope({ envelope });
    const mutated = structuredClone(envelope); mutated.catalog.warehouseEvidence[0].purchaseRecords[0].unitPrice = 99;
    await expect(receiveErpCatalogInboxEnvelope({ envelope: mutated })).rejects.toThrow("不同证据");
    const broad = structuredClone(envelope); broad.catalog.query.platformSkcs.push("SKC-OTHER");
    await expect(receiveErpCatalogInboxEnvelope({ envelope: broad })).rejects.toThrow("扩大");
    const stored = (await db.settings.toArray()).find(item => item.kind === "erp_catalog_request");
    await db.settings.delete(stored.key);
    expect((await getSelectionReferenceSnapshot()).erpCatalogRows).toEqual([]);
  });
});
