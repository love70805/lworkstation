import { describe, expect, it, vi } from "vitest";
import { buildCloudSeedPayload } from "./cloudSeed";
import { buildCloudSeedPostgresPlan, importCloudSeedWithPostgresClient } from "./cloudSeedPostgresPlan";

function seed({ catalogManualCosts = [] } = {}) {
  return buildCloudSeedPayload({
    format: "shopeers-local-backup",
    formatVersion: 1,
    workspaceId: "workspace-default",
    tables: {
      workspaces: [{ id: "workspace-default", name: "默认工作区", defaultCurrency: "CNY" }],
      products: [{ id: "P-1", workspaceId: "workspace-default", name: "商品", currency: "CNY" }],
      platformSkus: [], supplierOffers: [], catalogManualCosts, captures: [], ledgers: [], importBatches: [], salesRows: [],
      erpCostRequests: [], erpCostBatches: [], erpCostRows: [], costApprovals: [], profitLines: [], auditEvents: [], settings: [],
    },
  });
}

describe("cloud seed postgres plan", () => {
  it("按外键顺序生成参数化 SQL，且不使用拼接值", async () => {
    const plan = await buildCloudSeedPostgresPlan(seed(), { workspaceMember: { userId: "user-1", role: "admin" } });
    expect(plan.operations.map((item) => item.table)).toEqual(["workspaces", "workspace_members", "products"]);
    expect(plan.operations[0].text).toContain("insert into public.workspaces");
    expect(plan.operations[0].text).toContain("$1");
    expect(plan.operations[0].values).toContain("默认工作区");
    expect(plan.operations[0].text).not.toContain("默认工作区");
  });

  it("将工作区销售状态配置作为 JSON 参数写入云端", async () => {
    const source = seed();
    source.tables.workspaces[0].selectionStatusDefinitions = [{ id: "testing", label: "测品" }];
    const plan = await buildCloudSeedPostgresPlan(source, { workspaceMember: { userId: "user-1", role: "admin" } });
    const operation = plan.operations.find((item) => item.table === "workspaces");
    expect(operation.text).toContain("selection_status_definitions");
    expect(operation.values).toContain(source.tables.workspaces[0].selectionStatusDefinitions);
  });

  it("提交成功时 commit，失败时 rollback", async () => {
    const calls = [];
    const client = { query: vi.fn(async (text) => { calls.push(text); if (text.startsWith("insert into public.products")) throw new Error("db down"); }) };
    await expect(importCloudSeedWithPostgresClient(seed(), { client, workspaceMember: { userId: "user-1", role: "admin" } })).rejects.toThrow("db down");
    expect(calls).toEqual(["begin", expect.stringContaining("insert into public.workspaces"), expect.stringContaining("workspace_members"), expect.stringContaining("insert into public.products"), "rollback"]);

    const successful = { query: vi.fn(async (text) => { calls.push(text); }) };
    const result = await importCloudSeedWithPostgresClient(seed(), { client: successful, workspaceMember: { userId: "user-1", role: "admin" } });
    expect(result).toMatchObject({ transaction: "committed", insertedCount: 2, membershipBootstrapped: true });
    expect(successful.query.mock.calls.at(-1)[0]).toBe("commit");
  });

  it("没有成员上下文时拒绝导入，避免 RLS 下产生不可访问工作区", async () => {
    await expect(importCloudSeedWithPostgresClient(seed(), { client: { query: vi.fn() } })).rejects.toThrow("管理员 userId");
  });

  it("写入 SKU 级人工确认成本时保持参数化字段映射", async () => {
    const source = seed({ catalogManualCosts: [{
      id: "MC-1", workspaceId: "workspace-default", productId: "P-1", platformSkuId: "PS-1",
      platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", amount: 8.5, currency: "CNY",
      kind: "manual_confirmed", status: "active", confirmedBy: "user-1", confirmedAt: "2026-08-10T00:00:00.000Z",
    }] });
    source.tables.platformSkus.push({ id: "PS-1", workspaceId: "workspace-default", productId: "P-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1" });
    const plan = await buildCloudSeedPostgresPlan(source, { workspaceMember: { userId: "user-1", role: "admin" } });
    const operation = plan.operations.find((item) => item.table === "catalogManualCosts");
    expect(operation.text).toContain("insert into public.catalog_manual_costs");
    expect(operation.values).toContain(8.5);
    expect(operation.text).not.toContain("8.5");
  });

  it("保留供应商报价版本状态和报价键到云端导入计划", async () => {
    const source = seed();
    source.tables.platformSkus.push({ id: "PS-1", workspaceId: "workspace-default", productId: "P-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1" });
    source.tables.supplierOffers.push({
      id: "OFFER-OLD", workspaceId: "workspace-default", productId: "P-1", platformSkuId: "PS-1",
      platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", supplierId: "SUP-1", offerKey: "P-1\u001fSUP-1\u001fSKU-1",
      purchaseUnitPrice: 10, landedUnitCost: 10, referenceUnitCost: 10, currency: "CNY", status: "superseded", supersededAt: "2026-08-10T00:00:00.000Z",
    });
    const plan = await buildCloudSeedPostgresPlan(source, { workspaceMember: { userId: "user-1", role: "admin" } });
    const operation = plan.operations.find((item) => item.table === "supplierOffers");
    expect(operation.text).toContain("offer_key");
    expect(operation.values).toContain("superseded");
    expect(operation.values).toContain("P-1\u001fSUP-1\u001fSKU-1");
  });

  it("保留商品发布状态和 SKU 仓库映射到云端种子计划", async () => {
    const source = seed();
    source.tables.products[0].salesPlatform = "SHEIN";
    source.tables.products[0].publicationStatus = "approved_pending_listing";
    source.tables.platformSkus.push({
      id: "PS-1", workspaceId: "workspace-default", productId: "P-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1",
      warehouseSku: "WH-TRAFFIC-01", canonicalWarehouseSku: "WH-TRAFFIC-01",
    });
    const plan = await buildCloudSeedPostgresPlan(source, { workspaceMember: { userId: "user-1", role: "admin" } });
    const product = plan.operations.find((item) => item.table === "products");
    const sku = plan.operations.find((item) => item.table === "platformSkus");
    expect(product.text).toContain("publication_status");
    expect(product.values).toContain("approved_pending_listing");
    expect(sku.text).toContain("canonical_warehouse_sku");
    expect(sku.values).toContain("WH-TRAFFIC-01");
  });

  it("按正式批次之后的顺序持久化 applied inbox 及完整 envelope", async () => {
    const source = seed();
    source.tables.ledgers.push({ id: "L-1", workspaceId: "workspace-default", period: "2026-08", status: "cost_pending", currency: "CNY" });
    source.tables.erpCostBatches.push({ id: "C-1", workspaceId: "workspace-default", ledgerId: "L-1", status: "published", currency: "CNY" });
    source.tables.erpCostInbox.push({
      id: "INBOX-1", workspaceId: "workspace-default", deliveryId: "D-1", batchId: "SOURCE-1",
      ledgerId: "L-1", status: "applied", receivedVia: "cloud-seed", receivedAt: "2026-08-28T00:00:00.000Z",
      envelope: { format: "shopeers-erp-cost-inbox", formatVersion: 2, batch: { batchId: "SOURCE-1" } },
      appliedBatchId: "C-1", appliedAt: "2026-08-28T00:00:00.000Z",
    });
    const plan = await buildCloudSeedPostgresPlan(source, { workspaceMember: { userId: "user-1", role: "admin" } });
    const batchIndex = plan.operations.findIndex((item) => item.table === "erpCostBatches");
    const inboxIndex = plan.operations.findIndex((item) => item.table === "erpCostInbox");
    expect(inboxIndex).toBeGreaterThan(batchIndex);
    expect(plan.operations[inboxIndex].text).toContain("insert into public.erp_cost_inbox");
    expect(plan.operations[inboxIndex].values).toContain(source.tables.erpCostInbox[0].envelope);
    expect(plan.operations[inboxIndex].values).toContain("C-1");
  });

  it("持久化完整 voided 元数据且保持正式批次与 inbox 一对一", async () => {
    const source = seed();
    const voidedAt = "2026-08-28T01:00:00.000Z";
    source.tables.ledgers.push({ id: "L-1", workspaceId: "workspace-default", period: "2026-08", status: "cost_pending", currency: "CNY" });
    source.tables.erpCostBatches.push({
      id: "C-1", workspaceId: "workspace-default", ledgerId: "L-1", status: "voided", currency: "CNY",
      voidedAt, voidedBy: "finance-1", voidReason: "采购证据错误",
    });
    source.tables.erpCostInbox.push({
      id: "INBOX-1", workspaceId: "workspace-default", deliveryId: "D-1", batchId: "SOURCE-1",
      ledgerId: "L-1", status: "voided", receivedVia: "cloud-seed", receivedAt: "2026-08-28T00:00:00.000Z",
      envelope: { format: "shopeers-erp-cost-inbox", formatVersion: 2 }, appliedBatchId: "C-1", voidedBatchId: "C-1",
      appliedAt: "2026-08-28T00:30:00.000Z", voidedAt, voidedBy: "finance-1", voidReason: "采购证据错误",
    });
    const plan = await buildCloudSeedPostgresPlan(source, { workspaceMember: { userId: "user-1", role: "admin" } });
    const batch = plan.operations.find((item) => item.table === "erpCostBatches");
    const inbox = plan.operations.find((item) => item.table === "erpCostInbox");
    expect(batch.text).toContain("voided_at");
    expect(batch.values).toEqual(expect.arrayContaining([voidedAt, "finance-1", "采购证据错误"]));
    expect(inbox.values).toEqual(expect.arrayContaining(["C-1", voidedAt, "finance-1", "采购证据错误"]));
  });
});
