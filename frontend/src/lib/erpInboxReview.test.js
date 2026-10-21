import { describe, expect, it } from "vitest";
import { buildErpCostRequest } from "../domain/erpCosts";
import { buildErpCostBatchEnvelope } from "../domain/erpCostBatchEnvelope";
import { buildErpCostInboxEnvelope } from "../domain/erpInboxContract";
import { ERP_ADOPTION_VERSION, summarizeErpAdoption } from "../domain/erpAutomaticAdoption";
import { buildErpInboxReview, readErpInboxReviewEvidence } from "./erpInboxReview";

const ledger = { id: "LEDGER", workspaceId: "WORKSPACE", period: "2026-09", status: "cost_pending" };
const record = (id, price, date = "2026-09-01", quantity = 10) => ({ recordId: id, unitPrice: price, purchaseDate: date, quantity, eligible: true, exclusionReasons: [] });

function row(sku, eligible = false, extra = {}) {
  return { id: `甲店/${sku}`, workspaceId: ledger.workspaceId, ledgerId: ledger.id, store: "甲店", platformSku: sku,
    canonicalPlatformSku: sku.toUpperCase(), platformSkc: "SKC-SHARED", attribute: `规格 ${sku}`, unitCost: eligible ? 4.59 : null,
    decision: { eligibleForExactProfit: eligible }, manualOverride: null, erpCost: null, ...extra };
}

function receipt(number, specs, options = {}) {
  const day = String(number + 1).padStart(2, "0");
  const expectedSkus = specs.filter(spec => !spec.auxiliary).map(spec => ({ platformSku: spec.sku, platformSkc: spec.skc ?? "SKC-SHARED" }));
  const request = buildErpCostRequest({ id: `REQUEST-${number}`, workspaceId: ledger.workspaceId, ledgerId: ledger.id, ledgerPeriod: ledger.period,
    platformSkcs: [...new Set(specs.map(spec => spec.skc ?? "SKC-SHARED"))], expectedSkus,
    requestedAt: options.requestedAt ?? `2026-10-${day}T00:00:00Z`, requestedBy: "finance" });
  const batch = buildErpCostBatchEnvelope({ batchId: `BATCH-${number}`, workspaceId: ledger.workspaceId, ledgerId: ledger.id, requestId: request.id,
    platformSkcs: request.platformSkcs, expectedSkus, generatedAt: options.generatedAt ?? `2026-10-${day}T00:01:00Z`,
    sourceMeta: options.sourceMeta ?? {},
    results: specs.map(spec => ({ warehouseSku: `WH-${spec.sku}`, name: `商品 ${spec.sku}`, previewUnitCost: spec.price ?? 1,
      mappings: [{ platformSku: spec.sku, platformSkc: spec.skc ?? "SKC-SHARED", ledgerScopeRole: spec.auxiliary ? "auxiliary" : "expected" }] })),
    warehouseEvidence: specs.map(spec => ({ warehouseSku: `WH-${spec.sku}`, evidenceComplete: spec.evidenceComplete !== false,
      sourceWarnings: spec.sourceWarnings ?? [], purchaseRecords: (spec.records ?? [record(`RAW-${spec.sku}`, spec.price ?? 1)])
        .map(purchase => ({ ...purchase, warehouseSku: `WH-${spec.sku}` })) })),
  });
  const items = specs.filter(spec => !spec.auxiliary).map(spec => ({ platformSku: spec.sku, canonicalPlatformSku: spec.sku.toUpperCase(),
    state: spec.state ?? (spec.price > 1 ? "adopted" : "anomaly_pending"), ...(spec.reason ? { reason: spec.reason } : {}) }));
  const summary = summarizeErpAdoption(items);
  const inbox = { id: `INBOX-${number}`, batchId: batch.batchId, requestId: request.id, workspaceId: ledger.workspaceId, ledgerId: ledger.id,
    receivedAt: options.receivedAt ?? `2026-10-${day}T00:02:00Z`, status: options.status ?? (summary.remainingCount ? "pending" : "applied"),
    envelope: buildErpCostInboxEnvelope({ batch, deliveryId: `DELIVERY-${number}`, sentAt: `2026-10-${day}T00:01:30Z` }, { expectedSkus }),
    adoption: { version: ERP_ADOPTION_VERSION, state: summary.remainingCount ? "partial" : "applied", items, summary }, ...options.inboxFields };
  return { inbox, request };
}

