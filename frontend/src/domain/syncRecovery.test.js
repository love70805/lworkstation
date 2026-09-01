import { describe, expect, it } from "vitest";
import {
  buildSyncRecoveryPayload,
  replaySyncRecoveryPayload,
  validateSyncRecoveryPayload,
} from "./syncRecovery";
import { CLOUD_SEED_FORMAT, CLOUD_SEED_VERSION } from "./cloudSeed";
import { buildErpVoidTransitionId } from "./syncLifecycleGroup";

function event(eventId, action, objectId, snapshot = null) {
  return {
    eventId,
    workspaceId: "workspace-default",
    objectType: action.startsWith("product_") ? "product" : "monthly_ledger",
    objectId,
    action,
    actorId: "user-1",
    createdAt: `2026-08-07T08:00:0${eventId}.000Z`,
    after: snapshot == null ? null : { snapshot },
  };
}

function inbox(batchId, status = "applied") {
  return {
    id: `INBOX-${batchId}`,
    workspaceId: "workspace-default",
    deliveryId: `DELIVERY-${batchId}`,
    batchId: `SOURCE-${batchId}`,
    ledgerId: "L-1",
    status,
    receivedVia: "browser-message",
    receivedAt: "2026-08-07T08:00:00.000Z",
    envelope: { format: "shopeers-erp-cost-inbox", formatVersion: 2 },
    appliedBatchId: batchId,
    appliedAt: "2026-08-07T08:00:01.000Z",
    ...(status === "voided" ? { voidedBatchId: batchId, voidedAt: "2026-08-07T08:00:03.000Z", voidedBy: "finance-1", voidReason: "成本错误" } : {}),
  };
}

function recoveryVoidPair({ legacy = false } = {}) {
  const batchId = "C-1";
  const ledgerId = "L-1";
  const actorId = "finance-1";
  const reason = "成本错误";
  const occurredAt = "2026-08-07T08:00:03.000Z";
  const transitionId = buildErpVoidTransitionId({ batchId, ledgerId, voidedAt: occurredAt });
  const voided = event("3", "voided", batchId, {
    costBatch: { id: batchId, workspaceId: "workspace-default", ledgerId, status: "voided", currency: "CNY", voidedAt: occurredAt, voidedBy: actorId, voidReason: reason },
    inbox: inbox(batchId, "voided"),
    ledger: { id: ledgerId, workspaceId: "workspace-default", period: "2026-07", status: "cost_pending", currency: "CNY" },
  });
  voided.objectType = "erp_cost_batch";
  voided.actorId = actorId;
  voided.createdAt = occurredAt;
  Object.assign(voided.after, { reason });
  const reopened = event("4", "reopened_for_cost_recalculation", ledgerId, {
    id: ledgerId, workspaceId: "workspace-default", period: "2026-07", status: "cost_pending", currency: "CNY",
  });
  reopened.actorId = actorId;
  reopened.createdAt = occurredAt;
  Object.assign(reopened.after, { reason });
  if (!legacy) {
    Object.assign(voided.after, { transitionId, voidedBatchId: batchId });
    Object.assign(reopened.after, { transitionId, voidedBatchId: batchId });
  }
  return { voided, reopened };
}

