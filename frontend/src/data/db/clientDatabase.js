import Dexie from "dexie";
import { createLedgerGroupKey, summarizeLedgerRows } from "../../domain/ledgerImport";
import { canonicalPlatformSku } from "../../domain/identifiers";
import { SYNC_STATES } from "../../domain/syncEnvelope";
import {
  buildLegacyAuditActorForwardMigrationPatch,
  buildLegacyAuditActorRepairPatch,
} from "../../domain/syncAuditActorRepair";
import { runtimeConfig } from "../../config/runtimeConfig";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
  monthlyLedgerId,
} from "./constants";
import { makeId } from "./utils";
import {
  catalogSupplierIdentity,
  catalogSupplierOfferKey,
} from "../repositories/selectionCatalogUtils";
export const CLIENT_DATABASE_NAME = "shopeers-workstation";
export const ERP_TEST_DATA_RESET_ACTION = "erp_test_data_reset_0_2_6_beta_1";
export const db = new Dexie(CLIENT_DATABASE_NAME);

db.version(1).stores({
  importBatches: "id,createdAt,status,store,fileName",
  salesRows: "++id,batchId,sku,store,orderId",
  settings: "key",
});

db.version(2).stores({
  workspaces: "id,name,updatedAt",
  products: "id,workspaceId,status,updatedAt",
  platformSkus: "id,[workspaceId+canonicalPlatformSku],workspaceId,platformSkc,productId,status",
  supplierOffers: "id,workspaceId,productId,source,sourceProductId,updatedAt",
  captures: "id,workspaceId,status,requestId,sourceProductId,capturedAt",
  ledgers: "id,[workspaceId+period],workspaceId,period,status,updatedAt",
  importBatches: "id,ledgerId,workspaceId,createdAt,status,store,fileName,fileHash",
  salesRows: "++id,batchId,ledgerId,[ledgerId+groupKey],workspaceId,platformSku,platformSkc,store,supplierNumber,orderId",
  erpCostRequests: "id,workspaceId,ledgerId,status,createdAt",
  erpCostBatches: "id,workspaceId,ledgerId,requestId,status,publishedAt",
  erpCostRows: "++id,batchId,ledgerId,platformSku,canonicalPlatformSku,warehouseSku,publishedAt",
  costApprovals: "id,workspaceId,ledgerId,platformSku,status,approvedAt",
  auditEvents: "++id,workspaceId,objectType,objectId,createdAt",
  settings: "key",
}).upgrade(async (transaction) => {
  const now = new Date().toISOString();
  const workspaces = transaction.table("workspaces");
  const ledgers = transaction.table("ledgers");
  const batches = transaction.table("importBatches");
  const salesRows = transaction.table("salesRows");

  await workspaces.put({
    id: DEFAULT_WORKSPACE_ID,
    name: DEFAULT_WORKSPACE_NAME,
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    createdAt: now,
    updatedAt: now,
  });

  const legacyBatches = await batches.toArray();
  for (const batch of legacyBatches) {
    if (batch.ledgerId) continue;
    const period = /^\d{4}-\d{2}/.exec(batch.createdAt ?? "")?.[0] ?? "2026-08";
    const ledgerId = monthlyLedgerId(DEFAULT_WORKSPACE_ID, period);
    await ledgers.put({
      id: ledgerId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      period,
      type: "monthly_profit",
      status: "cost_pending",
      currency: "CNY",
      warehouseRate: 0.7,
      migratedFromVersion: 1,
      createdAt: batch.createdAt ?? now,
      updatedAt: now,
    });
    await batches.update(batch.id, {
      ledgerId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      fileHash: null,
    });

    const batchRows = await salesRows.where("batchId").equals(batch.id).toArray();
    for (const row of batchRows) {
      const platformSku = row.platformSku ?? row.sku ?? "";
      const groupKey = createLedgerGroupKey({
        store: row.store ?? batch.store ?? "历史导入",
        legacyFallbackSku: platformSku || `ROW-${row.id}`,
      });
      await salesRows.update(row.id, {
        ledgerId,
        workspaceId: DEFAULT_WORKSPACE_ID,
        platformSku,
        platformSkc: "",
        supplierNumber: "",
        attribute: "",
        groupKey,
        skuKey: `${String(platformSku).toUpperCase()}\u001f`,
        isDeduction: false,
        hasDirectUnitCost: false,
        hasDirectPenalty: false,
      });
    }
  }
});

