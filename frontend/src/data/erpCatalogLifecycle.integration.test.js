import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db, saveProductCatalogRecord, getProductEditorSnapshot, getSelectionReferenceSnapshot, createWorkspaceBackupPayload, restoreWorkspaceBackupPayload, createOrGetMonthlyLedger, saveErpCostRequest } from "./database";
import { saveErpCatalogRequest, receiveErpCatalogInboxEnvelope, registerCostCatalogCompanion } from "./repositories/erpCatalogRepository";
import { buildErpCatalogRequest, buildErpCatalogInboxEnvelope, ERP_CATALOG_GROUPS } from "../domain/erpCatalogRequest";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";
import { buildErpCostRequest } from "../domain/erpCosts";
import { buildErpCostBatchEnvelope } from "../domain/erpCostBatchEnvelope";
import { buildErpCostInboxEnvelope } from "../domain/erpInboxContract";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

function extensionCatalogRows(records) {
  const source = resolve(process.cwd(), "../integrations/erp-assistant-extension/src");
  const policySandbox = { window: {}, URL };
  vm.runInNewContext(readFileSync(resolve(source, "result-policy.js"), "utf8"), policySandbox);
  const policy = policySandbox.window.ShopeersErpResultPolicy;
  const chrome = { runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } }, alarms: { onAlarm: { addListener() {} } } };
  const backgroundSandbox = { __SHOPEERS_ERP_BACKGROUND_TEST__: true, chrome, URL, AbortController, crypto: { randomUUID: () => "TEST" }, setTimeout, clearTimeout };
  vm.runInNewContext(readFileSync(resolve(source, "background.js"), "utf8"), backgroundSandbox);
  const results = records.map(({ product, mappings }) => {
    const result = policy.catalogProduct(product);
    result.catalogMappings = policy.normalizeCatalogMappings(mappings, result.warehouseSku);
    result.mappings = policy.normalizeMappings(result.catalogMappings);
    return result;
  });
  return JSON.parse(JSON.stringify(backgroundSandbox.__SHOPEERS_ERP_BACKGROUND_TEST_API__.buildCatalogRows(results, ["SKC-PRODUCTION"])));
}

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
  const rows = ["SOLD-A", "UNSOLD-A"].map(platformSku => ({ platformSku, platformSkc: "SKC-A", warehouseSku: "WH", productName: "1个蓝色收腰神器-HHX sh680", attribute: "平台属性", imageUrl: "", storeName: "合成店", purchaseCatalog: { purchaseProportion1688: "1-2" }, catalogMappings: [{ platformSku, platformSkc: "SKC-A", warehouseSku: "WH" }] }));
  const envelope = buildErpCatalogInboxEnvelope({ deliveryId: "CAT-DELIVERY", sentAt: "2026-09-29T00:00:00.000Z", catalog: { workspaceId: product.workspaceId, ledgerId: null, ledgerPeriod: "2026-08", requestId: request.id, batchId: "CAT-BATCH", generatedAt: "2026-09-29T00:00:00.000Z", query: { unit: "platform_skc", platformSkcs: ["SKC-A"] }, rows,
    coverage: Object.fromEntries(ERP_CATALOG_GROUPS.map(group => [group, { state: group === "images" ? "unavailable" : "complete", reasons: group === "images" ? ["image_not_provided"] : [] }])),
    warehouseEvidence: [{ warehouseSku: "WH", evidenceComplete: true, evidenceRef: "warehouse:WH", purchaseRecords: [{ recordId: "P1", warehouseSku: "WH", quantity: 4, unitPrice: 0.000001, purchaseDate: "2026-08-28", supplierName: "关联供应商", supplier1688Url: "https://detail.1688.com/offer/12345678901.html" }] }] } }, { request });
  return { product, request, envelope };
}