describe("sync recovery contract", () => {
  it("replays composite product, sales, cost and finalized profit facts", () => {
    const events = [
      event("1", "product_created", "P-1", {
        product: { id: "P-1", workspaceId: "workspace-default", name: "测试商品", currency: "CNY" },
        platformSkus: [{ id: "SKU-1", workspaceId: "workspace-default", productId: "P-1", platformSku: "SKU-A" }],
        supplierOffers: [{ id: "O-1", workspaceId: "workspace-default", productId: "P-1", platformSku: "SKU-A", currency: "CNY" }],
      }),
      event("2", "created", "L-1", { id: "L-1", workspaceId: "workspace-default", period: "2026-07", status: "draft", currency: "CNY" }),
      event("3", "imported", "I-1", {
        importBatch: { id: "I-1", workspaceId: "workspace-default", ledgerId: "L-1" },
        salesRows: [{ id: 1, workspaceId: "workspace-default", ledgerId: "L-1", batchId: "I-1", groupKey: "G-1", platformSku: "SKU-A" }],
        ledger: { id: "L-1", workspaceId: "workspace-default", period: "2026-07", status: "cost_pending", currency: "CNY" },
      }),
      event("4", "published", "C-1", {
        costBatch: { id: "C-1", workspaceId: "workspace-default", ledgerId: "L-1", status: "published", currency: "CNY" },
        rows: [{ id: 1, workspaceId: "workspace-default", batchId: "C-1", ledgerId: "L-1", platformSku: "SKU-A", unitCost: 4, currency: "CNY" }],
        inbox: inbox("C-1"),
        ledger: { id: "L-1", workspaceId: "workspace-default", period: "2026-07", status: "ready_to_finalize", currency: "CNY" },
      }),
      event("5", "finalized", "L-1", {
        id: "L-1",
        workspaceId: "workspace-default",
        period: "2026-07",
        status: "finalized",
        currency: "CNY",
        profitLines: [{ id: 1, workspaceId: "workspace-default", ledgerId: "L-1", platformSku: "SKU-A", costSource: "erp", calculationMode: "exact", profit: 10 }],
      }),
    ];
    const payload = buildSyncRecoveryPayload({ workspaceId: "workspace-default", events, cursor: "cloud-5" });
    expect(validateSyncRecoveryPayload(payload)).toMatchObject({ eventCount: 5, cursor: "cloud-5" });
    expect(replaySyncRecoveryPayload(payload).tables).toMatchObject({
      products: [{ id: "P-1" }],
      platformSkus: [{ id: "SKU-1", platformSku: "SKU-A" }],
      salesRows: [{ ledgerId: "L-1", groupKey: "G-1" }],
      erpCostRows: [{ ledgerId: "L-1", unitCost: 4 }],
      erpCostInbox: [{ id: "INBOX-C-1", status: "applied", appliedBatchId: "C-1" }],
      ledgers: [{ id: "L-1", status: "finalized" }],
      profitLines: [{ ledgerId: "L-1", profit: 10 }],
    });
  });

  it("replays void and reopen events without restoring published or finalized state", () => {
    const published = event("1", "published", "C-1", {
      costBatch: { id: "C-1", workspaceId: "workspace-default", ledgerId: "L-1", status: "published", currency: "CNY" },
      rows: [{ id: 1, workspaceId: "workspace-default", batchId: "C-1", ledgerId: "L-1", platformSku: "SKU-A", unitCost: 4, currency: "CNY" }],
      inbox: inbox("C-1"),
      ledger: { id: "L-1", workspaceId: "workspace-default", period: "2026-07", status: "ready_to_finalize", currency: "CNY" },
    });
    published.objectType = "erp_cost_batch";
    const finalized = event("2", "finalized", "L-1", {
      id: "L-1", workspaceId: "workspace-default", period: "2026-07", status: "finalized", currency: "CNY",
      profitLines: [{ id: 1, workspaceId: "workspace-default", ledgerId: "L-1", platformSku: "SKU-A", profit: 10 }],
    });
    const { voided, reopened } = recoveryVoidPair({ legacy: true });
    const tables = replaySyncRecoveryPayload(buildSyncRecoveryPayload({ workspaceId: "workspace-default", events: [published, finalized, voided, reopened] })).tables;
    expect(tables.erpCostBatches).toMatchObject([{ id: "C-1", status: "voided" }]);
    expect(tables.erpCostRows).toHaveLength(1);
    expect(tables.erpCostInbox).toMatchObject([{ id: "INBOX-C-1", status: "voided", appliedBatchId: "C-1" }]);
    expect(tables.ledgers).toMatchObject([{ id: "L-1", status: "cost_pending" }]);
    expect(tables.profitLines).toEqual([]);
  });

  it("replays a strict new-format void/reopen pair", () => {
    const { voided, reopened } = recoveryVoidPair();
    const tables = replaySyncRecoveryPayload(buildSyncRecoveryPayload({ workspaceId: "workspace-default", events: [voided, reopened] })).tables;
    expect(tables.erpCostBatches).toMatchObject([{ id: "C-1", status: "voided" }]);
    expect(tables.ledgers).toMatchObject([{ id: "L-1", status: "cost_pending" }]);
  });

  it.each([
    ["missing transition", ({ reopened }) => { delete reopened.after.transitionId; }],
    ["missing actor", ({ reopened }) => { delete reopened.actorId; }],
    ["batch", ({ reopened }) => { reopened.after.voidedBatchId = "C-OTHER"; }],
    ["ledger", ({ reopened }) => { reopened.objectId = "L-OTHER"; reopened.after.snapshot.id = "L-OTHER"; }],
    ["actor", ({ reopened }) => { reopened.actorId = "finance-other"; }],
    ["reason", ({ reopened }) => { reopened.after.reason = "另一原因"; }],
    ["time", ({ reopened }) => { reopened.createdAt = "2026-08-07T08:00:04.000Z"; }],
  ])("rejects a new-format recovery pair with mismatched %s", (_label, mutate) => {
    const pair = recoveryVoidPair();
    mutate(pair);
    expect(() => replaySyncRecoveryPayload(buildSyncRecoveryPayload({
      workspaceId: "workspace-default",
      events: [pair.voided, pair.reopened],
    }))).toThrow("作废与重开");
  });

  it("rejects an ambiguous legacy recovery pair", () => {
    const pair = recoveryVoidPair({ legacy: true });
    pair.reopened.actorId = "finance-other";
    expect(() => replaySyncRecoveryPayload(buildSyncRecoveryPayload({
      workspaceId: "workspace-default",
      events: [pair.voided, pair.reopened],
    }))).toThrow("作废与重开");
  });

  it("rejects a legacy recovery pair when the raw payload omitted an actor", () => {
    const pair = recoveryVoidPair({ legacy: true });
    delete pair.reopened.actorId;
    expect(() => buildSyncRecoveryPayload({
      workspaceId: "workspace-default",
      events: [pair.voided, pair.reopened],
    })).toThrow("作废与重开");
  });

  it("fails closed when a legacy formal-cost event lacks its applied inbox snapshot", () => {
    const legacyPublished = event("1", "published", "C-LEGACY", {
      costBatch: { id: "C-LEGACY", workspaceId: "workspace-default", ledgerId: "L-1", status: "published", currency: "CNY" },
      rows: [],
      ledger: { id: "L-1", workspaceId: "workspace-default", period: "2026-07", status: "ready", currency: "CNY" },
    });
    legacyPublished.objectType = "erp_cost_batch";
    const payload = buildSyncRecoveryPayload({ workspaceId: "workspace-default", events: [legacyPublished] });
    expect(() => replaySyncRecoveryPayload(payload)).toThrow("缺少 applied 收件生命周期快照");
  });

  it("fails closed when an incremental void lifecycle omits any required metadata", () => {
    const makePayload = () => {
      const { voided } = recoveryVoidPair();
      return buildSyncRecoveryPayload({ workspaceId: "workspace-default", events: [voided] });
    };
    for (const [container, field] of [["inbox", "voidedAt"], ["inbox", "voidedBy"], ["inbox", "voidReason"], ["costBatch", "voidedAt"], ["costBatch", "voidedBy"], ["costBatch", "voidReason"]]) {
      const payload = makePayload();
      delete payload.events[0].after.snapshot[container][field];
      expect(() => replaySyncRecoveryPayload(payload)).toThrow("作废与重开事件不一致");
    }
    const mismatched = makePayload();
    mismatched.events[0].after.snapshot.inbox.voidReason = "另一原因";
    expect(() => replaySyncRecoveryPayload(mismatched)).toThrow("作废与重开事件不一致");
  });

  it("removes every dependent ledger fact when a delete event is replayed", () => {
    const payload = buildSyncRecoveryPayload({
      workspaceId: "workspace-default",
      events: [
        event("1", "created", "L-1", { id: "L-1", workspaceId: "workspace-default", period: "2026-07", currency: "CNY" }),
        event("2", "imported", "I-1", {
          importBatch: { id: "I-1", workspaceId: "workspace-default", ledgerId: "L-1" },
          salesRows: [{ id: 1, workspaceId: "workspace-default", ledgerId: "L-1", batchId: "I-1", groupKey: "G-1" }],
          ledger: { id: "L-1", workspaceId: "workspace-default", period: "2026-07", currency: "CNY" },
        }),
        event("3", "deleted", "L-1"),
      ],
    });
    const tables = replaySyncRecoveryPayload(payload).tables;
    expect(tables.ledgers).toEqual([]);
    expect(tables.importBatches).toEqual([]);
    expect(tables.salesRows).toEqual([]);
  });

  it("rejects a stale delete recovery event once formal ERP lifecycle evidence exists", () => {
    const published = event("1", "published", "C-1", {
      costBatch: { id: "C-1", workspaceId: "workspace-default", ledgerId: "L-1", status: "published", currency: "CNY" },
      rows: [],
      inbox: inbox("C-1"),
      ledger: { id: "L-1", workspaceId: "workspace-default", period: "2026-07", status: "ready", currency: "CNY" },
    });
    published.objectType = "erp_cost_batch";
    const payload = buildSyncRecoveryPayload({ workspaceId: "workspace-default", events: [published, event("2", "deleted", "L-1")] });
    expect(() => replaySyncRecoveryPayload(payload)).toThrow("不能通过恢复事件物理删除");
  });

  it("replays a duplicate-SKC merge without leaving source SKU or cost records behind", () => {
    const primarySnapshot = {
      product: { id: "P-PRIMARY", workspaceId: "workspace-default", name: "主档", currency: "CNY" },
      platformSkus: [
        { id: "SKU-PRIMARY", workspaceId: "workspace-default", productId: "P-PRIMARY", platformSku: "SKU-A" },
        { id: "SKU-SOURCE", workspaceId: "workspace-default", productId: "P-PRIMARY", platformSku: "SKU-B" },
      ],
      supplierOffers: [
        { id: "O-PRIMARY", workspaceId: "workspace-default", productId: "P-PRIMARY", platformSkuId: "SKU-PRIMARY", platformSku: "SKU-A", currency: "CNY" },
        { id: "O-SOURCE", workspaceId: "workspace-default", productId: "P-PRIMARY", platformSkuId: "SKU-SOURCE", platformSku: "SKU-B", currency: "CNY" },
      ],
    };
    const payload = buildSyncRecoveryPayload({
      workspaceId: "workspace-default",
      events: [
        event("1", "product_created", "P-PRIMARY", {
          product: { id: "P-PRIMARY", workspaceId: "workspace-default", name: "主档", currency: "CNY" },
          platformSkus: [{ id: "SKU-PRIMARY", workspaceId: "workspace-default", productId: "P-PRIMARY", platformSku: "SKU-A" }],
          supplierOffers: [{ id: "O-PRIMARY", workspaceId: "workspace-default", productId: "P-PRIMARY", platformSkuId: "SKU-PRIMARY", platformSku: "SKU-A", currency: "CNY" }],
        }),
        event("2", "product_created", "P-SOURCE", {
          product: { id: "P-SOURCE", workspaceId: "workspace-default", name: "来源档", currency: "CNY" },
          platformSkus: [{ id: "SKU-SOURCE", workspaceId: "workspace-default", productId: "P-SOURCE", platformSku: "SKU-B" }],
          supplierOffers: [{ id: "O-SOURCE", workspaceId: "workspace-default", productId: "P-SOURCE", platformSkuId: "SKU-SOURCE", platformSku: "SKU-B", currency: "CNY" }],
        }),
        event("3", "catalog_manual_cost_confirmed", "MC-SOURCE", {
          catalogManualCost: { id: "MC-SOURCE", workspaceId: "workspace-default", productId: "P-SOURCE", platformSkuId: "SKU-SOURCE", platformSku: "SKU-B", canonicalPlatformSku: "SKU-B", amount: 9, status: "active", currency: "CNY" },
        }),
        event("4", "product_deleted", "P-SOURCE"),
        event("5", "product_merged", "P-PRIMARY", primarySnapshot),
        event("6", "catalog_manual_cost_relinked", "MC-SOURCE", {
          catalogManualCost: { id: "MC-SOURCE", workspaceId: "workspace-default", productId: "P-PRIMARY", platformSkuId: "SKU-SOURCE", platformSku: "SKU-B", canonicalPlatformSku: "SKU-B", amount: 9, status: "active", currency: "CNY" },
        }),
      ],
    });
    const tables = replaySyncRecoveryPayload(payload).tables;
    expect(tables.products.map((row) => row.id)).toEqual(["P-PRIMARY"]);
    expect(tables.platformSkus).toHaveLength(2);
    expect(tables.platformSkus.every((row) => row.productId === "P-PRIMARY")).toBe(true);
    expect(tables.supplierOffers.every((row) => row.productId === "P-PRIMARY")).toBe(true);
    expect(tables.catalogManualCosts).toMatchObject([{ id: "MC-SOURCE", productId: "P-PRIMARY", platformSkuId: "SKU-SOURCE" }]);
  });

  it("replays a catalog-confirmed cost and supersedes the older active SKU cost", () => {
    const baseline = {
      format: CLOUD_SEED_FORMAT,
      formatVersion: CLOUD_SEED_VERSION,
      workspaceId: "workspace-default",
      currency: "CNY",
      generatedAt: "2026-08-09T08:00:00.000Z",
      tables: {
        workspaces: [{ id: "workspace-default", name: "工作区", defaultCurrency: "CNY" }],
        products: [{ id: "P-1", workspaceId: "workspace-default", name: "商品", currency: "CNY" }],
        platformSkus: [{ id: "PS-1", workspaceId: "workspace-default", productId: "P-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1" }],
        catalogManualCosts: [{ id: "MC-OLD", workspaceId: "workspace-default", productId: "P-1", platformSkuId: "PS-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", amount: 8, currency: "CNY", status: "active", confirmedAt: "2026-08-09T08:00:00.000Z" }],
      },
    };
    const payload = buildSyncRecoveryPayload({
      workspaceId: "workspace-default",
      baseline,
      events: [event("1", "catalog_manual_cost_confirmed", "MC-NEW", {
        catalogManualCost: { id: "MC-NEW", workspaceId: "workspace-default", productId: "P-1", platformSkuId: "PS-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", amount: 8.5, currency: "CNY", status: "active", confirmedAt: "2026-08-10T08:00:00.000Z" },
      })],
    });
    const costs = replaySyncRecoveryPayload(payload).tables.catalogManualCosts;
    expect(costs.find((cost) => cost.id === "MC-OLD")).toMatchObject({ status: "superseded" });
    expect(costs.find((cost) => cost.id === "MC-NEW")).toMatchObject({ status: "active", amount: 8.5 });
  });

  it("replays a workspace sales-status configuration update", () => {
    const definitions = [{ id: "testing", label: "测品", tone: "blue", requiresReadiness: false }];
    const payload = buildSyncRecoveryPayload({
      workspaceId: "workspace-default",
      events: [{
        eventId: "STATUS-1", workspaceId: "workspace-default", objectType: "selection_status_definitions",
        objectId: "workspace-default", action: "selection_status_definitions_updated", actorId: "user-1",
        createdAt: "2026-08-10T08:00:00.000Z",
        after: { snapshot: { id: "workspace-default", name: "工作区", defaultCurrency: "CNY", timezone: "Asia/Shanghai", selectionStatusDefinitions: definitions, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-10T08:00:00.000Z" } },
      }],
    });
    expect(replaySyncRecoveryPayload(payload).tables.workspaces[0]).toMatchObject({ selectionStatusDefinitions: definitions });
  });

  it("rejects legacy business events that only contain summaries", () => {
    expect(() => buildSyncRecoveryPayload({
      workspaceId: "workspace-default",
      events: [{
        eventId: "legacy-1",
        workspaceId: "workspace-default",
        objectType: "product",
        objectId: "P-1",
        action: "product_created",
        createdAt: "2026-08-07T08:00:00.000Z",
        after: { platformSkuCount: 1 },
      }],
    })).toThrow("摘要型业务事件");
  });

  it("uses a full seed baseline and excludes legacy events already represented by it", () => {
    const baseline = {
      format: CLOUD_SEED_FORMAT,
      formatVersion: CLOUD_SEED_VERSION,
      workspaceId: "workspace-default",
      currency: "CNY",
      generatedAt: "2026-08-07T08:00:00.000Z",
      tables: {
        workspaces: [{ id: "workspace-default", name: "既有工作区", defaultCurrency: "CNY" }],
        products: [{ id: "P-OLD", workspaceId: "workspace-default", name: "基线商品", currency: "CNY" }],
        auditEvents: [{
          id: 1,
          eventId: "legacy-1",
          workspaceId: "workspace-default",
          objectType: "product",
          objectId: "P-OLD",
          action: "product_created",
          actorId: "legacy-user",
          createdAt: "2026-08-06T08:00:00.000Z",
          after: { platformSkuCount: 1 },
        }],
      },
    };
    const payload = buildSyncRecoveryPayload({
      workspaceId: "workspace-default",
      baseline,
      events: [baseline.tables.auditEvents[0]],
    });
    expect(payload.events).toEqual([]);
    expect(replaySyncRecoveryPayload(payload).tables).toMatchObject({
      workspaces: [{ id: "workspace-default", name: "既有工作区" }],
      products: [{ id: "P-OLD", name: "基线商品" }],
      auditEvents: [{ eventId: "legacy-1" }],
    });
  });
});