db.version(3).stores({
  workspaces: "id,name,updatedAt",
  products: "id,workspaceId,status,updatedAt",
  platformSkus: "id,[workspaceId+canonicalPlatformSku],workspaceId,platformSkc,productId,status",
  supplierOffers: "id,workspaceId,productId,source,sourceProductId,updatedAt",
  captures: "id,workspaceId,status,requestId,sourceProductId,capturedAt",
  ledgers: "id,[workspaceId+period],workspaceId,period,status,updatedAt",
  importBatches: "id,ledgerId,workspaceId,createdAt,status,store,fileName,fileHash",
  salesRows: "++id,batchId,ledgerId,[ledgerId+groupKey],workspaceId,platformSku,platformSkc,store,supplierNumber,orderId",
  erpCostRequests: "id,workspaceId,ledgerId,status,createdAt",
  erpCostBatches: "id,workspaceId,ledgerId,requestId,status,publishedAt",
  erpCostRows: "++id,batchId,ledgerId,platformSku,canonicalPlatformSku,warehouseSku,publishedAt",
  costApprovals: "id,workspaceId,ledgerId,platformSku,status,approvedAt",
  profitLines: "++id,workspaceId,ledgerId,platformSku,canonicalPlatformSku,platformSkc,store,finalizedAt",
  auditEvents: "++id,workspaceId,objectType,objectId,createdAt",
  settings: "key",
});

db.version(4).stores({
  workspaces: "id,name,updatedAt",
  products: "id,workspaceId,status,updatedAt",
  platformSkus: "id,[workspaceId+canonicalPlatformSku],workspaceId,platformSkc,productId,status",
  supplierOffers: "id,workspaceId,productId,source,sourceProductId,updatedAt",
  captures: "id,workspaceId,status,requestId,sourceProductId,capturedAt",
  ledgers: "id,[workspaceId+period],workspaceId,period,status,updatedAt",
  importBatches: "id,ledgerId,workspaceId,createdAt,status,store,fileName,fileHash",
  salesRows: "++id,batchId,ledgerId,[ledgerId+groupKey],workspaceId,platformSku,platformSkc,store,supplierNumber,orderId",
  erpCostRequests: "id,workspaceId,ledgerId,status,createdAt",
  erpCostBatches: "id,workspaceId,ledgerId,requestId,status,publishedAt",
  erpCostRows: "++id,batchId,ledgerId,platformSku,canonicalPlatformSku,warehouseSku,publishedAt",
  costApprovals: "id,workspaceId,ledgerId,platformSku,status,approvedAt",
  profitLines: "++id,workspaceId,ledgerId,platformSku,canonicalPlatformSku,platformSkc,store,finalizedAt",
  auditEvents: "++id,workspaceId,objectType,objectId,createdAt",
  settings: "key",
}).upgrade(async (transaction) => {
  const ledgers = transaction.table("ledgers");
  const salesRows = transaction.table("salesRows");
  const existingLedgers = await ledgers.toArray();

  for (const ledger of existingLedgers) {
    if (ledger.summary && ledger.migratedFromVersion !== 1) continue;
    const rows = await salesRows.where("ledgerId").equals(ledger.id).toArray();
    await ledgers.update(ledger.id, { summary: summarizeLedgerRows(rows) });
  }
});

db.version(5).stores({
  workspaces: "id,name,updatedAt",
  products: "id,workspaceId,status,updatedAt",
  platformSkus: "id,&[workspaceId+canonicalPlatformSku],workspaceId,platformSkc,productId,status",
  supplierOffers: "id,workspaceId,productId,platformSku,source,sourceProductId,updatedAt",
  captures: "id,workspaceId,status,requestId,sourceProductId,capturedAt",
  ledgers: "id,[workspaceId+period],workspaceId,period,status,updatedAt",
  importBatches: "id,ledgerId,workspaceId,createdAt,status,store,fileName,fileHash",
  salesRows: "++id,batchId,ledgerId,[ledgerId+groupKey],workspaceId,platformSku,platformSkc,store,supplierNumber,orderId",
  erpCostRequests: "id,workspaceId,ledgerId,status,createdAt",
  erpCostBatches: "id,workspaceId,ledgerId,requestId,status,publishedAt",
  erpCostRows: "++id,batchId,ledgerId,platformSku,canonicalPlatformSku,warehouseSku,publishedAt",
  costApprovals: "id,workspaceId,ledgerId,platformSku,status,approvedAt",
  profitLines: "++id,workspaceId,ledgerId,platformSku,canonicalPlatformSku,platformSkc,store,finalizedAt",
  auditEvents: "++id,workspaceId,objectType,objectId,createdAt",
  settings: "key",
});

