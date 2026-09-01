import { describe, expect, it } from "vitest";
import {
  buildErpCostRequest,
  calculateLegacyWarehouseCosts,
  isCancelledPurchaseRecord,
  reconcileErpCostRows,
} from "./erpCosts";

describe("ERP cost requests", () => {
  it("builds a deduplicated SKC-scoped request", () => {
    const request = buildErpCostRequest({
      id: "REQ-1",
      workspaceId: "workspace-a",
      platformSkcs: [" skc-01 ", "SKC-01", "ＳＫＣ-02"],
      requestedBy: "user-1",
      requestedAt: "2026-08-06T08:00:00.000Z",
      ledgerId: "ledger-2026-07",
    });

    expect(request.queryUnit).toBe("platform_skc");
    expect(request.currency).toBe("CNY");
    expect(request.platformSkcs).toEqual([
      { platformSkc: "skc-01", canonicalPlatformSkc: "SKC-01" },
      { platformSkc: "SKC-02", canonicalPlatformSkc: "SKC-02" },
    ]);
  });

  it("rejects an empty ERP request", () => {
    expect(() => buildErpCostRequest({
      id: "REQ-2",
      workspaceId: "workspace-a",
      platformSkcs: [],
      requestedBy: "user-1",
      requestedAt: "2026-08-06T08:00:00.000Z",
    })).toThrowError(expect.objectContaining({ code: "erp_request_empty" }));
  });

  it("rejects expected SKU identities outside the complete query SKC scope", () => {
    expect(() => buildErpCostRequest({
      id: "REQ-OUTSIDE-SCOPE",
      workspaceId: "workspace-a",
      platformSkcs: ["SKC-IN-SCOPE"],
      expectedSkus: [{ platformSku: "SKU-OUTSIDE", platformSkc: "SKC-OUTSIDE" }],
      requestedBy: "user-1",
      requestedAt: "2026-08-06T08:00:00.000Z",
    })).toThrowError(expect.objectContaining({ code: "erp_expected_sku_outside_query" }));
  });
});

describe("ERP v8.0-compatible cost selection", () => {
  it("uses only recent 1688 records and calculates a weighted unit cost", () => {
    const result = calculateLegacyWarehouseCosts([
      { id: "R1", warehouseSku: "WH-1", purchaseDate: "2026-05-01", quantity: 10, unitPrice: 10, purchaseOrderNo: "P1" },
      { id: "R2", warehouseSku: "WH-1", purchaseDate: "2026-06-01", quantity: 10, unitPrice: 20, purchaseOrderNo: "P2" },
      { id: "R3", warehouseSku: "WH-1", purchaseDate: "2026-07-01", quantity: 2, unitPrice: 5, order1688: "A3" },
      { id: "R4", warehouseSku: "WH-1", purchaseDate: "2026-07-10", quantity: 3, unitPrice: 7, order1688: "A4" },
    ], { currentYearMonth: 202608 });

    expect(result.costs[0]).toMatchObject({
      warehouseSku: "WH-1",
      sourceType: "1688",
      orderNumber: "A4",
      calculationCount: 2,
      totalQuantity: 5,
      totalPrice: 31,
      unitCost: 6.2,
      selectedRecordIds: ["R4", "R3"],
    });
  });

  it("falls back to the latest three regular purchases and excludes current-month or cancelled records", () => {
    const result = calculateLegacyWarehouseCosts([
      { id: "R1", warehouseSku: "WH-1", purchaseDate: "2026-04-01", quantity: 1, unitPrice: 1, purchaseOrderNo: "P1" },
      { id: "R2", warehouseSku: "WH-1", purchaseDate: "2026-05-01", quantity: 1, unitPrice: 2, purchaseOrderNo: "P2" },
      { id: "R3", warehouseSku: "WH-1", purchaseDate: "2026-06-01", quantity: 1, unitPrice: 3, purchaseOrderNo: "P3" },
      { id: "R4", warehouseSku: "WH-1", purchaseDate: "2026-07-01", quantity: 1, unitPrice: 4, purchaseOrderNo: "P4" },
      { id: "R5", warehouseSku: "WH-1", purchaseDate: "2026-08-01", quantity: 1, unitPrice: 100, purchaseOrderNo: "P5" },
      { id: "R6", warehouseSku: "WH-1", purchaseDate: "2026-07-20", quantity: 1, unitPrice: 100, purchaseOrderNo: "P6", purchaseStatus: "11" },
      { id: "R7", warehouseSku: "WH-1", purchaseDate: "2026-07-21", quantity: 1, unitPrice: 100, purchaseOrderNo: "P7", paymentStatus: "已取消", order1688Status: "已取消" },
    ], { currentYearMonth: 202608 });

    expect(result.costs[0]).toMatchObject({
      sourceType: "purchase_order",
      calculationCount: 3,
      totalQuantity: 3,
      totalPrice: 9,
      unitCost: 3,
      selectedRecordIds: ["R4", "R3", "R2"],
    });
    expect(result.skippedCurrentMonth).toBe(1);
    expect(result.skippedCancelled).toBe(2);
  });

  it("recognizes cancelled payment and 1688 order states even when the ERP field name varies", () => {
    expect(isCancelledPurchaseRecord({ paymentStatus: "已取消", order1688Status: "已取消" })).toBe(true);
    expect(isCancelledPurchaseRecord({ erpPaymentState: "CANCELLED" })).toBe(true);
    expect(isCancelledPurchaseRecord({ purchaseStatus: "已采购", orderStatus: "已下单" })).toBe(false);
  });
});

