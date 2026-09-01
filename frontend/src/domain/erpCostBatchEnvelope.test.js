import { describe, expect, it } from "vitest";
import {
  buildErpCostBatchEnvelope,
  ERP_COST_BATCH_FORMAT,
  ERP_COST_BATCH_VERSION,
  parseErpCostBatchJson,
  validateErpCostBatchEnvelope,
} from "./erpCostBatchEnvelope";

function evidence(warehouseSku, unitPrice = 4) {
  return {
    warehouseSku,
    evidenceComplete: true,
    purchaseRecords: [{
      recordId: `${warehouseSku}-R1`,
      quantity: 2,
      unitPrice,
      purchaseDate: "2026-06-01",
      supplierName: "测试供应商",
      selectedForPreview: true,
      confirmed: true,
      manualUnitPrice: 99,
    }],
    excludedRecords: [{
      recordId: `${warehouseSku}-C1`,
      unitPrice,
      exclusionReasons: ["cancelled_or_closed"],
    }],
  };
}

function buildFixture() {
  return buildErpCostBatchEnvelope({
    batchId: "ERP-BATCH-1",
    workspaceId: "workspace-default",
    ledgerId: "LEDGER-workspace-default-2026-07",
    requestId: "ERP-REQ-1",
    platformSkcs: ["SKC-1", "skc-1", "SKC-2"],
    generatedAt: "2026-08-07T08:00:00.000Z",
    sourceMeta: {
      orderCount: 20,
      validOrderCount: 18,
      skippedCancelledOrderCount: 2,
      evidenceVersion: 1,
      failureStats: [{ category: "informational", message: "统计信息", token: "must-not-leak" }],
      filters: { token: "must-not-leak" },
    },
    warehouseEvidence: [evidence("WH-1", 6.2), evidence("WH-2", 4)],
    results: [
      {
        warehouseSku: "WH-1",
        mappings: [{ platformSku: "SKU-1", platformSkc: "SKC-1" }, { platformSku: "SKU-2", platformSkc: "SKC-1" }],
        supplier1688Url: "https://detail.1688.com/offer/730242606884.html",
        unitCost: "6.2000",
        confirmed: true,
        formalCost: 99,
        manualUnitPrice: 99,
      },
      { warehouseSku: "WH-2", mappings: [], unitCost: 0 },
    ],
  });
}