db.version(6).stores({
  workspaces: "id,name,updatedAt",
  products: "id,workspaceId,status,updatedAt",
  platformSkus: "id,&[workspaceId+canonicalPlatformSku],workspaceId,platformSkc,productId,status",
  supplierOffers: "id,workspaceId,productId,platformSku,source,sourceProductId,updatedAt",
  captures: "id,workspaceId,status,requestId,sourceProductId,capturedAt",
  ledgers: "id,[workspaceId+period],workspaceId,period,status,updatedAt",
  importBatches: "id,ledgerId,workspaceId,createdAt,status,store,fileName,fileHash",
  salesRows: "++id,batchId,ledgerId,[ledgerId+groupKey],workspaceId,platformSku,platformSkc,store,supplierNumber,orderId",
  erpCostRequests: "id,workspaceId,ledgerId,status,createdAt",
  erpCostBatches: "id,workspaceId,ledgerId,requestId,status,publishedAt",
  erpCostRows: "++id,batchId,ledgerId,platformSku,canonicalPlatformSku,warehouseSku,publishedAt",
  costApprovals: "id,workspaceId,ledgerId,platformSku,status,approvedAt",
  profitLines: "++id,workspaceId,ledgerId,platformSku,canonicalPlatformSku,platformSkc,store,finalizedAt",
  auditEvents: "++id,workspaceId,objectType,objectId,createdAt,syncState",
  settings: "key",
}).upgrade(async (transaction) => {
  const auditEvents = transaction.table("auditEvents");
  const existingEvents = await auditEvents.toArray();
  for (const event of existingEvents) {
    await auditEvents.update(event.id, {
      syncState: event.syncState ?? SYNC_STATES.PENDING,
      syncAttempts: Number(event.syncAttempts ?? 0),
      syncError: event.syncError ?? null,
    });
  }
});

db.version(7).stores({
  workspaces: "id,name,updatedAt",
  products: "id,workspaceId,status,updatedAt",
  platformSkus: "id,&[workspaceId+canonicalPlatformSku],workspaceId,platformSkc,productId,status",
  supplierOffers: "id,workspaceId,productId,platformSku,source,sourceProductId,updatedAt",
  captures: "id,workspaceId,status,requestId,sourceProductId,capturedAt",
  ledgers: "id,[workspaceId+period],workspaceId,period,status,updatedAt",
  importBatches: "id,ledgerId,workspaceId,createdAt,status,store,fileName,fileHash",
  salesRows: "++id,batchId,ledgerId,[ledgerId+groupKey],workspaceId,platformSku,platformSkc,store,supplierNumber,orderId",
  erpCostRequests: "id,workspaceId,ledgerId,status,createdAt",
  erpCostBatches: "id,workspaceId,ledgerId,requestId,status,publishedAt",
  erpCostRows: "++id,batchId,ledgerId,platformSku,canonicalPlatformSku,warehouseSku,publishedAt",
  costApprovals: "id,workspaceId,ledgerId,platformSku,status,approvedAt",
  profitLines: "++id,workspaceId,ledgerId,platformSku,canonicalPlatformSku,platformSkc,store,finalizedAt",
  auditEvents: "++id,&eventId,workspaceId,objectType,objectId,createdAt,syncState",
  settings: "key",
}).upgrade(async (transaction) => {
  const auditEvents = transaction.table("auditEvents");
  const existingEvents = await auditEvents.toArray();
  for (const event of existingEvents) {
    if (event.eventId) continue;
    await auditEvents.update(event.id, { eventId: makeId("EVT") });
  }
});

