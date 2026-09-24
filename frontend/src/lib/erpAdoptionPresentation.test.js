import { expect, it } from "vitest";
import { ERP_ADOPTION_ITEM_LABELS, describeErpAdoptionReason, groupAdoptionExceptions, summarizeAdoptionForDisplay } from "./erpAdoptionPresentation";

it("separates automatically adopted costs from effective manual corrections and remaining exceptions", () => {
  expect(summarizeAdoptionForDisplay({ state: "partial", summary: {
    adoptedCount: 3, manualEffectiveCount: 1, anomalyCount: 1, evidenceIncompleteCount: 1, missingCount: 0, protectedCount: 0, supersededCount: 0, remainingCount: 2,
  } })).toEqual({ title: "已自动采用 2 项，剩余 2 项待处理", details: "ERP 自动采用 2 项 · 人工更正仍有效 1 项 · 采购异常 1 项 · 证据不完整 1 项", automaticCount: 2, remainingCount: 2 });
  expect(ERP_ADOPTION_ITEM_LABELS.missing).toBe("未取得 ERP 成本");
  expect(ERP_ADOPTION_ITEM_LABELS.ledger_protected).toContain("成本未改");
  expect(summarizeAdoptionForDisplay({ state: "applied", summary: { adoptedCount: 3 } }, { status: "voided" }))
    .toMatchObject({ title: "本次 ERP 采用已撤回", automaticCount: 0 });
  expect(groupAdoptionExceptions({ items: [
    { state: 'adopted', platformSku: 'A' },
    { state: 'anomaly_pending', platformSku: 'B' },
    { state: 'missing', platformSku: 'C' },
  ] }).map(group => [group.state, group.items.map(item => item.platformSku)]))
    .toEqual([['anomaly_pending', ['B']], ['missing', ['C']]]);
});

it('explains a blocked old request without presenting a preview amount as adopted cost', () => {
  expect(describeErpAdoptionReason('legacy_request_ambiguous_scope')).toContain('同一平台 SKU 对应多个平台 SKC');
  expect(summarizeAdoptionForDisplay({ state: 'blocked', reason: 'source_incomplete', summary: {
    adoptedCount: 0, remainingCount: 0,
  } }).details).toContain('ERP 来源声明整体证据不完整');
});
