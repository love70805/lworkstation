import { describe, expect, it } from "vitest";
import {
  calculateWarehouseCostDecision,
  detectPurchaseCostAnomalies,
  normalizePurchaseEvidenceRecord,
  selectFormalPurchaseRecords,
} from "./erpCostResolution";

function record(id, date, unitPrice, quantity = 1, extra = {}) {
  return {
    recordId: id,
    warehouseSku: "WH-1",
    purchaseDate: date,
    unitPrice,
    quantity,
    eligible: true,
    exclusionReasons: [],
    ...extra,
  };
}

function normalized(records) {
  return records.map((item, index) => normalizePurchaseEvidenceRecord(item, index, "WH-1"));
}

describe("ERP warehouse cost anomaly detection", () => {
  it("uses all effective history for median/MAD and flags a recent sustained shift", () => {
    const history = Array.from({ length: 10 }, (_, index) => (
      record(`OLD-${index}`, `2026-05-${String(index + 1).padStart(2, "0")}`, 1.99)
    ));
    const recent = [
      record("NEW-1", "2026-07-01", 2.99),
      record("NEW-2", "2026-07-02", 2.99),
      record("NEW-3", "2026-07-03", 2.99),
    ];
    const records = normalized([...history, ...recent]);
    const selected = selectFormalPurchaseRecords(records);
    const result = detectPurchaseCostAnomalies(records, selected);

    expect(result.baseline).toMatchObject({ enabled: true, sampleCount: 13, median: 1.99, mad: 0, tolerance: 0.597 });
    expect(result.anomalies).toHaveLength(3);
    expect(result.anomalies.every((item) => item.reasons.includes("recent_price_shift_high"))).toBe(true);
  });

  it("does not flag ordinary recent fluctuation", () => {
    const records = normalized([
      record("R1", "2026-05-01", 1.9),
      record("R2", "2026-05-02", 1.95),
      record("R3", "2026-05-03", 2),
      record("R4", "2026-06-01", 2.05),
      record("R5", "2026-06-02", 2.1),
      record("R6", "2026-07-01", 2.15),
      record("R7", "2026-07-02", 2.2),
      record("R8", "2026-07-03", 2.05),
    ]);
    const result = detectPurchaseCostAnomalies(records, selectFormalPurchaseRecords(records));
    expect(result.anomalies).toEqual([]);
  });

  it("does not enable historical distribution rules below six positive samples", () => {
    const records = normalized([
      record("R1", "2026-06-01", 1.99),
      record("R2", "2026-06-02", 1.99),
      record("R3", "2026-07-01", 9.99),
      record("R4", "2026-07-02", 9.99),
      record("R5", "2026-07-03", 9.99),
    ]);
    const result = detectPurchaseCostAnomalies(records, selectFormalPurchaseRecords(records));
    expect(result.baseline.enabled).toBe(false);
    expect(result.anomalies).toEqual([]);
  });

  it("flags a single extreme price when history is sufficient", () => {
    const records = normalized([
      ...Array.from({ length: 6 }, (_, index) => record(`R${index}`, `2026-06-${index + 1}`, 10)),
      record("EXTREME", "2026-07-03", 25),
      record("NORMAL-1", "2026-07-02", 10.2),
      record("NORMAL-2", "2026-07-01", 9.8),
    ]);
    const result = detectPurchaseCostAnomalies(records, selectFormalPurchaseRecords(records));
    expect(result.anomalies).toEqual([
      expect.objectContaining({ recordId: "EXTREME", reasons: ["extreme_price_deviation"] }),
    ]);
  });
});