describe("independent trusted catalog lifecycle", () => {
  it("carries production extension catalog output through receipt, save and reopen without inventing a platform unit conversion", async () => {
    const { product } = await saveProductCatalogRecord({ draft: { name: "人工商品", platformSkc: "SKC-PRODUCTION", variants: [{ platformSku: "SKU-SOLD" }] } });
    const request = buildErpCatalogRequest({ id: "PRODUCTION-CAT", workspaceId: product.workspaceId, ledgerPeriod: "2026-08", platformSkcs: ["SKC-PRODUCTION"], confirmedSkus: [{ platformSku: "SKU-SOLD", platformSkc: "SKC-PRODUCTION" }], sourceProductIds: [product.id], idempotencyKey: "production-catalog" });
    await saveErpCatalogRequest(request);
    const rows = extensionCatalogRows(["SKU-SOLD", "SKU-UNSOLD", "SKU-SPLIT"].map((sku, index) => ({ product: { itemId: `WH-${index}`, tradeName: `1个蓝色商品-${index}`, picturesLinking: `https://images.example.invalid/${index}.jpg`, proportionOfGoodsPurchased1688: ["1-1", "1-2", "2-1"][index], supplierData: [{ supplierName: "来源供货方" }] }, mappings: [{ barcodeSkuid: sku, barcodeSkcid: "SKC-PRODUCTION", associatedProductId: `WH-${index}`, barcodeImageLink: `https://images.example.invalid/sku-${index}.jpg`, barcodeAttributeSet: index ? "蓝色" : "红色" }] })));
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.unitConversion === undefined && row.catalogMappings.every(mapping => mapping.unitConversion === undefined))).toBe(true);
    const envelope = buildErpCatalogInboxEnvelope({ deliveryId: "PRODUCTION-DELIVERY", catalog: { workspaceId: product.workspaceId, ledgerId: null, ledgerPeriod: "2026-08", requestId: request.id, batchId: "PRODUCTION-BATCH", generatedAt: "2026-09-30T00:00:00Z", query: { unit: "platform_skc", platformSkcs: ["SKC-PRODUCTION"] }, rows, coverage: Object.fromEntries(ERP_CATALOG_GROUPS.map(group => [group, { state: "complete" }])), warehouseEvidence: rows.map(row => ({ warehouseSku: row.warehouseSku, evidenceComplete: true, purchaseRecords: [0, 1].map(index => ({ recordId: `PUR-${row.platformSku}-${index}`, warehouseSku: row.warehouseSku, quantity: row.platformSku === "SKU-SPLIT" ? 20 : 2, unitPrice: row.platformSku === "SKU-SPLIT" ? 3 : 4, totalPrice: row.platformSku === "SKU-SPLIT" ? 60 : 8, purchaseDate: "2026-08-15", supplierName: "来源供货方", supplier1688Url: index ? "https://detail.1688.com/offer/12345678901.html" : "", purchaseCatalog: { supplierId: "ERP-SUP-1", purchaseProportion1688: row.purchaseCatalog.purchaseProportion1688 } })) })) } }, { request });
    await receiveErpCatalogInboxEnvelope({ envelope });
    const editor = await getProductEditorSnapshot({ productId: product.id });
    expect(editor.draft.variants.map(item => item.platformSku).toSorted()).toEqual(["SKU-SOLD", "SKU-SPLIT", "SKU-UNSOLD"]);
    expect(editor.draft.variants.find(item => item.platformSku === "SKU-UNSOLD")).toMatchObject({ attribute: "蓝色", imageUrl: "https://images.example.invalid/sku-1.jpg" });
    expect(editor.draft.suppliers).toHaveLength(1);
    expect(editor.draft.suppliers[0].sourceLinks).toMatchObject([{ url: "https://detail.1688.com/offer/12345678901.html" }]);
    expect(buildSelectionReferenceRows(await getSelectionReferenceSnapshot()).find(item => item.platformSku === "SKU-UNSOLD")).toMatchObject({ referenceUnitCost: 4, referenceKind: "erp_catalog_reference", latestQuantity: 0 });
    expect(buildSelectionReferenceRows(await getSelectionReferenceSnapshot()).find(item => item.platformSku === "SKU-SPLIT")).toMatchObject({ referenceUnitCost: 3, referenceKind: "erp_catalog_reference", latestQuantity: 0 });
    await saveProductCatalogRecord({ productId: product.id, draft: editor.draft });
    db.close(); await db.open();
    const reopened = await getProductEditorSnapshot({ productId: product.id });
    expect(reopened.draft.variants.map(item => item.platformSku).toSorted()).toEqual(["SKU-SOLD", "SKU-SPLIT", "SKU-UNSOLD"]);
    expect(reopened.draft.suppliers).toHaveLength(1);
    expect(reopened.draft.suppliers[0].sourceLinks).toMatchObject([{ url: "https://detail.1688.com/offer/12345678901.html" }]);
    expect(buildSelectionReferenceRows(await getSelectionReferenceSnapshot()).find(item => item.platformSku === "SKU-UNSOLD").referenceUnitCost).toBe(4);
    expect(buildSelectionReferenceRows(await getSelectionReferenceSnapshot()).find(item => item.platformSku === "SKU-SPLIT").referenceUnitCost).toBe(3);
    expect(await db.salesRows.count()).toBe(0);
    expect(await db.erpCostRows.count()).toBe(0);
  });
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
    expect(rows.find(row => row.platformSku === "UNSOLD-A")).toMatchObject({ referenceUnitCost: 0.000001, referenceKind: "erp_catalog_reference", latestQuantity: 0 });
    const editor = await getProductEditorSnapshot({ productId: product.id });
    expect(editor.draft).toMatchObject({ name: "人工主体", productStatus: "off_sale" });
    expect(editor.draft.variants).toHaveLength(2);
    expect(editor.draft.variants[0].attribute).toBe("人工属性");
    await saveProductCatalogRecord({ productId: product.id, draft: editor.draft });
    for (const table of [db.salesRows, db.erpCostRows, db.erpCostBatches, db.erpCostInbox, db.profitLines, db.costApprovals, db.supplierOffers]) expect(await table.count()).toBe(0);
    const backup = await createWorkspaceBackupPayload();
    await db.delete(); await db.open(); await restoreWorkspaceBackupPayload(backup);
    expect((await getProductEditorSnapshot({ productId: product.id })).draft.variants).toHaveLength(2);
    expect(buildSelectionReferenceRows(await getSelectionReferenceSnapshot()).find(row => row.platformSku === "UNSOLD-A").referenceUnitCost).toBe(0.000001);
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


