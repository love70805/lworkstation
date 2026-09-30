import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { verifyErpCatalogTransport } from "../../../tools/erp-catalog-transport.test.mjs";
import { buildErpCostRequest } from "../domain/erpCosts";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";
import { createOrGetMonthlyLedger, db, getProductEditorSnapshot, getSelectionReferenceSnapshot, receiveErpCostInboxEnvelope, saveErpCostRequest, saveProductCatalogRecord, setActiveMemberContext, voidPublishedErpCostBatch } from "./database";

beforeEach(async () => { await db.delete(); await db.open(); await setActiveMemberContext({ workspaceId: "workspace-default" }); });
afterEach(async () => { db.close(); await db.delete(); });

async function nativeCatalogDelivery() {
  const ledger = await createOrGetMonthlyLedger({ period: "2026-09" });
  const expectedSkus = [{ platformSku: "SKU-RED", platformSkc: "SKC-CATALOG" }];
  const request = buildErpCostRequest({ id: "REQ-NATIVE-CATALOG", workspaceId: ledger.workspaceId, ledgerId: ledger.id, platformSkcs: ["SKC-CATALOG"], expectedSkus, requestedAt: "2026-09-20T10:00:00.000Z", requestedBy: "catalog-test" });
  await saveErpCostRequest(request);
  // The ledger supplies only cost scope, with no product name, image or attribute.
  await db.salesRows.add({ workspaceId: ledger.workspaceId, ledgerId: ledger.id, batchId: "IMPORT-COST-SCOPE", platformSku: "SKU-RED", platformSkc: "SKC-CATALOG", store: "隔离测试店铺", quantity: 1, amount: 30 });
  const { batch, envelope } = await verifyErpCatalogTransport({ workspaceId: ledger.workspaceId, ledgerId: ledger.id, requestId: request.id, expectedSkus, includeConflict: false });
  return { ledger, request, batch, envelope };
}

