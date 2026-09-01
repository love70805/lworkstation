import { describe, expect, it } from "vitest";
import { buildCloudSeedPayload } from "./cloudSeed";
import {
  CLOUD_SEED_IMPORT_ACK_FORMAT,
  CLOUD_SEED_PREFLIGHT_FORMAT,
  createCloudSeedImportStore,
  inspectCloudSeedRelations,
} from "./cloudSeedImportContract";

function seedWith({ products = [], platformSkus = [], catalogManualCosts = [], ledgers = [], salesRows = [], importBatches = [], erpCostRequests = [], erpCostBatches = [], erpCostRows = [], erpCostInbox = [] } = {}) {
  return buildCloudSeedPayload({
    format: "shopeers-local-backup",
    formatVersion: 1,
    workspaceId: "workspace-default",
    generatedAt: "2026-08-07T00:00:00.000Z",
    tables: {
      workspaces: [{ id: "workspace-default", name: "默认工作区", defaultCurrency: "CNY" }],
      products,
      platformSkus,
      supplierOffers: [],
      catalogManualCosts,
      captures: [],
      ledgers,
      importBatches,
      salesRows,
      erpCostRequests,
      erpCostBatches,
      erpCostRows,
      erpCostInbox,
      costApprovals: [],
      profitLines: [],
      auditEvents: [],
      settings: [],
    },
  }, { generatedAt: "2026-08-07T01:00:00.000Z" });
}