it("persists the cost catalog companion before registration and reuses it across restart", async () => {
  const transport = await import("../lib/erpInboxTransport");
  const { product } = await saveProductCatalogRecord({ draft: { name: "合成主体", platformSkc: "SKC-C", variants: [{ platformSku: "SKU-C" }] } });
  const ledger = await createOrGetMonthlyLedger({ period: "2026-08" });
  const source = buildErpCostRequest({ id: "COMPANION-SOURCE", workspaceId: product.workspaceId, ledgerId: ledger.id,
    ledgerPeriod: ledger.period, platformSkcs: ["SKC-C"], expectedSkus: [{ platformSku: "SKU-C", platformSkc: "SKC-C" }], requestedBy: "local-user", requestedAt: "2026-09-30T01:00:00.000Z" });
  await saveErpCostRequest(source);
  const spy = vi.spyOn(transport, "registerErpBridgeRequest").mockImplementation(async ({ request }) => {
    const persisted = await db.settings.get(`erp-catalog:request:${source.workspaceId}:${source.id}-CATALOG`);
    expect(persisted.request).toEqual(request);
    return { accepted: true, status: "registered" };
  });
  try {
    await registerCostCatalogCompanion(source);
    db.close(); await db.open();
    await registerCostCatalogCompanion(source);
    expect((await db.settings.toArray()).filter(item => item.kind === "erp_catalog_request")).toHaveLength(1);
    expect((await db.auditEvents.toArray()).filter(item => item.action === "catalog_requested")).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await db.erpCostRows.count()).toBe(0);
    await expect(registerCostCatalogCompanion({ ...source, expectedSkus: [{ platformSku: "FOREIGN", platformSkc: "SKC-C" }] })).rejects.toThrow("缺少本机");
  } finally { spy.mockRestore(); }
});