it("parses verified purchase field shapes through the actual extension, inbox, persistence, reopening and explicit cross-warehouse catalog save", async () => {
  const { ledger, request, batch, envelope } = await nativeCatalogDelivery();
  expect(batch.rows).toHaveLength(2);
  expect(batch.rows.find(row => row.platformSku === "SKU-BLUE").ledgerScopeRole).toBe("auxiliary");
  const receipt = await receiveErpCostInboxEnvelope({ envelope, receivedVia: "isolated-native-field-test" });
  expect(receipt.status, receipt.adoptionError).toBe("applied");
  const formalRows = await db.erpCostRows.toArray();
  expect(formalRows).toHaveLength(1);
  expect(formalRows[0]).toMatchObject({ platformSku: "SKU-RED", unitCost: 5, purchaseCatalog: { purchaseOrderDetailId: "DETAIL-NEW", lineNumber: "0", purchaseProportion1688: "1-2" } });
  const storedBatch = (await db.erpCostBatches.toArray())[0];
  expect(storedBatch.sourceContract.catalogRows.map(row => row.platformSku).sort()).toEqual(["SKU-BLUE", "SKU-RED"]);
  expect(storedBatch.sourceContract.catalogRows.every(row => row.unitCost === undefined && row.quantity === undefined)).toBe(true);
  db.close(); await db.open();
  const editor = await getProductEditorSnapshot({ platformSku: "SKU-BLUE", platformSkc: "SKC-CATALOG" });
  expect(editor.draft).toMatchObject({ name: "ERP 合成商品", imageUrl: "https://images.example.invalid/1688-blue.jpg" });
  expect(editor.draft.variants.map(variant => [variant.platformSku, variant.warehouseSku, variant.imageUrl]).sort()).toEqual([
    ["SKU-BLUE", "WH-BLUE", "https://images.example.invalid/1688-blue.jpg"],
    ["SKU-RED", "WH-CATALOG", "https://images.example.invalid/catalog-red.jpg"],
  ]);
  expect(editor.draft.variants.every(variant => variant.attribute === "" && variant.purchaseUnitPrice === "" && Number(variant.unitsPerPack) === 1)).toBe(true);
  expect(editor.prefill.purchases).toHaveLength(4);
  expect(editor.prefill.sources).toHaveLength(2);
  expect(editor.prefill.sources.every(source => source.imageUrl)).toBe(true);
  const nativeBlue = editor.prefill.purchases.find(item => item.source.recordId === "DETAIL-BLUE");
  expect(nativeBlue).toMatchObject({ platformSkus: ["SKU-BLUE"], purchaseCatalog: { purchaseSpecificationAndModel1688: "采购蓝色规格(仅参考)", purchaseProportion1688: "2-1" } });
  const blueSupplier = editor.draft.suppliers.find(supplier => supplier.sourceUrl.endsWith("222222222222.html"));
  expect(blueSupplier.variants.map(variant => variant.platformSku)).toEqual(["SKU-BLUE"]);
  const financialSnapshot = async () => ({ erpRows: await db.erpCostRows.toArray(), erpBatches: await db.erpCostBatches.toArray(), ledgers: await db.ledgers.toArray(), sales: await db.salesRows.toArray(), profits: await db.profitLines.toArray(), approvals: await db.costApprovals.toArray() });
  // Catalog save can happen even while its source monthly ledger is finalized.
  await db.ledgers.update(ledger.id, { status: "finalized", finalizedAt: "2026-09-28T00:00:00.000Z" });
  const financialBefore = await financialSnapshot();
  const { product } = await saveProductCatalogRecord({ draft: editor.draft });
  expect(await db.platformSkus.count()).toBe(2);
  expect(await db.supplierOffers.count()).toBe(0);
  expect(await financialSnapshot()).toEqual(financialBefore);
  const references = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
  expect(references.find(row => row.platformSku === "SKU-BLUE")).toMatchObject({ productId: product.id, referenceUnitCost: 5, referenceKind: "erp_catalog_reference", latestQuantity: 0 });
  const reopened = await getProductEditorSnapshot({ productId: product.id });
  expect(reopened.prefill.purchases).toHaveLength(4);
  const offersBefore = await db.supplierOffers.toArray();
  await saveProductCatalogRecord({ productId: product.id, draft: reopened.draft });
  expect(await db.supplierOffers.toArray()).toEqual(offersBefore);
  expect(await financialSnapshot()).toEqual(financialBefore);
  // Later ERP drafts still preserve explicit manual product/SKU values.
  reopened.draft.name = "人工商品名";
  reopened.draft.imageUrl = "https://images.example.invalid/manual.jpg";
  reopened.draft.variants.find(variant => variant.platformSku === "SKU-RED").attribute = "人工平台属性";
  await saveProductCatalogRecord({ productId: product.id, draft: reopened.draft });
  const manual = await getProductEditorSnapshot({ productId: product.id });
  expect(manual.draft).toMatchObject({ name: "人工商品名", imageUrl: "https://images.example.invalid/manual.jpg" });
  expect(manual.draft.variants.find(variant => variant.platformSku === "SKU-RED").attribute).toBe("人工平台属性");
  expect(await financialSnapshot()).toEqual(financialBefore);
}, 20000);

it("stops automatic catalog prefill from withdrawn batches while retaining their financial history", async () => {
  const { envelope } = await nativeCatalogDelivery();
  const receipt = await receiveErpCostInboxEnvelope({ envelope, receivedVia: "isolated-withdrawal-test" });
  expect(receipt.status, receipt.adoptionError).toBe("applied");
  expect((await getProductEditorSnapshot({ platformSku: "SKU-BLUE" })).draft.variants).toHaveLength(2);
  const history = await db.erpCostRows.toArray();
  await voidPublishedErpCostBatch({ inboxId: receipt.id, reason: "隔离测试撤回" });
  db.close(); await db.open();
  const snapshot = await getSelectionReferenceSnapshot();
  expect(snapshot.erpCosts).toHaveLength(1);
  expect(snapshot.erpCosts[0].catalogEligible).toBe(false);
  expect(snapshot.erpCatalogRows).toEqual([]);
  expect(buildSelectionReferenceRows(snapshot).some(row => row.platformSku === "SKU-BLUE")).toBe(false);
  for (const platformSku of ["SKU-RED", "SKU-BLUE"]) {
    const editor = await getProductEditorSnapshot({ platformSku });
    expect(editor.draft).toMatchObject({ name: "", imageUrl: "", platformSkc: "" });
    expect(editor.prefill.sources).toEqual([]);
    expect(editor.prefill.purchases).toEqual([]);
  }
  expect(await db.erpCostRows.toArray()).toEqual(history);
  expect(await db.products.count()).toBe(0);
}, 20000);

