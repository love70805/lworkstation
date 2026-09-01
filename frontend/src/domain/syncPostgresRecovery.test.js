import { describe, expect, it, vi } from "vitest";
import { loadPostgresRecovery, buildPostgresRecoveryPlan } from "./syncPostgresRecovery";
import { replaySyncRecoveryPayload } from "./syncRecovery";

const workspaceId = "workspace-recovery";
const createdAt = new Date("2026-08-08T00:00:00.000Z");

function client({ fail = false } = {}) {
  const calls = [];
  const query = vi.fn(async (text) => {
    calls.push(text);
    if (fail && text.includes("platform_skus")) throw new Error("read failed");
    if (text.startsWith("begin") || text === "commit" || text === "rollback") return { rows: [] };
    if (text.includes("from public.workspaces")) return { rows: [{ id: workspaceId, name: "恢复工作区", default_currency: "CNY", timezone: "Asia/Shanghai", selection_status_definitions: [{ id: "testing", label: "测品" }], created_at: createdAt, updated_at: createdAt }] };
    if (text.includes("from public.audit_events")) return { rows: [{ id: "1", workspace_id: workspaceId, event_id: "E-1", object_type: "product", object_id: "P-1", action: "product_created", actor_id: "u1", before_snapshot: null, after_snapshot: { snapshot: { product: { id: "P-1", workspaceId, name: "商品" }, platformSkus: [], supplierOffers: [] } }, created_at: createdAt, sync_version: "10" }] };
    if (text.includes("from public.products")) return { rows: [{ id: "P-1", workspace_id: workspaceId, name: "商品", status: "active", currency: "CNY", created_at: createdAt, updated_at: createdAt }] };
    return { rows: [] };
  });
  return { query, calls };
}

function lifecycleClient(batchStatus) {
  const inboxStatus = batchStatus === "published" ? "applied" : "voided";
  return {
    query: vi.fn(async (text) => {
      if (text.startsWith("begin") || text === "commit" || text === "rollback") return { rows: [] };
      if (text.includes("from public.workspaces")) return { rows: [{ id: workspaceId, name: "恢复工作区", default_currency: "CNY", timezone: "Asia/Shanghai", created_at: createdAt, updated_at: createdAt }] };
      if (text.includes("from public.ledgers")) return { rows: [{ id: "L-1", workspace_id: workspaceId, period: "2026-08", type: "monthly_profit", status: batchStatus === "published" ? "ready" : "cost_pending", currency: "CNY", warehouse_rate: 0.7, summary: {}, cost_summary: {}, created_at: createdAt, updated_at: createdAt }] };
      if (text.includes("from public.erp_cost_batches")) return { rows: [{
        id: "C-1", workspace_id: workspaceId, ledger_id: "L-1", status: batchStatus, currency: "CNY", summary: {}, published_at: createdAt, created_at: createdAt,
        voided_at: batchStatus === "voided" ? createdAt : null, voided_by: batchStatus === "voided" ? "finance-1" : null,
        void_reason: batchStatus === "voided" ? "成本错误" : null,
      }] };
      if (text.includes("from public.erp_cost_rows")) return { rows: [{ id: "1", workspace_id: workspaceId, batch_id: "C-1", ledger_id: "L-1", platform_sku: "SKU-1", canonical_platform_sku: "SKU-1", unit_cost: 4, currency: "CNY", evidence: {}, published_at: createdAt }] };
      if (text.includes("from public.erp_cost_inbox")) return { rows: [{
        id: "INBOX-1", workspace_id: workspaceId, delivery_id: "D-1", batch_id: "SOURCE-1", ledger_id: "L-1",
        status: inboxStatus, received_via: "cloud", received_at: createdAt,
        envelope: { format: "shopeers-erp-cost-inbox", formatVersion: 2 }, applied_batch_id: "C-1",
        voided_batch_id: batchStatus === "voided" ? "C-1" : null, applied_at: createdAt,
        voided_at: batchStatus === "voided" ? createdAt : null, voided_by: batchStatus === "voided" ? "finance-1" : null,
        void_reason: batchStatus === "voided" ? "成本错误" : null,
        updated_at: createdAt,
      }] };
      if (text.includes("from public.profit_lines")) return { rows: [] };
      return { rows: [] };
    }),
  };
}

describe("postgres recovery repository", () => {
  it("builds fixed workspace-scoped queries", () => {
    const plan = buildPostgresRecoveryPlan(workspaceId);
    expect(plan.queries.length).toBe(16);
    expect(plan.queries.find((query) => query.table === "erpCostInbox")?.text).toContain("from public.erp_cost_inbox");
    expect(plan.queries.every((query) => query.text.includes("$1") && query.values[0] === workspaceId)).toBe(true);
    expect(plan.transaction.begin).toContain("repeatable read");
  });

  it("为销售账号过滤私有商品及其子表记录", () => {
    const plan = buildPostgresRecoveryPlan(workspaceId, { actor: "sales-1", role: "selection" });
    const products = plan.queries.find((query) => query.table === "products");
    const skus = plan.queries.find((query) => query.table === "platformSkus");
    const offers = plan.queries.find((query) => query.table === "supplierOffers");
    const manualCosts = plan.queries.find((query) => query.table === "catalogManualCosts");
    const captures = plan.queries.find((query) => query.table === "captures");
    expect(products.text).toContain("owner_id = $2");
    expect(skus.text).toContain("from public.products p");
    expect(offers.text).toContain("from public.products p");
    expect(manualCosts.text).toContain("from public.products p");
    expect(captures.text).toContain("owner_id = $2");
    expect(products.values).toEqual([workspaceId, "sales-1", false]);
  });

  it("reads a consistent baseline and produces recovery v1", async () => {
    const db = client();
    const recovery = await loadPostgresRecovery(workspaceId, { client: db, now: () => "2026-08-08T00:00:01.000Z" });
    expect(recovery).toMatchObject({ format: "shopeers-sync-recovery", workspaceId, currency: "CNY", cursor: "10", events: [] });
    expect(recovery.baseline.tables.products[0]).toMatchObject({ id: "P-1", workspaceId, name: "商品" });
    expect(recovery.baseline.tables.workspaces[0]).toMatchObject({ selectionStatusDefinitions: [{ id: "testing", label: "测品" }] });
    expect(db.calls[0]).toContain("repeatable read");
    expect(db.calls.at(-1)).toBe("commit");
  });

  it("restores applied and voided inbox lifecycles with their formal batches", async () => {
    for (const status of ["published", "voided"]) {
      const recovery = await loadPostgresRecovery(workspaceId, { client: lifecycleClient(status), now: () => "2026-08-28T00:00:01.000Z" });
      const tables = replaySyncRecoveryPayload(recovery).tables;
      expect(tables.erpCostBatches).toMatchObject([{ id: "C-1", status }]);
      expect(tables.erpCostInbox).toMatchObject([{
        id: "INBOX-1",
        status: status === "published" ? "applied" : "voided",
        appliedBatchId: "C-1",
      }]);
      expect(tables.erpCostRows).toHaveLength(1);
      expect(tables.profitLines).toEqual([]);
    }
  });

  it("rolls back if any baseline query fails", async () => {
    const db = client({ fail: true });
    await expect(loadPostgresRecovery(workspaceId, { client: db })).rejects.toThrow("read failed");
    expect(db.calls.at(-1)).toBe("rollback");
  });
});