describe("ERP Shopeers-owned resolutions", () => {
  it("allows a real one-yuan price to be confirmed without changing it", () => {
    const purchaseRecords = [
      record("ONE", "2026-07-03", 1, 2),
      record("R2", "2026-07-02", 1.1, 1),
      record("R3", "2026-07-01", 1.2, 1),
    ];
    const result = calculateWarehouseCostDecision({
      warehouseSku: "WH-1",
      purchaseRecords,
      evidenceComplete: true,
      resolutions: [{
        warehouseSku: "WH-1",
        recordId: "ONE",
        action: "confirm_true_price",
        originalUnitPrice: 1,
        resolvedUnitPrice: 1,
        resolvedBy: "local-user",
        resolvedAt: "2026-08-12T08:00:00.000Z",
      }],
    });
    expect(result).toMatchObject({ resolutionStatus: "resolved", unresolvedAnomalyCount: 0, unitCost: 1.07 });
  });

  it("does not allow a zero price to be confirmed as true", () => {
    const result = calculateWarehouseCostDecision({
      warehouseSku: "WH-1",
      purchaseRecords: [record("ZERO", "2026-07-03", 0)],
      evidenceComplete: true,
      resolutions: [{
        warehouseSku: "WH-1",
        recordId: "ZERO",
        action: "confirm_true_price",
        originalUnitPrice: 0,
        resolvedUnitPrice: 0,
        resolvedBy: "local-user",
        resolvedAt: "2026-08-12T08:00:00.000Z",
      }],
    });
    expect(result).toMatchObject({ resolutionStatus: "pending", unresolvedAnomalyCount: 1, formalUnitCost: null });
  });

  it("recomputes the weighted latest-three cost from corrected prices", () => {
    const result = calculateWarehouseCostDecision({
      warehouseSku: "WH-1",
      purchaseRecords: [
        record("ZERO", "2026-07-03", 0, 2),
        record("R2", "2026-07-02", 2, 1),
        record("R3", "2026-07-01", 3, 1),
      ],
      evidenceComplete: true,
      resolutions: [{
        warehouseSku: "WH-1",
        recordId: "ZERO",
        action: "correct_price",
        originalUnitPrice: 0,
        resolvedUnitPrice: 4,
        reason: "ERP 录入错误",
        resolvedBy: "local-user",
        resolvedAt: "2026-08-12T08:00:00.000Z",
      }],
    });
    expect(result).toMatchObject({
      resolutionStatus: "resolved",
      selectedRecordIds: ["ZERO", "R2", "R3"],
      totalQuantity: 4,
      totalPrice: 13,
      unitCost: 3.25,
      formalUnitCost: 3.25,
    });
  });

  it("keeps incomplete evidence preview-only even with no detected anomaly", () => {
    const result = calculateWarehouseCostDecision({
      warehouseSku: "WH-1",
      purchaseRecords: [record("R1", "2026-07-01", 2)],
      evidenceComplete: false,
    });
    expect(result).toMatchObject({ resolutionStatus: "pending", anomalyCount: 0, formalUnitCost: null, unitCost: 2 });
  });

  it("truncates the formal weighted unit cost to two decimals", () => {
    const result = calculateWarehouseCostDecision({
      warehouseSku: "WH-1",
      evidenceComplete: true,
      purchaseRecords: [
        record("R1", "2026-07-02", 1.239, 1),
        record("R2", "2026-07-01", 1.239, 2),
      ],
    });

    expect(result).toMatchObject({ totalPrice: 3.71, unitCost: 1.23, formalUnitCost: 1.23 });
  });

  it("independently excludes cancelled, current-month and invalid records", () => {
    const result = calculateWarehouseCostDecision({
      warehouseSku: "WH-1",
      currentYearMonth: 202608,
      evidenceComplete: true,
      purchaseRecords: [
        record("VALID", "2026-07-01", 2, 2),
        record("CANCELLED", "2026-07-03", 50, 1, { statusFields: { paymentStatus: "已取消" } }),
        record("CURRENT", "2026-08-01", 60, 1),
        record("INVALID", "2026-07-02", 70, 0),
      ],
    });
    expect(result).toMatchObject({
      resolutionStatus: "resolved",
      selectedRecordIds: ["VALID"],
      totalQuantity: 2,
      totalPrice: 4,
      unitCost: 2,
    });
    expect(result.purchaseRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordId: "CANCELLED", eligible: false, exclusionReasons: ["cancelled_or_closed"] }),
      expect.objectContaining({ recordId: "CURRENT", eligible: false, exclusionReasons: ["current_month"] }),
      expect.objectContaining({ recordId: "INVALID", eligible: false, exclusionReasons: ["invalid_purchase_detail"] }),
    ]));
  });
});
