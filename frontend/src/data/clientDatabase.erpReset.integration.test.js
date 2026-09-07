import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_DATABASE_NAME,
  CLIENT_DATABASE_V11_STORES,
  ERP_TEST_DATA_RESET_ACTION,
  db,
} from "./db/clientDatabase";
import { ACTIVE_MEMBER_CONTEXT_KEY } from "./db/constants";
import { runtimeConfig } from "../config/runtimeConfig";
import { repairLegacyTechnicalAuditActors } from "./syncOutbox";
import { auditEventToSyncEvent } from "../domain/syncEnvelope";
import { syncEventContentHash } from "../domain/syncEventHash";
import { LEGACY_AUDIT_ACTOR_UNCERTAIN_CODE } from "../domain/syncAuditActorRepair";

async function seedVersion11Database({ activeMemberId = null } = {}) {
  db.close();
  await Dexie.delete(CLIENT_DATABASE_NAME);
  const legacy = new Dexie(CLIENT_DATABASE_NAME);
  legacy.version(11).stores(CLIENT_DATABASE_V11_STORES);
  await legacy.open();

  await legacy.transaction("rw", legacy.tables, async () => {
    await legacy.workspaces.bulkAdd([
      { id: "WS-A", name: "A", defaultCurrency: "CNY" },
      { id: "WS-B", name: "B", defaultCurrency: "CNY" },
    ]);
    await legacy.products.add({ id: "PRODUCT-1", workspaceId: "WS-A", name: "保留商品" });
    await legacy.platformSkus.add({ id: "PSKU-1", workspaceId: "WS-A", canonicalPlatformSku: "SKU-1", platformSku: "SKU-1", platformSkc: "SKC-1", productId: "PRODUCT-1" });
    await legacy.supplierOffers.add({ id: "OFFER-1", workspaceId: "WS-A", productId: "PRODUCT-1", status: "active", source: "1688" });
    await legacy.catalogManualCosts.add({ id: "MANUAL-1", workspaceId: "WS-A", productId: "PRODUCT-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", status: "confirmed" });
    await legacy.ledgers.bulkAdd([
      { id: "LEDGER-SALES", workspaceId: "WS-A", period: "2026-07", status: "locked", summary: { quantity: 2 }, warehouseRate: 0.8, costSummary: { matchedCount: 1 }, profitSummary: { profit: 20 }, finalizedAt: "2026-08-01", finalizedBy: "tester", lockedAt: "2026-08-02", lockedBy: "tester", formulaVersion: "v-old" },
      { id: "LEDGER-EMPTY", workspaceId: "WS-B", period: "2026-07", status: "finalized", summary: { quantity: 0 }, warehouseRate: 0.6, costSummary: { matchedCount: 1 }, profitSummary: { profit: 0 }, finalizedAt: "2026-08-01", finalizedBy: "tester", formulaVersion: "v-old" },
      { id: "LEDGER-DRAFT", workspaceId: "WS-B", period: "2026-06", status: "draft", summary: { quantity: 0 }, warehouseRate: 0.5 },
    ]);
    await legacy.importBatches.add({ id: "IMPORT-1", ledgerId: "LEDGER-SALES", workspaceId: "WS-A", status: "completed", fileName: "sales.xlsx" });
    await legacy.salesRows.add({ ledgerId: "LEDGER-SALES", workspaceId: "WS-A", batchId: "IMPORT-1", groupKey: "G-1", platformSku: "SKU-1", platformSkc: "SKC-1", quantity: 2, amount: 20 });
    await legacy.erpCostRequests.bulkAdd([
      { id: "REQ-PENDING", workspaceId: "WS-A", ledgerId: "LEDGER-SALES", status: "copied" },
      { id: "REQ-APPLIED", workspaceId: "WS-B", ledgerId: "LEDGER-EMPTY", status: "published" },
    ]);
    await legacy.erpCostInbox.bulkAdd([
      { id: "INBOX-PENDING", deliveryId: "D-PENDING", batchId: "SOURCE-PENDING", workspaceId: "WS-A", ledgerId: "LEDGER-SALES", requestId: "REQ-PENDING", status: "pending", envelope: { retained: true } },
      { id: "INBOX-LOADED", deliveryId: "D-LOADED", batchId: "SOURCE-LOADED", workspaceId: "WS-A", ledgerId: "LEDGER-SALES", requestId: "REQ-PENDING", status: "loaded", envelope: { retained: true } },
      { id: "INBOX-APPLIED", deliveryId: "D-APPLIED", batchId: "SOURCE-APPLIED", workspaceId: "WS-B", ledgerId: "LEDGER-EMPTY", requestId: "REQ-APPLIED", status: "applied", envelope: { retained: true } },
    ]);
    await legacy.erpCostBatches.add({ id: "COST-1", workspaceId: "WS-A", ledgerId: "LEDGER-SALES", requestId: "REQ-PENDING", status: "published" });
    await legacy.erpCostRows.add({ batchId: "COST-1", ledgerId: "LEDGER-SALES", workspaceId: "WS-A", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", unitCost: 3, publishedAt: "2026-07-31" });
    await legacy.costApprovals.add({ id: "APPROVAL-1", workspaceId: "WS-A", ledgerId: "LEDGER-SALES", platformSku: "SKU-1", status: "approved" });
    await legacy.profitLines.add({ workspaceId: "WS-A", ledgerId: "LEDGER-SALES", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", profit: 10 });
    await legacy.settings.add({ key: "desktop-preferences", value: { zoom: 1.1 } });
    if (activeMemberId) {
      await legacy.settings.add({
        key: ACTIVE_MEMBER_CONTEXT_KEY,
        memberId: activeMemberId,
        role: "finance",
        workspaceId: "WS-A",
      });
    }
    await legacy.auditEvents.bulkAdd([
      { eventId: "EVT-ERP", workspaceId: "WS-A", objectType: "erp_cost_batch", objectId: "COST-1", action: "published", createdAt: "2026-08-01", syncState: "pending", after: { snapshot: { secretBusinessRows: [1, 2, 3] } } },
      { eventId: "EVT-FINAL", workspaceId: "WS-A", objectType: "monthly_ledger", objectId: "LEDGER-SALES", action: "finalized", createdAt: "2026-08-01", syncState: "synced", after: { snapshot: { profitLines: [1] } } },
      { eventId: "EVT-SALES", workspaceId: "WS-A", objectType: "sales_import_batch", objectId: "IMPORT-1", action: "imported", createdAt: "2026-07-31", syncState: "pending", after: { snapshot: { fileName: "sales.xlsx", ledger: { id: "LEDGER-SALES", workspaceId: "WS-A", period: "2026-07", status: "locked", warehouseRate: 0.8, costSummary: { matchedCount: 1 }, profitSummary: { profit: 20 }, finalizedAt: "2026-08-01", lockedAt: "2026-08-02" } } } },
      { eventId: "EVT-RATE", workspaceId: "WS-A", objectType: "monthly_ledger", objectId: "LEDGER-SALES", action: "warehouse_rate_updated", createdAt: "2026-07-30", syncState: "pending", after: { snapshot: { id: "LEDGER-SALES", workspaceId: "WS-A", period: "2026-07", status: "finalized", warehouseRate: 0.8, costSummary: { matchedCount: 1 }, profitSummary: { profit: 20 }, finalizedAt: "2026-08-01" } } },
      { eventId: "EVT-PRODUCT", workspaceId: "WS-A", objectType: "product", objectId: "PRODUCT-1", action: "product_created", createdAt: "2026-07-01", syncState: "synced" },
    ]);
  });
  legacy.close();
}

async function seedVersion12TechnicalAudit({
  activeMemberId = null,
  actorId = "system-migration",
  includeSynced = false,
  syncAttempts = 3,
  syncState = "pending",
  syncClaimedAt = null,
} = {}) {
  db.close();
  await Dexie.delete(CLIENT_DATABASE_NAME);
  const legacy = new Dexie(CLIENT_DATABASE_NAME);
  legacy.version(12).stores(CLIENT_DATABASE_V11_STORES);
  await legacy.open();
  if (activeMemberId) {
    await legacy.settings.put({
      key: ACTIVE_MEMBER_CONTEXT_KEY,
      memberId: activeMemberId,
      role: "finance",
      workspaceId: "workspace-default",
    });
  }
  await legacy.auditEvents.add({
    eventId: "EVT-OLD-V12-RESET",
    workspaceId: "workspace-default",
    objectType: "workspace",
    objectId: "all-workspaces",
    action: ERP_TEST_DATA_RESET_ACTION,
    actorId,
    createdAt: "2026-08-20T08:00:00.000Z",
    syncState,
    syncAttempts,
    syncClaimedAt,
    syncError: "JWT actor mismatch",
    after: {
      release: "0.2.6-beta.1",
      counts: { auditEventsRemoved: 2 },
    },
  });
  if (includeSynced) {
    await legacy.auditEvents.add({
      eventId: "EVT-OLD-V12-SYNCED",
      workspaceId: "workspace-default",
      objectType: "workspace",
      objectId: "all-workspaces",
      action: ERP_TEST_DATA_RESET_ACTION,
      actorId: "finance-cloud-previous",
      createdAt: "2026-08-20T07:00:00.000Z",
      syncState: "synced",
      syncAttempts: 4,
      syncClaimedAt: "2026-08-20T07:00:30.000Z",
      syncedAt: "2026-08-20T07:01:00.000Z",
      syncVersion: "cloud-old",
      after: {
        release: "0.2.6-beta.1",
        counts: { auditEventsRemoved: 1 },
      },
    });
  }
  legacy.close();
}

async function seedVersion13ActorRepairStates() {
  db.close();
  await Dexie.delete(CLIENT_DATABASE_NAME);
  const legacy = new Dexie(CLIENT_DATABASE_NAME);
  legacy.version(13).stores(CLIENT_DATABASE_V11_STORES);
  await legacy.open();
  await legacy.auditEvents.bulkAdd([
    {
      eventId: "EVT-V13-MISCLASSIFIED-SYNCED",
      workspaceId: "workspace-default",
      objectType: "workspace",
      objectId: "all-workspaces",
      action: ERP_TEST_DATA_RESET_ACTION,
      actorId: "finance-cloud-previous",
      createdAt: "2026-08-20T07:00:00.000Z",
      syncState: "failed",
      syncAttempts: 4,
      syncError: "历史审计可能已提交云端，已保持原始身份与内容并等待原账号重试或人工处置。",
      syncErrorCode: LEGACY_AUDIT_ACTOR_UNCERTAIN_CODE,
      syncTerminal: true,
      syncFailedAt: "2026-08-28T12:00:00.000Z",
      syncedAt: "2026-08-20T07:01:00.000Z",
      syncVersion: "cloud-old",
      after: { release: "0.2.6-beta.1", counts: { auditEventsRemoved: 1 } },
    },
    ...["EVENT_CONFLICT", "INVALID_ERP_VOID_REOPEN_PAIR"].map((syncErrorCode) => ({
      eventId: `EVT-V13-TERMINAL-${syncErrorCode}`,
      workspaceId: "workspace-default",
      objectType: "workspace",
      objectId: "all-workspaces",
      action: ERP_TEST_DATA_RESET_ACTION,
      actorId: "finance-old",
      createdAt: "2026-08-28T10:30:00.000Z",
      syncState: "failed",
      syncAttempts: 2,
      syncClaimedAt: "2026-08-28T10:29:30.000Z",
      syncTerminal: true,
      syncErrorCode,
      syncError: `原始合同错误:${syncErrorCode}`,
      syncFailedAt: "2026-08-28T10:31:00.000Z",
      after: {
        release: "0.2.6-beta.1",
        counts: { ledgersReset: 1 },
        auditActorRepair: {
          originalActorId: "system-migration",
          source: "technical-actor",
          strategy: "active-cloud-member",
        },
      },
    })),
    {
      eventId: "EVT-V13-DELIVERY-UNCERTAIN",
      workspaceId: "workspace-default",
      objectType: "workspace",
      objectId: "all-workspaces",
      action: ERP_TEST_DATA_RESET_ACTION,
      actorId: "finance-stale",
      createdAt: "2026-08-20T08:00:00.000Z",
      syncState: "pending",
      syncAttempts: 2,
      syncClaimedAt: "2026-08-20T08:01:00.000Z",
      syncError: "等待回执",
      after: { release: "0.2.6-beta.1", counts: { auditEventsRemoved: 2 } },
    },
    {
      eventId: "EVT-V13-ALREADY-SYNCED",
      workspaceId: "workspace-default",
      objectType: "workspace",
      objectId: "all-workspaces",
      action: ERP_TEST_DATA_RESET_ACTION,
      actorId: "finance-cloud-current",
      createdAt: "2026-08-20T06:00:00.000Z",
      syncState: "synced",
      syncAttempts: 5,
      syncClaimedAt: "2026-08-20T06:00:30.000Z",
      syncedAt: "2026-08-20T06:01:00.000Z",
      syncVersion: "cloud-confirmed",
      after: { release: "0.2.6-beta.1", counts: { auditEventsRemoved: 3 } },
    },
  ]);
  const rows = await legacy.auditEvents.toArray();
  legacy.close();
  return new Map(rows.map((row) => [row.eventId, row]));
}

afterEach(async () => {
  db.close();
  await Dexie.delete(CLIENT_DATABASE_NAME);
});

describe("v12 database upgrade", () => {
  it("upgrades a real v11 database without mutating ERP, profit, ledger, or audit history", async () => {
    await seedVersion11Database();
    await db.open();

    expect(await db.erpCostRequests.count()).toBe(2);
    expect(await db.erpCostInbox.count()).toBe(3);
    expect(await db.erpCostBatches.count()).toBe(1);
    expect(await db.erpCostRows.count()).toBe(1);
    expect(await db.costApprovals.count()).toBe(1);
    expect(await db.profitLines.count()).toBe(1);
    expect(await db.erpCostRequests.get("REQ-PENDING")).toMatchObject({ workspaceId: "WS-A", ledgerId: "LEDGER-SALES", status: "copied" });
    expect(await db.erpCostInbox.get("INBOX-APPLIED")).toMatchObject({ deliveryId: "D-APPLIED", status: "applied", envelope: { retained: true } });
    expect(await db.erpCostBatches.get("COST-1")).toMatchObject({ workspaceId: "WS-A", ledgerId: "LEDGER-SALES", status: "published" });
    expect((await db.erpCostRows.toArray())[0]).toMatchObject({ batchId: "COST-1", platformSku: "SKU-1", unitCost: 3 });
    expect(await db.costApprovals.get("APPROVAL-1")).toMatchObject({ status: "approved", platformSku: "SKU-1" });
    expect((await db.profitLines.toArray())[0]).toMatchObject({ ledgerId: "LEDGER-SALES", profit: 10 });

    expect(await db.products.count()).toBe(1);
    expect(await db.platformSkus.count()).toBe(1);
    expect(await db.supplierOffers.count()).toBe(1);
    expect(await db.catalogManualCosts.count()).toBe(1);
    expect(await db.importBatches.count()).toBe(1);
    expect(await db.salesRows.count()).toBe(1);
    expect(await db.settings.get("desktop-preferences")).toMatchObject({ value: { zoom: 1.1 } });

    expect(await db.ledgers.get("LEDGER-SALES")).toMatchObject({ status: "locked", warehouseRate: 0.8, summary: { quantity: 2 }, costSummary: { matchedCount: 1 }, profitSummary: { profit: 20 }, finalizedAt: "2026-08-01", lockedAt: "2026-08-02", formulaVersion: "v-old" });
    expect(await db.ledgers.get("LEDGER-EMPTY")).toMatchObject({ status: "finalized", warehouseRate: 0.6, summary: { quantity: 0 }, costSummary: { matchedCount: 1 }, profitSummary: { profit: 0 }, finalizedAt: "2026-08-01", formulaVersion: "v-old" });
    expect(await db.ledgers.get("LEDGER-DRAFT")).toMatchObject({ status: "draft", warehouseRate: 0.5, summary: { quantity: 0 } });

    const auditEvents = await db.auditEvents.toArray();
    expect(auditEvents.map((event) => event.eventId)).toEqual(expect.arrayContaining(["EVT-ERP", "EVT-FINAL", "EVT-SALES", "EVT-RATE", "EVT-PRODUCT"]));
    expect(auditEvents).toHaveLength(5);
    expect(auditEvents.find((event) => event.eventId === "EVT-ERP")).toMatchObject({ after: { snapshot: { secretBusinessRows: [1, 2, 3] } } });
    expect(auditEvents.find((event) => event.eventId === "EVT-FINAL")).toMatchObject({ action: "finalized", syncState: "synced", after: { snapshot: { profitLines: [1] } } });
    const preservedSalesAudit = auditEvents.find((event) => event.eventId === "EVT-SALES");
    const preservedRateAudit = auditEvents.find((event) => event.eventId === "EVT-RATE");
    expect(preservedSalesAudit.after.snapshot.ledger).toMatchObject({ status: "locked", warehouseRate: 0.8, costSummary: { matchedCount: 1 }, profitSummary: { profit: 20 }, finalizedAt: "2026-08-01", lockedAt: "2026-08-02" });
    expect(preservedRateAudit.after.snapshot).toMatchObject({ status: "finalized", warehouseRate: 0.8, costSummary: { matchedCount: 1 }, profitSummary: { profit: 20 }, finalizedAt: "2026-08-01" });
    const resets = auditEvents.filter((event) => event.action === ERP_TEST_DATA_RESET_ACTION);
    expect(resets).toHaveLength(0);

    db.close();
    await db.open();
    expect(await db.erpCostInbox.count()).toBe(3);
    expect((await db.auditEvents.toArray()).filter((event) => event.action === ERP_TEST_DATA_RESET_ACTION)).toHaveLength(0);
  });

  it("does not create a reset audit in cloud mode", async () => {
    const previousCloudConfigured = runtimeConfig.cloudConfigured;
    runtimeConfig.cloudConfigured = true;
    try {
      await seedVersion11Database({ activeMemberId: "finance-cloud-1" });
      await db.open();
      expect((await db.auditEvents.toArray()).find((event) => event.action === ERP_TEST_DATA_RESET_ACTION)).toBeUndefined();
      expect(await db.settings.get(ACTIVE_MEMBER_CONTEXT_KEY)).toMatchObject({ memberId: "finance-cloud-1", role: "finance", workspaceId: "WS-A" });
    } finally {
      runtimeConfig.cloudConfigured = previousCloudConfigured;
    }
  });

  it("repairs an old v12 technical actor for the authenticated account without duplicating audit rows", async () => {
    const previousCloudConfigured = runtimeConfig.cloudConfigured;
    runtimeConfig.cloudConfigured = true;
    try {
      await seedVersion12TechnicalAudit({ activeMemberId: "finance-stale", actorId: "finance-stale", syncAttempts: 0 });
      await db.open();
      expect(await db.auditEvents.get(1)).toMatchObject({
        actorId: "finance-stale",
        syncState: "failed",
        syncTerminal: true,
        syncErrorCode: "SYNC_ACTOR_REPAIR_REQUIRED",
      });
      await db.auditEvents.add({
        eventId: "EVT-OTHER-WORKSPACE-TECHNICAL",
        workspaceId: "workspace-other",
        objectType: "workspace",
        objectId: "workspace-other",
        action: ERP_TEST_DATA_RESET_ACTION,
        actorId: "system-migration",
        createdAt: "2026-08-20T08:05:00.000Z",
        syncState: "pending",
      });

      await expect(repairLegacyTechnicalAuditActors({
        workspaceId: "workspace-default",
        activeMemberId: "finance-current",
        cloudConfigured: true,
        repairedAt: "2026-08-28T09:00:00.000Z",
      })).resolves.toBe(1);
      await expect(repairLegacyTechnicalAuditActors({
        workspaceId: "workspace-default",
        activeMemberId: "finance-current",
        cloudConfigured: true,
        repairedAt: "2026-08-28T09:01:00.000Z",
      })).resolves.toBe(0);

      expect(await db.auditEvents.count()).toBe(2);
      expect(await db.auditEvents.get(1)).toMatchObject({
        actorId: "finance-current",
        syncState: "pending",
        syncTerminal: false,
        syncError: null,
        after: { auditActorRepair: { originalActorId: "finance-stale", source: "legacy-v12-reset", strategy: "active-cloud-member" } },
      });
      expect(await db.auditEvents.get(2)).toMatchObject({
        workspaceId: "workspace-other",
        actorId: "system-migration",
        syncState: "pending",
      });
    } finally {
      runtimeConfig.cloudConfigured = previousCloudConfigured;
    }
  });

  it("converts an old local v12 technical actor into a synced baseline once", async () => {
    const previousCloudConfigured = runtimeConfig.cloudConfigured;
    runtimeConfig.cloudConfigured = false;
    try {
      await seedVersion12TechnicalAudit({ includeSynced: true, syncAttempts: 0 });
      const beforeDb = new Dexie(CLIENT_DATABASE_NAME);
      beforeDb.version(12).stores(CLIENT_DATABASE_V11_STORES);
      await beforeDb.open();
      const syncedBefore = await beforeDb.auditEvents.get(2);
      const syncedHashBefore = await syncEventContentHash(auditEventToSyncEvent(syncedBefore));
      beforeDb.close();
      await db.open();
      expect(await db.auditEvents.count()).toBe(2);
      expect(await db.auditEvents.get(1)).toMatchObject({
        actorId: "local-user",
        syncState: "synced",
        syncTerminal: false,
        syncVersion: "local-migration-baseline-v13",
        after: { auditActorRepair: { originalActorId: "system-migration", strategy: "local-baseline" } },
      });
      const syncedAfter = await db.auditEvents.get(2);
      expect(syncedAfter).toEqual(syncedBefore);
      expect(await syncEventContentHash(auditEventToSyncEvent(syncedAfter))).toBe(syncedHashBefore);

      db.close();
      await db.open();
      expect(await db.auditEvents.count()).toBe(2);
    } finally {
      runtimeConfig.cloudConfigured = previousCloudConfigured;
    }
  });

  it("quarantines an old cloud technical actor until an authenticated member is available", async () => {
    const previousCloudConfigured = runtimeConfig.cloudConfigured;
    runtimeConfig.cloudConfigured = true;
    try {
      await seedVersion12TechnicalAudit({ syncAttempts: 0 });
      await db.open();
      expect(await db.auditEvents.get(1)).toMatchObject({
        actorId: "system-migration",
        syncState: "failed",
        syncTerminal: true,
        syncErrorCode: "SYNC_ACTOR_REPAIR_REQUIRED",
        after: { auditActorRepair: { strategy: "awaiting-cloud-member" } },
      });
      await repairLegacyTechnicalAuditActors({
        workspaceId: "workspace-default",
        activeMemberId: "finance-after-login",
        cloudConfigured: true,
        repairedAt: "2026-08-28T10:00:00.000Z",
      });
      expect(await db.auditEvents.get(1)).toMatchObject({
        actorId: "finance-after-login",
        syncState: "pending",
        syncTerminal: false,
        syncError: null,
      });
    } finally {
      runtimeConfig.cloudConfigured = previousCloudConfigured;
    }
  });

  it("keeps an endpoint-only API migration quarantined until configuration and login are repaired", async () => {
    const previous = {
      syncProvider: runtimeConfig.syncProvider,
      runtimeMode: runtimeConfig.runtimeMode,
      cloudIntent: runtimeConfig.cloudIntent,
      cloudConfigured: runtimeConfig.cloudConfigured,
      valid: runtimeConfig.valid,
    };
    Object.assign(runtimeConfig, {
      syncProvider: "api",
      runtimeMode: "cloud-invalid",
      cloudIntent: true,
      cloudConfigured: false,
      valid: false,
    });
    try {
      await seedVersion12TechnicalAudit({ actorId: "finance-stale", syncAttempts: 0 });
      await db.open();
      expect(await db.auditEvents.get(1)).toMatchObject({
        actorId: "finance-stale",
        syncState: "failed",
        syncTerminal: true,
        syncErrorCode: "SYNC_ACTOR_REPAIR_REQUIRED",
        after: { auditActorRepair: { strategy: "awaiting-cloud-member" } },
      });
      expect((await db.auditEvents.get(1)).syncVersion).not.toBe("local-migration-baseline-v13");

      await repairLegacyTechnicalAuditActors({
        workspaceId: "workspace-default",
        activeMemberId: "finance-after-config",
        cloudConfigured: true,
        repairedAt: "2026-08-28T11:00:00.000Z",
      });
      expect(await db.auditEvents.get(1)).toMatchObject({
        actorId: "finance-after-config",
        syncState: "pending",
        syncTerminal: false,
      });
    } finally {
      Object.assign(runtimeConfig, previous);
    }
  });

  it.each(["EVENT_CONFLICT", "INVALID_ERP_VOID_REOPEN_PAIR"])("does not revive a repaired %s terminal event in cloud or local mode", async (syncErrorCode) => {
    await db.open();
    await db.auditEvents.add({
      eventId: `EVT-TERMINAL-${syncErrorCode}`,
      workspaceId: "workspace-default",
      objectType: "workspace",
      objectId: "all-workspaces",
      action: ERP_TEST_DATA_RESET_ACTION,
      actorId: "finance-old",
      createdAt: "2026-08-28T10:30:00.000Z",
      syncState: "failed",
      syncAttempts: 2,
      syncTerminal: true,
      syncErrorCode,
      syncError: "合同冲突",
      after: {
        release: "0.2.6-beta.1",
        counts: { ledgersReset: 1 },
        auditActorRepair: {
          originalActorId: "system-migration",
          source: "technical-actor",
          strategy: "active-cloud-member",
        },
      },
    });

    await expect(repairLegacyTechnicalAuditActors({
      workspaceId: "workspace-default",
      activeMemberId: "finance-current",
      cloudConfigured: true,
    })).resolves.toBe(0);
    await expect(repairLegacyTechnicalAuditActors({
      workspaceId: "workspace-default",
      activeMemberId: "local-user",
      cloudConfigured: false,
    })).resolves.toBe(0);
    expect(await db.auditEvents.where("eventId").equals(`EVT-TERMINAL-${syncErrorCode}`).first()).toMatchObject({
      actorId: "finance-old",
      syncState: "failed",
      syncTerminal: true,
      syncErrorCode,
    });
  });

  it.each([
    ["pending", null],
    ["failed", null],
    ["in_flight", "2026-08-20T08:01:00.000Z"],
  ])("keeps a possibly delivered old v12 %s event content hash stable during v13 upgrade", async (syncState, syncClaimedAt) => {
    const previous = {
      cloudIntent: runtimeConfig.cloudIntent,
      cloudConfigured: runtimeConfig.cloudConfigured,
    };
    Object.assign(runtimeConfig, { cloudIntent: true, cloudConfigured: true });
    try {
      await seedVersion12TechnicalAudit({
        actorId: "finance-stale",
        syncAttempts: 2,
        syncState,
        syncClaimedAt,
      });
      const beforeDb = new Dexie(CLIENT_DATABASE_NAME);
      beforeDb.version(12).stores(CLIENT_DATABASE_V11_STORES);
      await beforeDb.open();
      const before = await beforeDb.auditEvents.get(1);
      const beforeHash = await syncEventContentHash(auditEventToSyncEvent(before));
      beforeDb.close();

      await db.open();
      const after = await db.auditEvents.get(1);
      expect(after).toMatchObject({
        actorId: "finance-stale",
        after: before.after,
        syncState: "failed",
        syncTerminal: true,
        syncErrorCode: LEGACY_AUDIT_ACTOR_UNCERTAIN_CODE,
      });
      expect(after.before).toBe(before.before);
      expect(after.after).toEqual(before.after);
      expect(await syncEventContentHash(auditEventToSyncEvent(after))).toBe(beforeHash);
      await expect(repairLegacyTechnicalAuditActors({
        workspaceId: "workspace-default",
        activeMemberId: "finance-new",
        cloudConfigured: true,
      })).resolves.toBe(0);
      await expect(repairLegacyTechnicalAuditActors({
        workspaceId: "workspace-default",
        activeMemberId: "local-user",
        cloudConfigured: false,
      })).resolves.toBe(0);
    } finally {
      Object.assign(runtimeConfig, previous);
    }
  });

  it("upgrades a real old v13 database once without reviving contract terminals", async () => {
    const previous = {
      cloudIntent: runtimeConfig.cloudIntent,
      cloudConfigured: runtimeConfig.cloudConfigured,
    };
    Object.assign(runtimeConfig, { cloudIntent: true, cloudConfigured: true });
    try {
      const before = await seedVersion13ActorRepairStates();
      const beforeHashes = new Map();
      for (const [eventId, event] of before) {
        beforeHashes.set(eventId, await syncEventContentHash(auditEventToSyncEvent(event)));
      }

      await db.open();
      expect(db.verno).toBe(14);

      const restored = await db.auditEvents.where("eventId").equals("EVT-V13-MISCLASSIFIED-SYNCED").first();
      expect(restored).toMatchObject({
        actorId: "finance-cloud-previous",
        syncState: "synced",
        syncAttempts: 4,
        syncError: null,
        syncErrorCode: null,
        syncTerminal: false,
        syncFailedAt: null,
        syncedAt: "2026-08-20T07:01:00.000Z",
        syncVersion: "cloud-old",
      });
      expect(restored.after).toEqual(before.get(restored.eventId).after);
      expect(await syncEventContentHash(auditEventToSyncEvent(restored))).toBe(beforeHashes.get(restored.eventId));

      for (const syncErrorCode of ["EVENT_CONFLICT", "INVALID_ERP_VOID_REOPEN_PAIR"]) {
        const eventId = `EVT-V13-TERMINAL-${syncErrorCode}`;
        expect(await db.auditEvents.where("eventId").equals(eventId).first()).toEqual(before.get(eventId));
      }

      const uncertain = await db.auditEvents.where("eventId").equals("EVT-V13-DELIVERY-UNCERTAIN").first();
      expect(uncertain).toMatchObject({
        actorId: "finance-stale",
        syncState: "failed",
        syncAttempts: 2,
        syncErrorCode: LEGACY_AUDIT_ACTOR_UNCERTAIN_CODE,
        syncTerminal: true,
      });
      expect(uncertain.before).toBe(before.get(uncertain.eventId).before);
      expect(uncertain.after).toEqual(before.get(uncertain.eventId).after);
      expect(await syncEventContentHash(auditEventToSyncEvent(uncertain))).toBe(beforeHashes.get(uncertain.eventId));

      const synced = await db.auditEvents.where("eventId").equals("EVT-V13-ALREADY-SYNCED").first();
      expect(synced).toEqual(before.get(synced.eventId));
      expect(await syncEventContentHash(auditEventToSyncEvent(synced))).toBe(beforeHashes.get(synced.eventId));

      const afterFirstOpen = await db.auditEvents.toArray();
      db.close();
      await db.open();
      expect(await db.auditEvents.toArray()).toEqual(afterFirstOpen);
    } finally {
      Object.assign(runtimeConfig, previous);
    }
  });
});