describe("ERP cost batch envelope v2", () => {
  it("keeps shared-warehouse out-of-ledger variants auxiliary without downgrading expected evidence", () => {
    const purchaseRecords = Array.from({ length: 12 }, (_, index) => ({
      recordId: `SHARED-${index + 1}`,
      quantity: 1,
      unitPrice: 1.99,
      purchaseDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
    }));
    const envelope = buildErpCostBatchEnvelope({
      batchId: "ERP-BATCH-SHARED-WAREHOUSE",
      workspaceId: "workspace-default",
      ledgerId: "LEDGER-SHARED-WAREHOUSE",
      requestId: "ERP-REQ-SHARED-WAREHOUSE",
      platformSkcs: ["st260608151900573902683", "st260606170768328630349"],
      expectedSkus: [{ platformSku: "I3mqgejkr1vhv7", platformSkc: "st260608151900573902683" }],
      generatedAt: "2026-08-20T08:00:00.000Z",
      results: [{
        warehouseSku: "SH25092037232977233-Y",
        mappings: [
          { platformSku: "I3mqgejkr1vhv7", platformSkc: "st260608151900573902683", ledgerScopeRole: "expected" },
          { platformSku: "I0mr8u67we1unj", platformSkc: "st260606170768328630349", ledgerScopeRole: "auxiliary" },
        ],
        unitCost: 1.99,
      }],
      warehouseEvidence: [{
        warehouseSku: "SH25092037232977233-Y",
        evidenceComplete: true,
        purchaseRecords,
        excludedRecords: [],
      }],
    });

    expect(envelope.evidenceStatus).toBe("complete");
    expect(envelope.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ platformSku: "I3mqgejkr1vhv7", ledgerScopeRole: "expected", sourceWarnings: [] }),
      expect.objectContaining({ platformSku: "I0mr8u67we1unj", ledgerScopeRole: "auxiliary", sourceWarnings: [] }),
    ]));
    expect(envelope.warehouseEvidence[0]).toMatchObject({ evidenceComplete: true, purchaseRecords });

    const roleless = { ...envelope, rows: envelope.rows.map(({ ledgerScopeRole: _role, ...row }) => row) };
    const parsed = validateErpCostBatchEnvelope(roleless, {
      expectedSkus: [{ platformSku: "I3mqgejkr1vhv7", platformSkc: "st260608151900573902683" }],
    });
    expect(parsed.envelope.evidenceStatus).toBe("complete");
    expect(parsed.rows.find((row) => row.platformSku === "I0mr8u67we1unj").ledgerScopeRole).toBe("auxiliary");

    const historicalPartial = {
      ...roleless,
      evidenceStatus: "legacy_partial",
      sourceMeta: { ...roleless.sourceMeta, evidenceComplete: false },
    };
    const reparsedPartial = validateErpCostBatchEnvelope(historicalPartial, {
      expectedSkus: [{ platformSku: "I3mqgejkr1vhv7", platformSkc: "st260608151900573902683" }],
    });
    expect(reparsedPartial.envelope.evidenceStatus).toBe("legacy_partial");
    expect(reparsedPartial.envelope.sourceMeta.evidenceComplete).toBe(false);
  });

  it("rejects expected SKU identities outside the batch query SKC scope", () => {
    const envelope = buildFixture();
    expect(() => validateErpCostBatchEnvelope(envelope, {
      expectedSkus: [{ platformSku: "SKU-OUTSIDE", platformSkc: "SKC-OUTSIDE" }],
    })).toThrow("expectedSkus 包含不在完整平台 SKC 查询范围内");
  });

  it("ignores incomplete auxiliary-only evidence when expected evidence is complete", () => {
    const envelope = buildErpCostBatchEnvelope({
      batchId: "ERP-BATCH-AUXILIARY-INCOMPLETE",
      workspaceId: "workspace-default",
      ledgerId: "LEDGER-AUXILIARY-INCOMPLETE",
      requestId: "ERP-REQ-AUXILIARY-INCOMPLETE",
      platformSkcs: ["SKC-EXPECTED", "SKC-AUX"],
      expectedSkus: [{ platformSku: "SKU-EXPECTED", platformSkc: "SKC-EXPECTED" }],
      generatedAt: "2026-08-20T08:00:00.000Z",
      results: [
        { warehouseSku: "WH-EXPECTED", mappings: [{ platformSku: "SKU-EXPECTED", platformSkc: "SKC-EXPECTED" }], unitCost: 4 },
        { warehouseSku: "WH-AUX", mappings: [{ platformSku: "SKU-AUX", platformSkc: "SKC-AUX" }], unitCost: 5 },
      ],
      warehouseEvidence: [
        { warehouseSku: "WH-EXPECTED", evidenceComplete: true, purchaseRecords: [{ recordId: "R-EXPECTED", quantity: 1, unitPrice: 4 }] },
        { warehouseSku: "WH-AUX", evidenceComplete: false, sourceWarnings: ["detail_failure:AUX"], purchaseRecords: [] },
      ],
    });
    expect(envelope.evidenceStatus).toBe("complete");
    expect(envelope.rows.find((row) => row.platformSku === "SKU-AUX").ledgerScopeRole).toBe("auxiliary");
  });
  it("uses row evidence references and keeps extension cost values preview-only", () => {
    const envelope = buildFixture();
    expect(envelope).toMatchObject({
      format: ERP_COST_BATCH_FORMAT,
      formatVersion: ERP_COST_BATCH_VERSION,
      evidenceStatus: "complete",
      summary: { outputRowCount: 3, warehouseSkuCount: 2, mappingFallbackCount: 1, querySkcCount: 2 },
    });
    expect(envelope.rows.map((row) => [row.warehouseSku, row.evidenceRef, row.costRole, row.previewUnitCost])).toEqual([
      ["WH-1", "warehouse:WH-1", "preview", 6.2],
      ["WH-1", "warehouse:WH-1", "preview", 6.2],
      ["WH-2", "warehouse:WH-2", "preview", 0],
    ]);
    expect(envelope.rows[0]).not.toHaveProperty("confirmed");
    expect(envelope.rows[0]).not.toHaveProperty("formalCost");
    expect(envelope.warehouseEvidence[0].purchaseRecords[0]).not.toHaveProperty("manualUnitPrice");
  });

  it("preserves safe source metadata and strips filters, tokens and cookies", () => {
    const envelope = buildFixture();
    expect(envelope.sourceMeta).toMatchObject({
      evidenceVersion: 1,
      evidenceComplete: true,
      orderCount: 20,
      validOrderCount: 18,
      skippedCancelledOrderCount: 2,
      failureStats: [{ category: "informational", message: "统计信息" }],
    });
    expect(envelope.sourceMeta).not.toHaveProperty("filters");
  });

  it.each(["detailFailures", "mappingFailures"])("keeps %s for audit and downgrades completeness", (field) => {
    const envelope = buildFixture();
    envelope.sourceMeta = {
      ...envelope.sourceMeta,
      evidenceComplete: true,
      [field]: [{ message: `${field}-present`, token: "must-not-leak" }],
    };
    const parsed = validateErpCostBatchEnvelope(envelope);
    expect(parsed.evidenceStatus).toBe("legacy_partial");
    expect(parsed.envelope.sourceMeta.evidenceComplete).toBe(false);
    expect(parsed.envelope.sourceMeta[field]).toEqual([{ message: `${field}-present` }]);
  });

  it("keeps unassigned exclusions in source metadata without blocking warehouse evidence", () => {
    const envelope = buildErpCostBatchEnvelope({
      batchId: "ERP-BATCH-GLOBAL-EXCLUSION",
      workspaceId: "workspace-default",
      ledgerId: "LEDGER-workspace-default-2026-08",
      requestId: "ERP-REQ-GLOBAL-EXCLUSION",
      platformSkcs: ["SKC-GLOBAL-EXCLUSION"],
      generatedAt: "2026-08-07T08:00:00.000Z",
      sourceMeta: {
        exclusionStats: [{ recordId: "GLOBAL-EXCLUDED", warehouseSku: null, exclusionReasons: "cancelled_or_closed" }],
      },
      warehouseEvidence: {
        formatVersion: 1,
        warehouses: [evidence("WH-GLOBAL-EXCLUSION", 4)],
        excludedDetails: [{ recordId: "GLOBAL-EXCLUDED", warehouseSku: null, exclusionReasons: ["cancelled_or_closed"] }],
      },
      results: [{
        warehouseSku: "WH-GLOBAL-EXCLUSION",
        mappings: [{ platformSku: "SKU-GLOBAL-EXCLUSION", platformSkc: "SKC-GLOBAL-EXCLUSION" }],
        unitCost: 4,
      }],
    });
    expect(envelope.evidenceStatus).toBe("complete");
    expect(envelope.warehouseEvidence[0].excludedRecords.map((record) => record.recordId)).toEqual(["WH-GLOBAL-EXCLUSION-C1"]);
    expect(envelope.warehouseEvidence[0].sourceWarnings).toEqual([]);
    expect(envelope.warehouseEvidence[0].evidenceComplete).toBe(true);
    expect(envelope.sourceMeta.exclusionStats).toEqual([
      { recordId: "GLOBAL-EXCLUDED", warehouseSku: null, exclusionReasons: "cancelled_or_closed" },
    ]);
  });

  it("allows null preview cost and validates row references", () => {
    const envelope = buildFixture();
    const withNull = { ...envelope, rows: envelope.rows.map((row, index) => index === 0 ? { ...row, previewUnitCost: null, unitCost: null } : row) };
    expect(validateErpCostBatchEnvelope(withNull).rows[0].previewUnitCost).toBeNull();
    const mismatched = { ...envelope, rows: envelope.rows.map((row, index) => index === 0 ? { ...row, previewUnitCost: 1, unitCost: 2 } : row) };
    expect(() => validateErpCostBatchEnvelope(mismatched)).toThrow("预览成本字段不一致");
    const broken = { ...envelope, rows: envelope.rows.map((row, index) => index === 0 ? { ...row, evidenceRef: "warehouse:OTHER" } : row) };
    expect(() => validateErpCostBatchEnvelope(broken)).toThrow("证据引用");
    const brokenEvidence = { ...envelope, warehouseEvidence: envelope.warehouseEvidence.map((entry, index) => index === 0 ? { ...entry, evidenceRef: "warehouse:OTHER" } : entry) };
    expect(() => validateErpCostBatchEnvelope(brokenEvidence)).toThrow("证据引用与仓库 SKU 不一致");
    const duplicateEvidence = { ...envelope, warehouseEvidence: [...envelope.warehouseEvidence, { ...envelope.warehouseEvidence[0] }] };
    expect(() => validateErpCostBatchEnvelope(duplicateEvidence)).toThrow("证据引用重复");
  });

  it("imports v1 as legacy_partial preview and ignores forged decisions", () => {
    const current = buildFixture();
    const legacy = {
      ...current,
      formatVersion: 1,
      warehouseEvidence: undefined,
      rows: current.rows.map(({ evidenceRef: _evidenceRef, costRole: _costRole, ...row }) => ({
        ...row,
        confirmed: true,
        formalCost: 99,
        manualUnitPrice: 99,
        anomalyRecords: [{ confirmed: true, manualUnitPrice: 99 }],
      })),
    };
    const parsed = parseErpCostBatchJson(JSON.stringify(legacy));
    expect(parsed.evidenceStatus).toBe("legacy_partial");
    expect(parsed.evidenceComplete).toBe(false);
    expect(parsed.envelope.sourceMeta).toMatchObject({ evidenceVersion: 0, evidenceComplete: false });
    expect(parsed.rows[0]).not.toHaveProperty("confirmed");
    expect(parsed.rows[0]).not.toHaveProperty("formalCost");
  });

  it("validates request scope and computed row counts", () => {
    const envelope = buildFixture();
    expect(validateErpCostBatchEnvelope(envelope, {
      expectedWorkspaceId: "workspace-default",
      expectedLedgerId: "LEDGER-workspace-default-2026-07",
      expectedRequestId: "ERP-REQ-1",
    }).rows).toHaveLength(3);
    expect(() => validateErpCostBatchEnvelope(envelope, { expectedWorkspaceId: "workspace-other" })).toThrow("工作区");
    expect(() => validateErpCostBatchEnvelope({ ...envelope, summary: { ...envelope.summary, outputRowCount: 99 } })).toThrow("输出行数校验失败");
  });

  it("preserves preview-only row and source warnings without treating them as formal mappings", () => {
    const envelope = buildFixture();
    envelope.rows[0] = {
      ...envelope.rows[0],
      platformSku: "",
      sourceWarnings: ["mapping_failure:missing_platform_sku"],
    };
    envelope.sourceMeta = { ...envelope.sourceMeta, sourceWarnings: ["mapping incomplete"] };
    envelope.sourceMeta.queryCapturedAt = "2026-08-19T07:59:00.000Z";
    envelope.sourceMeta.registeredBefore = "2026-08-19T07:59:00.000Z";
    const parsed = validateErpCostBatchEnvelope(envelope);
    expect(parsed.rows[0]).toMatchObject({
      platformSku: null,
      sourceWarnings: ["mapping_failure:missing_platform_sku"],
      evidenceComplete: false,
    });
    expect(parsed.envelope.sourceMeta.sourceWarnings).toEqual(["mapping incomplete"]);
    expect(parsed.envelope.sourceMeta.queryCapturedAt).toBe("2026-08-19T07:59:00.000Z");
    expect(parsed.envelope.sourceMeta.registeredBefore).toBe("2026-08-19T07:59:00.000Z");
  });

  it("downgrades evidence when an evidence entry carries source warnings", () => {
    const envelope = buildFixture();
    envelope.warehouseEvidence[0] = {
      ...envelope.warehouseEvidence[0],
      evidenceComplete: true,
      sourceWarnings: ["entry-warning"],
    };
    const parsed = validateErpCostBatchEnvelope(envelope);
    expect(parsed.evidenceComplete).toBe(false);
    expect(parsed.evidenceStatus).toBe("legacy_partial");
    expect(parsed.envelope.warehouseEvidence[0]).toMatchObject({
      evidenceComplete: false,
      sourceWarnings: ["entry-warning"],
    });
  });

  it("downgrades evidence when only top-level source metadata carries an unknown warning", () => {
    const envelope = buildFixture();
    envelope.sourceMeta = { ...envelope.sourceMeta, sourceWarnings: ["top-level-collection-warning"] };
    const parsed = validateErpCostBatchEnvelope(envelope);
    expect(parsed.evidenceComplete).toBe(false);
    expect(parsed.evidenceStatus).toBe("legacy_partial");
    expect(parsed.envelope.sourceMeta).toMatchObject({
      evidenceComplete: false,
      sourceWarnings: ["top-level-collection-warning"],
    });
  });

  it.each([
    ["string", "top-level-warning"],
    ["object", { code: "top-level-warning" }],
    ["numeric array item", ["valid-warning", 7]],
  ])("rejects malformed top-level source warnings: %s", (_label, sourceWarnings) => {
    const envelope = buildFixture();
    envelope.sourceMeta = { ...envelope.sourceMeta, sourceWarnings };
    expect(() => validateErpCostBatchEnvelope(envelope)).toThrow("来源警告");
  });

  it.each([
    ["row string", "row", "malformed-warning"],
    ["row object", "row", { code: "malformed-warning" }],
    ["row numeric array item", "row", ["valid-warning", 7]],
    ["evidence string", "evidence", "malformed-warning"],
    ["evidence object", "evidence", { code: "malformed-warning" }],
    ["evidence numeric array item", "evidence", ["valid-warning", 7]],
  ])("rejects malformed nested source warnings: %s", (_label, target, sourceWarnings) => {
    const envelope = buildFixture();
    if (target === "row") envelope.rows[0] = { ...envelope.rows[0], sourceWarnings };
    else envelope.warehouseEvidence[0] = { ...envelope.warehouseEvidence[0], sourceWarnings };
    expect(() => validateErpCostBatchEnvelope(envelope)).toThrow("来源警告");
  });
});