it("rejects catalog rows with foreign parent scope and validates the stored request before using a published batch", async () => {
  const { ledger, request, envelope } = await nativeCatalogDelivery();
  const receipt = await receiveErpCostInboxEnvelope({ envelope, receivedVia: "isolated-scope-test" });
  expect(receipt.status, receipt.adoptionError).toBe("applied");
  const batch = (await db.erpCostBatches.toArray())[0];
  const originalRows = batch.sourceContract.catalogRows;
  const extras = [
    { platformSku: "WRONG-LEDGER", ledgerId: "foreign-ledger" },
    { platformSku: "WRONG-BATCH", batchId: "foreign-batch" },
    { platformSku: "WRONG-WORKSPACE", workspaceId: "foreign-workspace" },
    { platformSku: "OUTSIDE-REQUEST", platformSkc: "SKC-OUTSIDE", catalogQuerySkcs: ["SKC-OUTSIDE"], catalogMappings: [] },
  ].map(override => ({ ...originalRows[1], ...override }));
  await db.erpCostBatches.put({ ...batch, sourceContract: { ...batch.sourceContract, catalogRows: [...originalRows, ...extras] } });
  const snapshot = await getSelectionReferenceSnapshot();
  expect(snapshot.erpCatalogRows.map(row => row.platformSku).sort()).toEqual(["SKU-BLUE", "SKU-RED"]);
  expect(buildSelectionReferenceRows(snapshot).map(row => row.platformSku).sort()).toEqual(["SKU-BLUE", "SKU-RED"]);
  const recordedRequest = await db.erpCostRequests.get(request.id);
  for (const override of [{ workspaceId: "foreign-workspace" }, { ledgerId: "foreign-ledger" }, { platformSkcs: [{ platformSkc: "SKC-OUTSIDE" }] }]) {
    await db.erpCostRequests.put({ ...recordedRequest, ...override });
    const invalid = await getSelectionReferenceSnapshot();
    expect(invalid.erpCatalogRows).toEqual([]);
    expect(invalid.erpCosts[0].catalogEligible).toBe(false);
    expect((await getProductEditorSnapshot({ platformSku: "SKU-BLUE" })).draft.name).toBe("");
  }
  await db.erpCostRequests.put(recordedRequest);
  const costRow = (await db.erpCostRows.toArray())[0];
  await db.erpCostRows.update(costRow.id, { ledgerId: "foreign-ledger" });
  expect((await getSelectionReferenceSnapshot()).erpCosts[0].catalogEligible).toBe(false);
  expect((await db.ledgers.get(ledger.id)).workspaceId).toBe(ledger.workspaceId);
}, 20000);

it("preserves auxiliary warehouse mapping failures without blocking the healthy expected cost", async () => {
  const { envelope } = await nativeCatalogDelivery();
  const evidence = envelope.batch.warehouseEvidence.find(item => item.warehouseSku === "WH-BLUE");
  evidence.sourceWarnings = ["mapping_failure:isolated_auxiliary_warehouse"];
  evidence.evidenceComplete = false;
  const receipt = await receiveErpCostInboxEnvelope({ envelope, receivedVia: "isolated-mapping-warning-test" });
  expect(receipt.status, receipt.adoptionError).toBe("applied");
  expect(await db.erpCostRows.toArray()).toMatchObject([{ platformSku: "SKU-RED", unitCost: 5 }]);
  const snapshot = await getSelectionReferenceSnapshot();
  expect(snapshot.erpCatalogRows.find(row => row.platformSku === "SKU-BLUE").sourceWarnings).toContain("mapping_failure:isolated_auxiliary_warehouse");
  expect(buildSelectionReferenceRows(snapshot).map(row => row.platformSku)).toEqual(["SKU-RED"]);
  const editor = await getProductEditorSnapshot({ platformSku: "SKU-RED" });
  expect(editor.draft.variants.map(row => row.platformSku)).toEqual(["SKU-RED"]);
  expect(editor.prefill.purchases).toHaveLength(3);
  expect(editor.prefill.purchases.every(row => row.warehouseSku === "WH-CATALOG")).toBe(true);
  expect(await db.products.count()).toBe(0);
}, 20000);
