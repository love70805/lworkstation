import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_ID,
  createManualCaptureRecord,
  createOrGetMonthlyLedger,
  db,
  finalizeMonthlyLedger,
  getLedgerSnapshot,
  getSelectionReferenceSnapshot,
  getLatestErpCostInbox,
  listProductCatalogRecords,
  markErpCostInboxStatus,
  receiveErpCostInboxEnvelope,
  saveErpCostRequest,
  saveProductCatalogRecord,
  savePublishedErpCostBatch,
  saveSalesImport,
} from "./database";
import { buildErpCostBatchEnvelope } from "../domain/erpCostBatchEnvelope";
import { parseErpCostBatchJson } from "../domain/erpCostBatchEnvelope";
import { buildErpCostInboxEnvelope } from "../domain/erpInboxContract";
import { buildErpCostRequest, reconcileErpCostRows } from "../domain/erpCosts";
import { resolveFormalCostDecision } from "../domain/costPolicy";
import { calculateExactProfitLine, PROFIT_FORMULA_VERSION } from "../domain/profitCalculations";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";
import { groupImportedSales } from "../lib/profit";
import { validateSalesRows } from "../lib/salesImport";

const period = "2026-08";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("同一平台 SKC 下多个平台 SKU 的 ERP 收件到利润回流", () => {
  it("keeps both SKU mappings, finalizes exact profit, and feeds selection references", async () => {
    const capture = await createManualCaptureRecord({
      name: "多 SKU 测试商品",
      sourceUrl: "https://detail.1688.com/offer/multi-sku-test",
      sourceProductId: "1688-MULTI-SKU-1",
      supplierCode: "SUP-MULTI",
      supplierName: "多 SKU 供应商",
    });
    const product = await saveProductCatalogRecord({
      captureId: capture.id,
      draft: {
        ...capture.draft,
        name: "多 SKU 测试商品",
        platformSkc: "SKC-MULTI-1",
        variants: [
          { id: "VAR-RED", attribute: "红色", platformSku: "SKU-MULTI-RED", sourceSku: "RED", purchaseUnitPrice: 8, purchasePackCount: 1, unitsPerPack: 1 },
          { id: "VAR-BLUE", attribute: "蓝色", platformSku: "SKU-MULTI-BLUE", sourceSku: "BLUE", purchaseUnitPrice: 9, purchasePackCount: 1, unitsPerPack: 1 },
        ],
      },
      status: "active",
    });
    const ledger = await createOrGetMonthlyLedger({ period, createdBy: "multi-sku-test" });
    const mapping = {
      store: "店铺",
      supplierNumber: "供方货号",
      platformSkc: "平台 SKC",
      platformSku: "平台 SKU",
      quantity: "数量",
      amount: "金额",
    };
    const validation = validateSalesRows([
      { 店铺: "美国主店", 供方货号: "SUP-MULTI", "平台 SKC": "SKC-MULTI-1", "平台 SKU": "SKU-MULTI-RED", 数量: "5", 金额: "50" },
      { 店铺: "美国主店", 供方货号: "SUP-MULTI", "平台 SKC": "SKC-MULTI-1", "平台 SKU": "SKU-MULTI-BLUE", 数量: "3", 金额: "36" },
    ], mapping);
    expect(validation.errors).toHaveLength(0);
    await saveSalesImport({
      fileName: "multi-sku-sales.csv",
      mapping,
      summary: { sourceRowCount: 2, errorCount: 0, ignoredCount: 0 },
      rows: validation.rows,
      period,
      storeName: "美国主店",
      importedBy: "multi-sku-test",
    });

    const expectedSkus = [
      { platformSku: "SKU-MULTI-RED", platformSkc: "SKC-MULTI-1" },
      { platformSku: "SKU-MULTI-BLUE", platformSkc: "SKC-MULTI-1" },
    ];
    const request = buildErpCostRequest({
      id: "ERP-REQ-MULTI-SKU",
      workspaceId: DEFAULT_WORKSPACE_ID,
      ledgerId: ledger.id,
      platformSkcs: ["SKC-MULTI-1"],
      expectedSkus,
      requestedBy: "multi-sku-test",
      requestedAt: "2026-08-08T10:00:00.000Z",
    });
    await saveErpCostRequest(request);
    const batch = buildErpCostBatchEnvelope({
      batchId: "ERP-BATCH-MULTI-SKU",
      workspaceId: DEFAULT_WORKSPACE_ID,
      ledgerId: ledger.id,
      requestId: request.id,
      platformSkcs: ["SKC-MULTI-1"],
      results: [{
        warehouseSku: "WH-MULTI-1",
        platformSkc: "SKC-MULTI-1",
        mappings: [
          { platformSku: "SKU-MULTI-RED", platformSkc: "SKC-MULTI-1" },
          { platformSku: "SKU-MULTI-BLUE", platformSkc: "SKC-MULTI-1" },
        ],
        orderNumber: "1688-MULTI-ORDER",
        sourceType: "1688",
        calcTimes: 3,
        totalQty: 8,
        totalPrice: 28,
        unitCost: 3.5,
      }],
      warehouseEvidence: [{
        warehouseSku: "WH-MULTI-1",
        evidenceComplete: true,
        purchaseRecords: [
          { recordId: "MULTI-R3", warehouseSku: "WH-MULTI-1", purchaseDate: "2026-07-03", quantity: 3, unitPrice: 3.5, order1688: "1688-MULTI-ORDER", eligible: true, exclusionReasons: [] },
          { recordId: "MULTI-R2", warehouseSku: "WH-MULTI-1", purchaseDate: "2026-07-02", quantity: 3, unitPrice: 3.5, order1688: "1688-MULTI-ORDER", eligible: true, exclusionReasons: [] },
          { recordId: "MULTI-R1", warehouseSku: "WH-MULTI-1", purchaseDate: "2026-07-01", quantity: 2, unitPrice: 3.5, order1688: "1688-MULTI-ORDER", eligible: true, exclusionReasons: [] },
        ],
      }],
      generatedAt: "2026-08-08T10:05:00.000Z",
    });
    const inbox = await receiveErpCostInboxEnvelope({
      envelope: buildErpCostInboxEnvelope({ batch, deliveryId: "ERP-DELIVERY-MULTI-SKU", sentAt: "2026-08-08T10:05:01.000Z" }),
      receivedVia: "integration-test",
    });
    expect(inbox).toMatchObject({ batchId: batch.batchId, status: "pending", idempotent: false });

    const received = await getLatestErpCostInbox(ledger.id);
    const rows = parseErpCostBatchJson(JSON.stringify(received.envelope.batch)).rows;
    const reconciliation = reconcileErpCostRows({
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedSkus,
      costRows: rows,
      batchId: batch.batchId,
    });
    expect(reconciliation.summary).toMatchObject({ expectedCount: 2, matchedCount: 2, missingCount: 0 });
    expect(reconciliation.matches.map((row) => row.platformSkc)).toEqual(["SKC-MULTI-1", "SKC-MULTI-1"]);

    await markErpCostInboxStatus(received.id, "loaded");
    const published = await savePublishedErpCostBatch({
      ledgerId: ledger.id,
      inboxId: received.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      requestId: request.id,
      reconciliation,
      sourceName: "自动收件 · ERP-BATCH-MULTI-SKU",
      inputHash: "multi-sku-hash",
      sourceEnvelope: received.envelope.batch,
      publishedBy: "multi-sku-test",
    });
    expect(published.matchedCount).toBe(2);
    expect(await db.erpCostInbox.get(received.id)).toMatchObject({ status: "applied", appliedBatchId: published.batchId });

    // ERP 成本发布后应立即回流选品工作台；不依赖本月利润表先定稿。
    const [catalogAfterErpPublish] = await listProductCatalogRecords();
    expect(catalogAfterErpPublish).toMatchObject({
      id: product.product.id,
      lowestReferenceCost: 3.5,
      costSource: "erp",
      erpCoveredSkuCount: 2,
      referenceCoveredSkuCount: 2,
    });
    const referencesBeforeFinalizing = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
    expect(referencesBeforeFinalizing.filter((row) => row.platformSkc === "SKC-MULTI-1")).toHaveLength(2);
    expect(referencesBeforeFinalizing.filter((row) => row.platformSkc === "SKC-MULTI-1").every((row) => (
      row.authoritativeSource === "erp" && row.referenceUnitCost === 3.5 && row.latestPeriod === null
    ))).toBe(true);

    const snapshot = await getLedgerSnapshot(ledger.id);
    expect(snapshot.costs).toHaveLength(2);
    expect(snapshot.costs.map((row) => row.platformSku).toSorted()).toEqual(["SKU-MULTI-BLUE", "SKU-MULTI-RED"]);
    expect(snapshot.costs.every((row) => row.platformSkc === "SKC-MULTI-1" && row.unitCost === 3.5)).toBe(true);

    const salesLines = groupImportedSales(snapshot.rows);
    const profitLines = salesLines.map((salesLine) => {
      const erpCost = snapshot.costs.find((row) => row.platformSku === salesLine.platformSku);
      const decision = resolveFormalCostDecision({ ledgerId: ledger.id, platformSku: salesLine.platformSku, erpCost });
      const exact = calculateExactProfitLine({ revenue: salesLine.revenue, quantity: salesLine.qty, costDecision: decision, warehouseRate: 0.5, penalty: salesLine.penalty });
      return {
        platformSku: salesLine.platformSku,
        canonicalPlatformSku: salesLine.canonicalPlatformSku,
        platformSkc: salesLine.platformSkc,
        groupSkc: salesLine.groupSkc,
        supplierNumber: salesLine.supplierNumber,
        store: salesLine.store,
        attribute: salesLine.attribute,
        quantity: salesLine.qty,
        revenue: exact.revenue,
        penalty: exact.penalty,
        unitCost: exact.unitCost,
        purchaseCost: exact.purchaseCost,
        warehouseCost: exact.warehouseCost,
        profit: exact.profit,
        profitRate: exact.profitRate,
        costSource: decision.source,
        costSourceRecordId: decision.sourceRecordId,
        costApprovalId: decision.approvalId,
        costPolicyVersion: decision.policyVersion,
        orderNumber: erpCost.orderNumber,
        finalizable: exact.finalizable,
        calculationMode: "exact",
      };
    });
    const profitSummary = profitLines.reduce((summary, line) => ({
      revenue: summary.revenue + line.revenue,
      quantity: summary.quantity + line.quantity,
      purchaseCost: summary.purchaseCost + line.purchaseCost,
      warehouseCost: summary.warehouseCost + line.warehouseCost,
      penalty: summary.penalty + line.penalty,
      profit: summary.profit + line.profit,
      profitRate: 0,
      missingSkuCount: 0,
    }), { revenue: 0, quantity: 0, purchaseCost: 0, warehouseCost: 0, penalty: 0, profit: 0, profitRate: 0, missingSkuCount: 0 });
    profitSummary.profitRate = profitSummary.revenue > 0 ? profitSummary.profit / profitSummary.revenue : 0;
    await finalizeMonthlyLedger({ ledgerId: ledger.id, formulaVersion: PROFIT_FORMULA_VERSION, profitSummary, profitLines });

    const references = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
    expect(references.filter((row) => row.platformSkc === "SKC-MULTI-1")).toHaveLength(2);
    expect(references.filter((row) => row.platformSkc === "SKC-MULTI-1").every((row) => row.authoritativeSource === "erp" && row.referenceUnitCost === 3.5)).toBe(true);
    expect((await getLatestErpCostInbox(ledger.id))).toBeNull();
    expect(product.product.id).toBeTruthy();
  });
});