db.version(8).stores({
  workspaces: "id,name,updatedAt",
  products: "id,workspaceId,status,updatedAt",
  platformSkus: "id,&[workspaceId+canonicalPlatformSku],workspaceId,platformSkc,productId,status",
  supplierOffers: "id,workspaceId,productId,platformSku,source,sourceProductId,updatedAt",
  captures: "id,workspaceId,status,requestId,sourceProductId,capturedAt",
  ledgers: "id,[workspaceId+period],workspaceId,period,status,updatedAt",
  importBatches: "id,ledgerId,workspaceId,createdAt,status,store,fileName,fileHash",
  salesRows: "++id,batchId,ledgerId,[ledgerId+groupKey],workspaceId,platformSku,platformSkc,store,supplierNumber,orderId",
  erpCostRequests: "id,workspaceId,ledgerId,status,createdAt",
  erpCostBatches: "id,workspaceId,ledgerId,requestId,status,publishedAt",
  erpCostRows: "++id,batchId,ledgerId,platformSku,canonicalPlatformSku,warehouseSku,publishedAt",
  erpCostInbox: "id,&deliveryId,batchId,workspaceId,ledgerId,requestId,status,receivedAt",
  costApprovals: "id,workspaceId,ledgerId,platformSku,status,approvedAt",
  profitLines: "++id,workspaceId,ledgerId,platformSku,canonicalPlatformSku,platformSkc,store,finalizedAt",
  auditEvents: "++id,&eventId,workspaceId,objectType,objectId,createdAt,syncState",
  settings: "key",
});

db.version(9).stores({
  workspaces: "id,name,updatedAt",
  products: "id,workspaceId,status,updatedAt",
  platformSkus: "id,&[workspaceId+canonicalPlatformSku],workspaceId,platformSkc,productId,status",
  supplierOffers: "id,workspaceId,productId,platformSku,source,sourceProductId,updatedAt",
  captures: "id,workspaceId,status,requestId,sourceProductId,capturedAt",
  ledgers: "id,[workspaceId+period],workspaceId,period,status,updatedAt",
  importBatches: "id,ledgerId,workspaceId,createdAt,status,store,fileName,fileHash",
  salesRows: "++id,batchId,ledgerId,[ledgerId+groupKey],workspaceId,platformSku,platformSkc,store,supplierNumber,orderId",
  erpCostRequests: "id,workspaceId,ledgerId,status,createdAt",
  erpCostBatches: "id,workspaceId,ledgerId,requestId,status,publishedAt",
  erpCostRows: "++id,batchId,ledgerId,platformSku,canonicalPlatformSku,warehouseSku,publishedAt",
  erpCostInbox: "id,&deliveryId,batchId,workspaceId,ledgerId,requestId,status,receivedAt",
  costApprovals: "id,workspaceId,ledgerId,platformSku,status,approvedAt",
  catalogManualCosts: "id,workspaceId,productId,platformSku,canonicalPlatformSku,status,confirmedAt,updatedAt",
  profitLines: "++id,workspaceId,ledgerId,platformSku,canonicalPlatformSku,platformSkc,store,finalizedAt",
  auditEvents: "++id,&eventId,workspaceId,objectType,objectId,createdAt,syncState",
  settings: "key",
});

db.version(10).stores({
  workspaces: "id,name,updatedAt",
  products: "id,workspaceId,status,updatedAt",
  platformSkus: "id,&[workspaceId+canonicalPlatformSku],workspaceId,platformSkc,productId,status",
  supplierOffers: "id,workspaceId,productId,[productId+status],platformSku,canonicalPlatformSku,offerKey,status,source,sourceProductId,updatedAt",
  captures: "id,workspaceId,status,requestId,sourceProductId,capturedAt",
  ledgers: "id,[workspaceId+period],workspaceId,period,status,updatedAt",
  importBatches: "id,ledgerId,workspaceId,createdAt,status,store,fileName,fileHash",
  salesRows: "++id,batchId,ledgerId,[ledgerId+groupKey],workspaceId,platformSku,platformSkc,store,supplierNumber,orderId",
  erpCostRequests: "id,workspaceId,ledgerId,status,createdAt",
  erpCostBatches: "id,workspaceId,ledgerId,requestId,status,publishedAt",
  erpCostRows: "++id,batchId,ledgerId,platformSku,canonicalPlatformSku,warehouseSku,publishedAt",
  erpCostInbox: "id,&deliveryId,batchId,workspaceId,ledgerId,requestId,status,receivedAt",
  costApprovals: "id,workspaceId,ledgerId,platformSku,status,approvedAt",
  catalogManualCosts: "id,workspaceId,productId,platformSku,canonicalPlatformSku,status,confirmedAt,updatedAt",
  profitLines: "++id,workspaceId,ledgerId,platformSku,canonicalPlatformSku,platformSkc,store,finalizedAt",
  auditEvents: "++id,&eventId,workspaceId,objectType,objectId,createdAt,syncState",
  settings: "key",
}).upgrade(async (transaction) => {
  const offers = transaction.table("supplierOffers");
  const rows = await offers.toArray();
  for (const offer of rows) {
    const status = offer.status === "superseded" ? "superseded" : "active";
    const supplierId = catalogSupplierIdentity(offer, offer.id);
    const canonicalSku = offer.canonicalPlatformSku ?? canonicalPlatformSku(offer.platformSku);
    await offers.update(offer.id, {
      supplierId,
      offerKey: offer.offerKey ?? catalogSupplierOfferKey({ productId: offer.productId, supplierId, canonicalPlatformSku: canonicalSku }),
      status,
      supersededAt: offer.supersededAt ?? null,
    });
  }
});