describe("ERP cost reconciliation", () => {
  function purchaseRecord(recordId, warehouseSku, purchaseDate, unitPrice, quantity = 1) {
    return { recordId, warehouseSku, purchaseDate, unitPrice, quantity, eligible: true, exclusionReasons: [] };
  }

  it("keeps same-warehouse auxiliary variants out of matching and warehouse fallback", () => {
    const result = reconcileErpCostRows({
      workspaceId: "workspace-a",
      expectedSkus: [
        { platformSku: "I3mqgejkr1vhv7", platformSkc: "st260608151900573902683", warehouseSku: "SH25092037232977233-Y" },
        { platformSku: "SKU-MISSING", platformSkc: "st260606170768328630349", warehouseSku: "WH-AUX-ONLY" },
      ],
      costRows: [
        {
          platformSku: "I3mqgejkr1vhv7",
          platformSkc: "st260608151900573902683",
          warehouseSku: "SH25092037232977233-Y",
          ledgerScopeRole: "expected",
          previewUnitCost: 1.99,
          purchaseRecords: [purchaseRecord("R-EXPECTED", "SH25092037232977233-Y", "2026-07-01", 1.99)],
          evidenceComplete: true,
        },
        {
          platformSku: "I0mr8u67we1unj",
          platformSkc: "st260606170768328630349",
          warehouseSku: "SH25092037232977233-Y",
          ledgerScopeRole: "auxiliary",
          previewUnitCost: 1.99,
          purchaseRecords: [purchaseRecord("R-SHARED", "SH25092037232977233-Y", "2026-07-01", 1.99)],
          evidenceComplete: true,
        },
        {
          platformSku: "SKU-AUX-ONLY",
          platformSkc: "st260606170768328630349",
          warehouseSku: "WH-AUX-ONLY",
          ledgerScopeRole: "auxiliary",
          previewUnitCost: 3,
          purchaseRecords: [purchaseRecord("R-AUX", "WH-AUX-ONLY", "2026-07-01", 3)],
          evidenceComplete: true,
        },
      ],
    });

    expect(result.matches[0]).toMatchObject({ status: "matched", ledgerScopeRole: "expected", sourcePlatformSku: "I3mqgejkr1vhv7" });
    expect(result.matches[1]).toMatchObject({ status: "missing", matchMethod: null });
    expect(result.auxiliaryCostRows.map((row) => row.platformSku)).toEqual(["I0mr8u67we1unj", "SKU-AUX-ONLY"]);
    expect(result.summary).toMatchObject({ matchedCount: 1, missingCount: 1, fallbackCount: 0, auxiliaryCount: 2 });
  });

  it("matches complete purchase evidence by platform SKU first and keeps override audit details", () => {
    const result = reconcileErpCostRows({
      workspaceId: "workspace-a",
      expectedSkus: [
        { platformSku: "SKU-A", warehouseSku: "WH-A" },
        { platformSku: "SKU-B", warehouseSku: "WH-B" },
        { platformSku: "SKU-C" },
      ],
      batchId: "COST-1",
      costRows: [
        { platformSku: "sku-a", warehouseSku: "WH-A", orderNumber: "A-100", previewUnitCost: 4, purchaseRecords: [purchaseRecord("A-OLD", "WH-A", "2026-06-01", 4)], evidenceComplete: true },
        { platformSku: "SKU-A", warehouseSku: "WH-A", orderNumber: "", previewUnitCost: 4.25, calculationCount: 2, totalQuantity: 5, totalPrice: 21.25, dateRange: "2026-06-01 ~ 2026-07-01", purchaseRecords: [purchaseRecord("A-1", "WH-A", "2026-07-01", 4.25, 3), purchaseRecord("A-2", "WH-A", "2026-06-01", 4.25, 2)], evidenceComplete: true },
        { warehouseSku: "wh-b", orderNumber: "P-200", previewUnitCost: 2.5, purchaseRecords: [purchaseRecord("B-1", "WH-B", "2026-07-01", 2.5)], evidenceComplete: true },
        { platformSku: "SKU-A", unitCost: 0 },
        { platformSku: "SKU-X", warehouseSku: "WH-X", previewUnitCost: 9, purchaseRecords: [purchaseRecord("X-1", "WH-X", "2026-07-01", 9)], evidenceComplete: true },
      ],
    });

    expect(result.matches[0]).toMatchObject({
      status: "matched",
      matchMethod: "platform_sku",
      unitCost: 4.25,
      orderNumber: "A-100",
      calculationCount: 2,
      totalQuantity: 5,
      totalPrice: 21.25,
      dateRange: "2026-06-01 ~ 2026-07-01",
    });
    expect(result.matches[1]).toMatchObject({
      status: "matched",
      matchMethod: "warehouse_sku_fallback",
      unitCost: 2.5,
      requiresReview: true,
    });
    expect(result.matches[2].status).toBe("missing");
    expect(result.invalidRows).toHaveLength(1);
    expect(result.overrides).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyType: "platform_sku", retainedPreviousOrderNumber: true, changedCost: true }),
    ]));
    expect(result.unmatchedCostRows).toEqual([
      expect.objectContaining({ platformSku: "SKU-X", unitCost: 9 }),
    ]);
    expect(result.summary).toMatchObject({ matchedCount: 2, missingCount: 1, fallbackCount: 1 });
  });

  it("keeps evidence diagnostics attached to the reconciled match", () => {
    const result = reconcileErpCostRows({
      workspaceId: "workspace-a",
      expectedSkus: [{ platformSku: "SKU-A", warehouseSku: "WH-A" }],
      costRows: [{
        platformSku: "SKU-A",
        warehouseSku: "WH-A",
        evidenceRef: "warehouse:WH-A",
        previewUnitCost: 4,
        purchaseRecords: [purchaseRecord("R-1", "WH-A", "2026-07-01", 4)],
        evidenceComplete: false,
        mappingFailures: [{ warehouseSku: "WH-A", message: "mapping incomplete" }],
        detailFailures: [{ purchaseOrderId: "PO-1", message: "detail timeout" }],
        sourceWarnings: ["detail_failure:PO-1"],
      }],
    });

    expect(result.matches[0]).toMatchObject({
      evidenceRef: "warehouse:WH-A",
      mappingFailures: [{ message: "mapping incomplete" }],
      detailFailures: [{ purchaseOrderId: "PO-1" }],
      raw: expect.objectContaining({ evidenceRef: "warehouse:WH-A" }),
    });
  });

  it("keeps a one-yuan anomaly preview-only and matches it after Shopeers resolution", () => {
    const costRows = [{
      platformSku: "SKU-A",
      warehouseSku: "WH-A",
      previewUnitCost: 1,
      evidenceComplete: true,
      purchaseRecords: [purchaseRecord("R-1", "WH-A", "2026-07-01", 1, 2)],
      confirmed: true,
      formalCost: 99,
      manualUnitPrice: 99,
    }];
    const pending = reconcileErpCostRows({
      workspaceId: "workspace-a",
      expectedSkus: [{ platformSku: "SKU-A", warehouseSku: "WH-A" }],
      costRows,
    });
    expect(pending.matches[0]).toMatchObject({
      status: "anomaly_pending",
      unitCost: 1,
      unresolvedAnomalyCount: 1,
    });
    expect(pending.summary).toMatchObject({ matchedCount: 0, missingCount: 1, anomalyPendingCount: 1 });

    const resolved = reconcileErpCostRows({
      workspaceId: "workspace-a",
      expectedSkus: [{ platformSku: "SKU-A", warehouseSku: "WH-A" }],
      costRows,
      resolutions: [{
        warehouseSku: "WH-A",
        recordId: "R-1",
        action: "correct_price",
        originalUnitPrice: 1,
        resolvedUnitPrice: 2,
        resolvedBy: "finance-1",
        resolvedAt: "2026-08-11T08:00:00.000Z",
      }],
    });
    expect(resolved.matches[0]).toMatchObject({ status: "matched", unitCost: 2, resolvedAnomalyCount: 1 });
    expect(resolved.summary).toMatchObject({ matchedCount: 1, anomalyPendingCount: 0, anomalyConfirmedCount: 1 });
  });

  it("does not trust extension-side formal or confirmation fields", () => {
    const result = reconcileErpCostRows({
      workspaceId: "workspace-a",
      expectedSkus: [{ platformSku: "SKU-A", warehouseSku: "WH-A" }],
      costRows: [{
        platformSku: "SKU-A",
        warehouseSku: "WH-A",
        previewUnitCost: 99,
        evidenceComplete: true,
        purchaseRecords: [purchaseRecord("R-1", "WH-A", "2026-07-01", 1)],
        confirmed: true,
        formalCost: 99,
        manualUnitPrice: 99,
      }],
    });
    expect(result.matches[0].status).toBe("anomaly_pending");
    expect(result.matches[0].unitCost).toBe(1);
  });
});
