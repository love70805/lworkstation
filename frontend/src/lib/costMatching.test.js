import { describe, expect, it } from "vitest";
import { buildErpInboxHistory, describeEvidenceIssues, evidenceRepairGuidance, filterCostMatchGroups, filterCostMatches, groupAuxiliaryCostRows, groupCostMatchesBySkc, hasMappingIdentityIssue, isUnmappedCostMatch, rejectErpInboxBatchesForCostMatching, switchLoadedErpInboxDraft } from "./costMatching";

describe("成本核对按平台 SKC 分组", () => {
  it("builds a newest-first processed and voided inbox history without rewriting evidence warnings", () => {
    const history = buildErpInboxHistory([
      { id: "PENDING", ledgerId: "L-1", status: "pending" },
      { id: "APPLIED", ledgerId: "L-1", status: "applied", appliedAt: "2026-08-20T08:00:00.000Z", receivedVia: "local-http" },
      { id: "REJECTED", ledgerId: "L-1", status: "rejected", rejectedAt: "2026-08-21T08:00:00.000Z", envelope: { batch: { sourceMeta: { sourceWarnings: ["unknown_platform_sku:legacy"] } } } },
      { id: "VOIDED", ledgerId: "L-1", status: "voided", voidedAt: "2026-08-22T08:00:00.000Z", voidReason: "测试作废" },
      { id: "OTHER", ledgerId: "L-2", status: "applied", appliedAt: "2026-08-23T08:00:00.000Z" },
    ], "L-1");
    expect(history.map((item) => [item.id, item.statusLabel])).toEqual([
      ["VOIDED", "已作废"],
      ["REJECTED", "已删除"],
      ["APPLIED", "已发布"],
    ]);
    expect(history[1].envelope.batch.sourceMeta.sourceWarnings).toEqual(["unknown_platform_sku:legacy"]);
  });

  it("clears the active CostMatching draft only when deletion rejects its loaded inbox", async () => {
    const cleared = [];
    const result = await rejectErpInboxBatchesForCostMatching({
      ids: ["PENDING-1", "LOADED-1"],
      loadedInboxId: "LOADED-1",
      rejectBatches: async ({ ids }) => ({ rejectedCount: ids.length, loadedIds: ["LOADED-1"] }),
      clearLoadedDraft: () => cleared.push("cleared"),
    });
    expect(result).toMatchObject({ rejectedCount: 2, clearedLoadedDraft: true });
    expect(cleared).toEqual(["cleared"]);

    const pendingOnly = await rejectErpInboxBatchesForCostMatching({
      ids: ["PENDING-2"],
      loadedInboxId: "LOADED-1",
      rejectBatches: async () => ({ rejectedCount: 1, loadedIds: [] }),
      clearLoadedDraft: () => cleared.push("unexpected"),
    });
    expect(pendingOnly).toMatchObject({ rejectedCount: 1, clearedLoadedDraft: false });
    expect(cleared).toEqual(["cleared"]);
  });

  it("groups auxiliary variants for audit without repair guidance", () => {
    const groups = groupAuxiliaryCostRows([
      {
        ledgerScopeRole: "auxiliary",
        platformSku: "I0mr8u67we1unj",
        platformSkc: "st260606170768328630349",
        warehouseSku: "SH25092037232977233-Y",
        purchaseRecords: Array.from({ length: 12 }, (_, index) => ({ recordId: `R-${index}` })),
        excludedRecords: [],
      },
      {
        ledgerScopeRole: "auxiliary",
        platformSku: "I5mq252xyw8fd7",
        platformSkc: "st260606170768328630349",
        warehouseSku: "SH25092037232977233-Y",
        purchaseRecords: Array.from({ length: 12 }, (_, index) => ({ recordId: `R-${index}` })),
        excludedRecords: [],
      },
    ]);
    expect(groups).toEqual([expect.objectContaining({
      platformSkc: "st260606170768328630349",
      warehouseSku: "SH25092037232977233-Y",
      purchaseRecordCount: 12,
      excludedRecordCount: 0,
      variants: [expect.objectContaining({ platformSku: "I0mr8u67we1unj" }), expect.objectContaining({ platformSku: "I5mq252xyw8fd7" })],
    })]);
    expect(JSON.stringify(groups)).not.toContain("unknown_platform_sku");
  });

  it("identifies warehouse-SKU fallback rows as unmapped without changing their status", () => {
    expect(isUnmappedCostMatch({ sourceWarehouseSku: "WH-1", mappingFallback: true })).toBe(true);
    expect(isUnmappedCostMatch({ sourceWarehouseSku: "WH-1", sourcePlatformSku: "SKU-1", mappingFallback: false })).toBe(false);
    expect(isUnmappedCostMatch({ status: "missing", platformSku: "SKU-1" })).toBe(false);
  });

  it("describes incomplete evidence fields and provides scoped repair guidance", () => {
    const issues = describeEvidenceIssues({
      sourceWarehouseSku: "WH-1",
      mappingFallback: true,
      sourcePlatformSku: "",
      platformSkc: "SKC-1",
      purchaseRecords: [],
      excludedRecords: [{ recordId: "EX-1" }],
      raw: { mappingFailures: [{ warehouseSku: "WH-1" }], detailFailures: [{ purchaseOrderId: "PO-1" }] },
      sourceWarnings: ["detail_failure:PO-1"],
      evidenceComplete: false,
    });
    expect(issues.map((item) => item.key)).toEqual(["mapping", "purchaseRecords", "excludedRecords", "mappingFailures", "detailFailures", "detailSourceWarnings", "evidenceRef"]);
    expect(issues.find((item) => item.key === "detailSourceWarnings").detail).toContain("采购明细读取失败");
    expect(evidenceRepairGuidance(issues.map((item) => item.key))).toEqual([
      "回到 ERP 采购页重新抓取平台 SKU/SKC 与仓库 SKU 映射。",
      "确认采购页已加载历史订单明细，并重新执行成本核算。",
      "排除记录会继续保留审计；请核对取消、关闭或当月记录的排除原因。",
      "核对当前账本平台 SKU/SKC 与 ERP 仓库映射；修正商品身份或仓库 SKU 映射后重新采集。",
      "检查 ERP 采购页分页和历史订单明细是否完整加载后重新采集。",
      "使用 ERP Assistant v8.0.15 重新生成完整 v2 批次，再回到本页载入。",
    ]);
  });

  it("describes real identity mismatches without suggesting pagination or purchase-detail repair", () => {
    const match = {
      platformSku: "SKU-EXPECTED",
      platformSkc: "SKC-EXPECTED",
      sourceWarehouseSku: "WH-SHARED",
      sourcePlatformSku: "SKU-EXPECTED",
      purchaseRecords: Array.from({ length: 12 }, (_, index) => ({ recordId: `R-${index}` })),
      excludedRecords: [],
      evidenceRef: "warehouse:WH-SHARED",
      raw: { platformSkc: "SKC-ERP" },
      sourceWarnings: ["mapping_failure:expected_skc_mismatch:SKU-EXPECTED"],
      evidenceComplete: false,
    };
    const issues = describeEvidenceIssues(match);
    expect(issues.find((item) => item.key === "mappingSourceWarnings")?.detail).toContain("SKC-ERP");
    expect(issues.find((item) => item.key === "mappingSourceWarnings")?.detail).toContain("SKC-EXPECTED");
    const guidance = evidenceRepairGuidance(issues.map((item) => item.key));
    expect(guidance.join(" ")).toContain("修正商品身份或仓库 SKU 映射");
    expect(guidance.join(" ")).not.toContain("分页");
    expect(hasMappingIdentityIssue([match])).toBe(true);
  });

  it("folds multiple platform SKU variants into one SKC row", () => {
    const groups = groupCostMatchesBySkc([
      { platformSkc: "SKC-1", platformSku: "SKU-RED", status: "matched", unitCost: 4 },
      { platformSkc: "SKC-1", platformSku: "SKU-BLUE", status: "missing", unitCost: null },
      { platformSkc: "SKC-2", platformSku: "SKU-GREEN", status: "matched", unitCost: 5 },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ platformSkc: "SKC-1", skuCount: 2, matchedCount: 1, missingCount: 1, status: "missing" });
    expect(groups[0].variants.map((item) => item.platformSku)).toEqual(["SKU-RED", "SKU-BLUE"]);
  });

  it("keeps an SKU without SKC isolated instead of merging it with other missing values", () => {
    const groups = groupCostMatchesBySkc([
      { platformSku: "SKU-1", status: "missing" },
      { platformSku: "SKU-2", status: "missing" },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("searches display groups without changing their SKU variants", () => {
    const groups = groupCostMatchesBySkc([
      { platformSkc: "SKC-1", platformSku: "SKU-RED", sourceWarehouseSku: "WH-RED", supplierName: "义乌红色供应商", orderNumber: "PO-100", status: "matched" },
      { platformSkc: "SKC-2", platformSku: "SKU-BLUE", sourceWarehouseSku: "WH-BLUE", status: "missing" },
    ]);

    expect(filterCostMatchGroups(groups, "义乌红色")).toHaveLength(1);
    expect(filterCostMatchGroups(groups, "WH-BLUE")[0].variants).toHaveLength(1);
  });

  it("searches anomaly records by procurement evidence fields", () => {
    const matches = [
      { platformSkc: "SKC-1", platformSku: "SKU-1", sourceWarehouseSku: "WH-1", supplier1688Url: "https://detail.1688.com/offer/730242606884.html", orderNumber: "PO-1" },
      { platformSkc: "SKC-2", platformSku: "SKU-2", sourceWarehouseSku: "WH-2", orderNumber: "PO-2" },
    ];

    expect(filterCostMatches(matches, "730242606884")).toEqual([matches[0]]);
    expect(filterCostMatches(matches, "PO-2")).toEqual([matches[1]]);
  });

  it("validates a replacement inbox batch before releasing the current loaded draft", async () => {
    const transitions = [];
    await expect(switchLoadedErpInboxDraft({
      candidate: { id: "INBOX-NEW" },
      previous: { id: "INBOX-OLD" },
      parseCandidate: () => { throw new Error("invalid evidence"); },
      markStatus: async (...args) => transitions.push(args),
    })).rejects.toThrow("invalid evidence");
    expect(transitions).toEqual([]);

    const parsed = await switchLoadedErpInboxDraft({
      candidate: { id: "INBOX-NEW" },
      previous: { id: "INBOX-OLD" },
      parseCandidate: () => ({ rows: [{ platformSku: "SKU-1" }] }),
      markStatus: async (...args) => transitions.push(args),
      now: () => "2026-08-19T08:00:00.000Z",
    });
    expect(parsed.rows).toHaveLength(1);
    expect(transitions.map(([id, status]) => [id, status])).toEqual([
      ["INBOX-NEW", "loaded"],
      ["INBOX-OLD", "pending"],
    ]);
  });

  it("rolls the candidate back when releasing the previous loaded draft fails", async () => {
    const transitions = [];
    await expect(switchLoadedErpInboxDraft({
      candidate: { id: "INBOX-NEW" },
      previous: { id: "INBOX-OLD" },
      parseCandidate: () => ({ rows: [{ platformSku: "SKU-1" }] }),
      markStatus: async (id, status, metadata) => {
        transitions.push([id, status, metadata]);
        if (id === "INBOX-OLD" && status === "pending") throw new Error("second write failed");
      },
      now: () => "2026-08-19T08:00:00.000Z",
    })).rejects.toThrow("second write failed");
    expect(transitions.map(([id, status]) => [id, status])).toEqual([
      ["INBOX-NEW", "loaded"],
      ["INBOX-OLD", "pending"],
      ["INBOX-NEW", "pending"],
    ]);
    expect(transitions[2][2]).toMatchObject({ unloadReason: "switch_rollback" });
  });
});