describe("cloud seed import contract", () => {
  it("预检后整批导入，并对同一业务内容保持幂等", async () => {
    const seed = seedWith({ products: [{ id: "P-1", workspaceId: "workspace-default", name: "商品 A", currency: "CNY" }] });
    const store = createCloudSeedImportStore();
    const preflight = store.preflight(seed);
    expect(preflight).toMatchObject({ format: CLOUD_SEED_PREFLIGHT_FORMAT, canImport: true, insertCount: 2, conflictCount: 0 });

    const ack = await store.commit(seed, { preflightId: preflight.preflightId });
    expect(ack).toMatchObject({ format: CLOUD_SEED_IMPORT_ACK_FORMAT, insertedCount: 2, idempotent: false });

    const secondPreflight = store.preflight({ ...seed, generatedAt: "2026-08-07T02:00:00.000Z" });
    const secondAck = await store.commit(seed, { preflightId: secondPreflight.preflightId });
    expect(secondPreflight.idempotent).toBe(true);
    expect(secondAck.idempotent).toBe(true);
    expect(store.snapshot("workspace-default").workspaces[0].tableCounts.products).toBe(1);
  });

  it("报告主键冲突并且不写入冲突批次", async () => {
    const store = createCloudSeedImportStore();
    const original = seedWith({ products: [{ id: "P-1", workspaceId: "workspace-default", name: "原商品", currency: "CNY" }] });
    const first = store.preflight(original);
    await store.commit(original, { preflightId: first.preflightId });

    const changed = seedWith({ products: [{ id: "P-1", workspaceId: "workspace-default", name: "冲突商品", currency: "CNY" }] });
    const report = store.preflight(changed);
    expect(report).toMatchObject({ canImport: false, conflictCount: 1 });
    await expect(store.commit(changed, { preflightId: report.preflightId })).rejects.toMatchObject({ code: "SEED_CONFLICT", status: 409 });
    expect(store.snapshot("workspace-default").workspaces[0].tableCounts.products).toBe(1);
  });

  it("拒绝断裂引用和未授权工作区", () => {
    const broken = seedWith({
      ledgers: [{ id: "L-1", workspaceId: "workspace-default", period: "2026-07", currency: "CNY" }],
      importBatches: [{ id: "B-1", workspaceId: "workspace-default", ledgerId: "L-1", period: "2026-07" }],
      salesRows: [{ id: 1, workspaceId: "workspace-default", ledgerId: "L-1", batchId: "missing" }],
    });
    expect(() => inspectCloudSeedRelations(broken)).toThrow("销售明细导入批次引用不存在");

    const store = createCloudSeedImportStore({ authorize: () => false });
    expect(() => store.preflight(seedWith())).toThrow("无权迁移");
  });

  it("正式 ERP 批次必须具备同状态的可审计 inbox 生命周期", () => {
    const ledger = { id: "L-1", workspaceId: "workspace-default", period: "2026-07", currency: "CNY" };
    const batch = { id: "C-1", workspaceId: "workspace-default", ledgerId: "L-1", status: "published", currency: "CNY" };
    const legacy = seedWith({ ledgers: [ledger], erpCostBatches: [batch] });
    expect(() => inspectCloudSeedRelations(legacy)).toThrow("缺少 applied 收件生命周期记录");

    const complete = seedWith({
      ledgers: [ledger],
      erpCostBatches: [batch],
      erpCostInbox: [{
        id: "INBOX-1", workspaceId: "workspace-default", deliveryId: "D-1", batchId: "SOURCE-1",
        ledgerId: "L-1", status: "applied", receivedVia: "cloud", receivedAt: "2026-08-27T00:00:00.000Z",
        envelope: { format: "shopeers-erp-cost-inbox", formatVersion: 2 }, appliedBatchId: "C-1", appliedAt: "2026-08-27T00:00:00.000Z",
      }],
    });
    expect(() => inspectCloudSeedRelations(complete)).not.toThrow();
  });

  it("拒绝缺少完整作废元数据或重复关联正式批次的云端生命周期", () => {
    const ledger = { id: "L-1", workspaceId: "workspace-default", period: "2026-07", currency: "CNY" };
    const batch = {
      id: "C-1", workspaceId: "workspace-default", ledgerId: "L-1", status: "voided", currency: "CNY",
      voidedAt: "2026-08-27T01:00:00.000Z", voidedBy: "finance-1", voidReason: "成本错误",
    };
    const inbox = {
      id: "INBOX-1", workspaceId: "workspace-default", deliveryId: "D-1", batchId: "SOURCE-1",
      ledgerId: "L-1", status: "voided", receivedVia: "cloud", receivedAt: "2026-08-27T00:00:00.000Z",
      envelope: { format: "shopeers-erp-cost-inbox", formatVersion: 2 }, appliedBatchId: "C-1",
      voidedBatchId: "C-1", appliedAt: "2026-08-27T00:30:00.000Z", voidedAt: "2026-08-27T01:00:00.000Z",
      voidedBy: "finance-1", voidReason: "成本错误",
    };
    const valid = seedWith({ ledgers: [ledger], erpCostBatches: [batch], erpCostInbox: [inbox] });
    expect(() => inspectCloudSeedRelations(valid)).not.toThrow();

    for (const [container, field] of [
      ["erpCostInbox", "voidedAt"],
      ["erpCostInbox", "voidedBy"],
      ["erpCostInbox", "voidReason"],
      ["erpCostBatches", "voidedAt"],
      ["erpCostBatches", "voidedBy"],
      ["erpCostBatches", "voidReason"],
    ]) {
      const invalid = structuredClone(valid);
      delete invalid.tables[container][0][field];
      expect(() => inspectCloudSeedRelations(invalid)).toThrow();
    }

    const mismatched = structuredClone(valid);
    mismatched.tables.erpCostInbox[0].voidReason = "另一原因";
    expect(() => inspectCloudSeedRelations(mismatched)).toThrow("作废元数据不一致");

    const duplicate = structuredClone(valid);
    duplicate.tables.erpCostInbox.push({ ...structuredClone(inbox), id: "INBOX-2", deliveryId: "D-2" });
    expect(() => inspectCloudSeedRelations(duplicate)).toThrow("关联了多个收件记录");
  });

  it("要求人工确认成本准确关联商品和平台 SKU", () => {
    const product = { id: "P-1", workspaceId: "workspace-default", name: "商品 A", currency: "CNY" };
    const sku = { id: "PS-1", workspaceId: "workspace-default", productId: "P-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1" };
    const valid = seedWith({
      products: [product], platformSkus: [sku],
      catalogManualCosts: [{ id: "MC-1", workspaceId: "workspace-default", productId: "P-1", platformSkuId: "PS-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", amount: 8, currency: "CNY", status: "active" }],
    });
    expect(() => inspectCloudSeedRelations(valid)).not.toThrow();

    const broken = structuredClone(valid);
    broken.tables.catalogManualCosts[0].platformSku = "SKU-OTHER";
    expect(() => inspectCloudSeedRelations(broken)).toThrow("平台 SKU 标识不一致");
  });

  it("提交阶段失败时整批回滚", async () => {
    const store = createCloudSeedImportStore({ beforeCommit: () => { throw new Error("模拟数据库故障"); } });
    const seed = seedWith({ products: [{ id: "P-1", workspaceId: "workspace-default", name: "商品 A", currency: "CNY" }] });
    const report = store.preflight(seed);
    await expect(store.commit(seed, { preflightId: report.preflightId })).rejects.toThrow("模拟数据库故障");
    expect(store.snapshot().workspaceCount).toBe(0);
  });

  it("预检后工作区发生变化时要求重新预检", async () => {
    const store = createCloudSeedImportStore();
    const seedA = seedWith({ products: [{ id: "P-A", workspaceId: "workspace-default", name: "A", currency: "CNY" }] });
    const seedB = seedWith({ products: [{ id: "P-B", workspaceId: "workspace-default", name: "B", currency: "CNY" }] });
    const reportA = store.preflight(seedA);
    const reportB = store.preflight(seedB);
    await store.commit(seedB, { preflightId: reportB.preflightId });
    await expect(store.commit(seedA, { preflightId: reportA.preflightId })).rejects.toMatchObject({ code: "PREFLIGHT_STALE", retryable: true });
  });
});