function review(receipts, reviewRows, extra = {}) {
  return buildErpInboxReview({ ledger, inboxes: receipts.map(item => item.inbox), requests: receipts.map(item => item.request), reviewRows, ...extra });
}

function lowHistory() {
  return [...Array.from({ length: 6 }, (_, index) => record(`OLD-${index}`, 2.3, `2026-08-${String(index + 1).padStart(2, "0")}`)),
    record("LOW-1", 1.55, "2026-09-01"), record("LOW-2", 1.59, "2026-09-02"), record("LOW-3", 1.58, "2026-09-03"),
    record("LATER", 1, "2026-10-01")];
}

describe("ERP inbox review display projection", () => {
  it('summarizes statuses without reading procurement bodies, then validates only the opened receipt', () => {
    const first = receipt(1, [{ sku: 'A', price: 1 }]), other = receipt(2, [{ sku: 'B', price: 1 }]);
    let firstReads = 0, otherReads = 0;
    for (const [item, count] of [[first, () => firstReads++], [other, () => otherReads++]]) {
      const evidence = item.inbox.envelope.batch.warehouseEvidence;
      Object.defineProperty(item.inbox.envelope.batch, 'warehouseEvidence', { enumerable: true, get() { count(); return evidence; } });
    }
    const summary = review([first, other], [row('A'), row('B')], { includeEvidence: false });
    expect(summary.exceptions).toHaveLength(2);
    expect(summary.exceptions.every(item => item.match === null)).toBe(true);
    expect(firstReads + otherReads).toBe(0);
    const detail = readErpInboxReviewEvidence({ ...first, ledger, platformSku: 'A' });
    expect(detail.error).toBeNull(); expect(detail.match.status).toBe('anomaly_pending');
    expect(firstReads).toBeGreaterThan(0); expect(otherReads).toBe(0);
  });
  it('does not let lazy summaries authorize tampered or foreign evidence', () => {
    const item = receipt(1, [{ sku: 'A', price: 1 }]);
    item.inbox.envelope.batch.batchId = 'FORGED';
    const detail = readErpInboxReviewEvidence({ ...item, ledger, platformSku: 'A' });
    expect(detail.match).toBeNull(); expect(detail.error).toBeTruthy();
    expect(readErpInboxReviewEvidence({ ...item, ledger: { ...ledger, workspaceId: 'FOREIGN' }, platformSku: 'A' }).match).toBeNull();
    expect(readErpInboxReviewEvidence({ ...item, ledger, platformSku: 'UNREGISTERED' }).match).toBeNull();
  });
  it('does not describe deferred legacy evidence as absent', () => {
    const item = receipt(1, [{ sku: 'A', price: 4.59 }], { status: 'pending', inboxFields: { adoption: null } });
    const summary = review([item], [row('A')], { includeEvidence: false });
    expect(summary.exceptions[0].reasonText).toContain('展开核对采购证据');
    expect(summary.exceptions[0].reasonText).not.toContain('重新采集');
    expect(readErpInboxReviewEvidence({ ...item, ledger, platformSku: 'A' }).match.status).toBe('matched');
  });
  it("shows all six receipts and combines their 1 + 2 + 4 exceptions, without including healthy SKC siblings", () => {
    const specs = [1, 2, 4, 0, 0, 0].map((count, batch) => [
      { sku: `NORMAL-${batch}`, price: 4.59 },
      ...Array.from({ length: count }, (_, index) => ({ sku: `EXCEPTION-${batch}-${index}`, price: 1 })),
    ]);
    specs[1][1].records = lowHistory();
    specs[1][2].records = lowHistory();
    const receipts = specs.map((items, index) => receipt(index + 1, items));
    const rows = specs.flatMap(items => items.map(spec => row(spec.sku, spec.price > 1)));
    const input = JSON.stringify({ receipts, rows });
    const result = review(receipts.toReversed(), rows);
    expect(result.batches.map(batch => [batch.index, batch.total, batch.batchId, batch.automaticCount, batch.currentMissingCount, batch.historicalExceptionCount]))
      .toEqual([1, 2, 4, 0, 0, 0].map((count, index) => [index + 1, 6, `BATCH-${index + 1}`, 1, count, count]));
    expect(result.exceptions).toHaveLength(7);
    expect(new Set(result.exceptions.map(entry => entry.canonicalPlatformSku)).size).toBe(7);
    expect(result.exceptions.every(entry => entry.currentMissing && !entry.platformSku.startsWith("NORMAL"))).toBe(true);
    expect(result.batches[0].entries[0]).toMatchObject({ reviewRowId: "甲店/EXCEPTION-0-0", inboxId: "INBOX-1", batchId: "BATCH-1", batchIndex: 1,
      store: "甲店", platformSkc: "SKC-SHARED", warehouseSku: "WH-EXCEPTION-0-0", attribute: "规格 EXCEPTION-0-0", productName: "商品 EXCEPTION-0-0", unitCost: 1 });
    expect(result.exceptions.filter(entry => entry.reasonText.includes("相比历史下降"))).toHaveLength(2);
    expect(JSON.stringify({ receipts, rows })).toBe(input);
  });

  it("rebuilds historical price reasons and selected evidence using the request month, preserving the existing blocking rule", () => {
    const source = receipt(1, [{ sku: "LOW", records: lowHistory() }]);
    const entry = review([source], [row("LOW")]).exceptions[0];
    expect(entry.reasonText).toContain("近期采购价格相比历史下降");
    expect(entry.reasonText).toContain("历史中位价 ¥2.3000");
    expect(entry.reasonText).not.toContain("anomaly_pending");
    expect(entry.match).toMatchObject({ status: "anomaly_pending", formalUnitCost: null, unitCost: 1.5733,
      costDecision: { costPeriod: "2026-09", selectedRecordIds: ["LOW-3", "LOW-2", "LOW-1"] } });
    expect(entry.match.costDecision.anomalies.every(item => item.reasons.includes("recent_price_shift_low"))).toBe(true);
    expect(entry.match.costDecision.purchaseRecords.find(item => item.recordId === "LATER").exclusionReasons).toContain("after_ledger_period");
  });

  it("explains zero prices, historical increases and single extreme deviations specifically", () => {
    const older = Array.from({ length: 6 }, (_, index) => record(`OLDER-${index}`, 2.3, `2026-08-${index + 1}`));
    const source = receipt(1, [{ sku: "ZERO", price: 0 },
      { sku: "HIGH", records: [...older, record("H1", 3.2, "2026-09-01"), record("H2", 3.2, "2026-09-02"), record("H3", 3.2, "2026-09-03")] },
      { sku: "EXTREME", records: [...older, record("E1", 8, "2026-09-03"), record("E2", 2.3, "2026-09-02"), record("E3", 2.3, "2026-09-01")] }]);
    const reasons = review([source], [row("ZERO"), row("HIGH"), row("EXTREME")]).exceptions.map(entry => entry.reasonText);
    expect(reasons[0]).toContain("采购单价为 0 元");
    expect(reasons[1]).toContain("相比历史上涨");
    expect(reasons[2]).toContain("极端偏离历史中位价");
  });

  it.each([0, 0.00001])("keeps historical exceptions after a manual cost of %s covers them, and restores missing status after revocation", amount => {
    const source = receipt(1, [{ sku: "A" }]);
    const covered = row("A", true, { unitCost: amount, manualOverride: { approvedAmount: amount } });
    const before = JSON.stringify(source.inbox);
    const result = review([source], [covered]);
    expect(result.exceptions).toEqual([]);
    expect(result.batches[0]).toMatchObject({ automaticCount: 0, currentMissingCount: 0, coveredCount: 1, historicalExceptionCount: 1 });
    expect(result.batches[0].entries[0]).toMatchObject({ state: "anomaly_pending", currentMissing: false, unitCost: 1 });
    expect(result.batches[0].entries[0].reasonText).toContain("采购单价为 1 元");
    expect(JSON.stringify(source.inbox)).toBe(before);
    expect(review([source], [row("A")]).exceptions[0]).toMatchObject({ currentMissing: true, state: "anomaly_pending" });
  });

  it("requires effective costs in each store and deduplicates repeated projections by store and canonical SKU", () => {
    const source = receipt(1, [{ sku: "A" }]);
    const alpha = row("A", true, { unitCost: 0, manualOverride: { approvedAmount: 0 } });
    const beta = row("a", false, { id: "乙店/A", store: "乙店" });
    const result = review([source], [alpha, beta, { ...beta, id: "DUPLICATE", store: " 乙店 " }]);
    expect(result.batches[0]).toMatchObject({ currentMissingCount: 1, coveredCount: 1, historicalExceptionCount: 1 });
    expect(result.batches[0].entries).toHaveLength(2);
    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0].canonicalPlatformSku).toBe("A");
    expect(result.exceptions[0].store.trim()).toBe("乙店");
    expect(review([source], [{ ...alpha, decision: { eligibleForExactProfit: false }, manualOverride: null }, beta]).exceptions).toHaveLength(2);
  });

  it("excludes other workspaces, ledgers and request months from both batches and exception evidence", () => {
    const owned = receipt(1, [{ sku: "A" }]);
    const foreignWorkspace = receipt(2, [{ sku: "FOREIGN" }], { inboxFields: { workspaceId: "OTHER" } });
    const foreignLedger = receipt(3, [{ sku: "FOREIGN" }], { inboxFields: { ledgerId: "OTHER" } });
    const otherMonth = receipt(4, [{ sku: "FOREIGN" }]);
    otherMonth.request.ledgerPeriod = "2026-08";
    const foreignSource = receipt(5, [{ sku: "FOREIGN" }]);
    foreignSource.inbox.envelope.batch.workspaceId = "OTHER";
    const result = review([owned, foreignWorkspace, foreignLedger, otherMonth, foreignSource], [row("A"), row("FOREIGN", false, { workspaceId: "OTHER" })]);
    expect(result.batches.map(batch => [batch.id, batch.index, batch.total])).toEqual([["INBOX-1", 1, 1]]);
    expect(result.exceptions.map(entry => entry.platformSku)).toEqual(["A"]);
    expect(buildErpInboxReview({ inboxes: [owned.inbox], reviewRows: [row("A")] })).toEqual({ batches: [], exceptions: [] });
  });

  it("uses the newest request source for retries even if an old receipt arrives later", () => {
    const older = receipt(1, [{ sku: "A", price: 1 }], { receivedAt: "2026-10-20T00:00:00Z" });
    const newer = receipt(2, [{ sku: "A", records: lowHistory() }]);
    const result = review([older, newer], [row("A")]);
    expect(result.batches.map(batch => batch.id)).toEqual(["INBOX-2", "INBOX-1"]);
    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0]).toMatchObject({ inboxId: "INBOX-2", batchIndex: 1 });
    expect(result.exceptions[0].reasonText).toContain("相比历史下降");
    expect(result.batches[1].entries[0].reasonText).toContain("采购单价为 1 元");
    expect(review([older, newer], [row("A", true)]).exceptions).toEqual([]);
  });

  it.each(["voided", "rejected"])("retains %s history without recycling its evidence or an older receipt into the pending list", status => {
    const older = receipt(1, [{ sku: "A", price: 1 }]);
    const retired = receipt(2, [{ sku: "A", price: 4.59 }], { status });
    const result = review([older, retired], [row("A")]);
    expect(result.batches).toHaveLength(2);
    expect(result.batches[1].automaticCount).toBe(0);
    expect(result.batches[1].entries[0].reasonText).toContain(status === "voided" ? "已撤回" : "已拒绝");
    expect(result.exceptions[0]).toMatchObject({ inboxId: null, batchId: null, batchIndex: null, match: null, unitCost: null, reviewRowId: "甲店/A", currentMissing: true });
    expect(result.exceptions[0].reasonText).toContain(status === "voided" ? "已撤回" : "已拒绝");
  });

  it("shows all missing rows without a receipt and prevents corrections of conflicted SKU parents", () => {
    const conflict = row("CONFLICT", false, { decision: { eligibleForExactProfit: false, identityIssue: { code: "ledger_sku_skc_conflict", platformSku: "CONFLICT", ledgerPlatformSkcs: ["SKC-A", "SKC-B"] } } });
    const result = review([], [row("A"), conflict]);
    expect(result.batches).toEqual([]);
    expect(result.exceptions).toHaveLength(2);
    expect(result.exceptions[0]).toMatchObject({ reviewRowId: "甲店/A", canCorrect: true, batchIndex: null, match: null });
    expect(result.exceptions[1]).toMatchObject({ canCorrect: false, currentMissing: true });
    expect(result.exceptions[1].reasonText).toContain("多个平台 SKC");
    const source = receipt(1, [{ sku: "CONFLICT" }]);
    expect(review([source], [conflict]).exceptions[0].canCorrect).toBe(false);
  });

  it("explains incomplete evidence, source failures, protected ledgers and automatic storage failures accurately", () => {
    const incomplete = receipt(1, [{ sku: "INCOMPLETE", evidenceComplete: false, state: "evidence_incomplete", reason: "item_evidence_incomplete" }]);
    const sourceFailure = receipt(2, [{ sku: "FAILURE", price: 4.59, state: "evidence_incomplete" }], { sourceMeta: { detailFailures: [{ warehouseSku: "WH-FAILURE", message: "ERP 明细响应 503" }] } });
    const protectedReceipt = receipt(3, [{ sku: "PROTECTED", price: 4.59, state: "ledger_protected", reason: "finalized" }]);
    const failed = receipt(4, [{ sku: "STORAGE", price: 4.59 }], { status: "pending", inboxFields: { adoptionFailure: { message: "保存未完成" } } });
    const result = review([incomplete, sourceFailure, protectedReceipt, failed], [row("INCOMPLETE"), row("FAILURE"), row("PROTECTED"), row("STORAGE")]);
    expect(result.exceptions[0].reasonText).toContain("采购证据不完整");
    expect(result.exceptions[1].reasonText).toContain("采购明细读取失败：ERP 明细响应 503");
    expect(result.exceptions[2].reasonText).toContain("账本定稿保护");
    expect(result.exceptions[3].reasonText).toContain("自动采用未完成：保存未完成");
  });

  it("isolates malformed receipt validation while keeping other batch details usable", () => {
    const malformed = receipt(1, [{ sku: "BAD" }]);
    malformed.inbox.envelope.batch.summary.outputRowCount = 999;
    const valid = receipt(2, [{ sku: "GOOD" }]);
    const result = review([malformed, valid], [row("BAD"), row("GOOD")]);
    expect(result.batches).toHaveLength(2);
    expect(result.exceptions[0].match).toBeNull();
    expect(result.exceptions[0].reasonText).toContain("输出行数校验失败");
    expect(result.exceptions[1].match.costDecision.selectedRecordIds).toEqual(["RAW-GOOD"]);
  });
});