export const CLIENT_DATABASE_V11_STORES = {
  workspaces: "id,name,updatedAt",
  products: "id,workspaceId,status,publicationStatus,updatedAt",
  platformSkus: "id,&[workspaceId+canonicalPlatformSku],workspaceId,platformSkc,productId,canonicalWarehouseSku,status",
  supplierOffers: "id,workspaceId,productId,[productId+status],platformSku,canonicalPlatformSku,offerKey,status,source,sourceProductId,updatedAt",
  captures: "id,workspaceId,status,requestId,sourceProductId,capturedAt",
  ledgers: "id,[workspaceId+period],workspaceId,period,status,updatedAt",
  importBatches: "id,ledgerId,workspaceId,createdAt,status,store,fileName,fileHash",
  salesRows: "++id,batchId,ledgerId,[ledgerId+groupKey],workspaceId,platformSku,platformSkc,store,supplierNumber,orderId",
  erpCostRequests: "id,workspaceId,ledgerId,status,createdAt",
  erpCostBatches: "id,workspaceId,ledgerId,requestId,status,publishedAt",
  erpCostRows: "++id,batchId,ledgerId,platformSku,canonicalPlatformSku,warehouseSku,publishedAt",
  erpCostInbox: "id,&deliveryId,batchId,workspaceId,ledgerId,requestId,status,receivedAt",
  costApprovals: "id,workspaceId,ledgerId,platformSku,status,approvedAt",
  catalogManualCosts: "id,workspaceId,productId,platformSku,canonicalPlatformSku,status,confirmedAt,updatedAt",
  profitLines: "++id,workspaceId,ledgerId,platformSku,canonicalPlatformSku,platformSkc,store,finalizedAt",
  auditEvents: "++id,&eventId,workspaceId,objectType,objectId,createdAt,syncState",
  settings: "key",
};

db.version(11).stores(CLIENT_DATABASE_V11_STORES);

// v12 originally reset ERP and profit records for a beta fixture. It is retained
// as a schema version only so v11 databases migrate without mutating business data.
db.version(12).stores(CLIENT_DATABASE_V11_STORES);

db.version(13).stores(CLIENT_DATABASE_V11_STORES).upgrade(async (transaction) => {
  const repairedAt = new Date().toISOString();
  const auditEvents = transaction.table("auditEvents");
  for (const event of await auditEvents.toArray()) {
    const patch = buildLegacyAuditActorRepairPatch(event, {
      activeMemberId: "",
      cloudConfigured: runtimeConfig.cloudConfigured,
      cloudIntent: runtimeConfig.cloudIntent === true,
      repairedAt,
      repairMode: "migration",
    });
    if (patch) await auditEvents.update(event.id, patch);
  }
});

db.version(14).stores(CLIENT_DATABASE_V11_STORES).upgrade(async (transaction) => {
  const repairedAt = new Date().toISOString();
  const auditEvents = transaction.table("auditEvents");
  for (const event of await auditEvents.toArray()) {
    const patch = buildLegacyAuditActorForwardMigrationPatch(event, {
      activeMemberId: "",
      cloudConfigured: runtimeConfig.cloudConfigured,
      cloudIntent: runtimeConfig.cloudIntent === true,
      repairedAt,
    });
    if (patch) await auditEvents.update(event.id, patch);
  }
});

db.auditEvents.hook("creating", (_primaryKey, event) => {
  if (!event.eventId) event.eventId = makeId("EVT");
  if (!event.syncState) event.syncState = SYNC_STATES.PENDING;
  if (event.syncAttempts == null) event.syncAttempts = 0;
  if (event.syncError == null) event.syncError = null;
});

