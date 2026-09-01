import { describe, expect, it, vi } from "vitest";
import { buildSyncEnvelope } from "./syncEnvelope";
import { syncEventContentHash } from "./syncEventHash";
import { buildErpVoidTransitionId } from "./syncLifecycleGroup";
import { applySyncEnvelopeWithPostgresClient, buildSyncPostgresPlan } from "./syncPostgresPlan";

const createdAt = "2026-08-07T08:00:00.000Z";

function event({ eventId = "E-1", objectType = "product", objectId = "P-1", action = "product_created", snapshot, workspaceId = "workspace-default", actorId = "user-1", occurredAt = createdAt } = {}) {
  return {
    eventId,
    workspaceId,
    objectType,
    objectId,
    action,
    actorId,
    createdAt: occurredAt,
    after: snapshot === undefined ? null : { snapshot },
  };
}

function envelope(events, workspaceId = "workspace-default") {
  return buildSyncEnvelope({ workspaceId, cursor: "42", generatedAt: createdAt, events });
}

function productSnapshot(workspaceId = "workspace-default") {
  return {
    product: {
      id: "P-1", workspaceId, name: "商品", platformSkc: "SKC-1", canonicalPlatformSkc: "SKC-1",
      salesPlatform: "SHEIN", publicationStatus: "approved_pending_listing",
      attributes: {
        supplierProfiles: [{ supplierId: "SUP-1", sourceUrl: "https://detail.1688.com/offer/1" }],
        pendingVariants: [{ attribute: "待分配属性", sourceSku: "1688-PENDING" }],
      },
      status: "active", currency: "CNY", createdAt, updatedAt: createdAt,
    },
    platformSkus: [{
      id: "PS-1", workspaceId, productId: "P-1", platformSkc: "SKC-1", canonicalPlatformSkc: "SKC-1",
      platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", warehouseSku: "WH-1", canonicalWarehouseSku: "WH-1", status: "active", createdAt, updatedAt: createdAt,
    }],
    supplierOffers: [{
      id: "SO-1", workspaceId, productId: "P-1", platformSkuId: "PS-1", platformSku: "SKU-1",
      canonicalPlatformSku: "SKU-1", source: "1688", landedUnitCost: 12, referenceUnitCost: 12,
      currency: "CNY", createdAt, updatedAt: createdAt,
    }],
  };
}

function ledger(status = "cost_pending") {
  return {
    id: "L-1", workspaceId: "workspace-default", period: "2026-08", type: "monthly_profit", status,
    currency: "CNY", warehouseRate: 0.7, summary: {}, costSummary: {}, createdBy: "user-1", createdAt, updatedAt: createdAt,
  };
}

function lifecycleInbox({
  status = "applied",
  appliedBatchId = "CB-1",
  ledgerId = "L-1",
  voidedAt = createdAt,
  voidedBy = "user-1",
  voidReason = "成本批次错误",
} = {}) {
  return {
    id: `INBOX-${appliedBatchId}`,
    workspaceId: "workspace-default",
    deliveryId: `DELIVERY-${appliedBatchId}`,
    batchId: `SOURCE-${appliedBatchId}`,
    ledgerId,
    requestId: "REQ-1",
    status,
    receivedVia: "browser-message",
    receivedAt: createdAt,
    envelope: { format: "shopeers-erp-cost-inbox", formatVersion: 2 },
    appliedBatchId,
    appliedAt: createdAt,
    ...(status === "voided" ? { voidedBatchId: appliedBatchId, voidedAt, voidedBy, voidReason } : {}),
  };
}

function voidLifecyclePair({
  batchId = "CB-VOID",
  ledgerId = "L-1",
  reason = "成本批次错误",
  actorId = "user-1",
  occurredAt = createdAt,
} = {}) {
  const transitionId = buildErpVoidTransitionId({ batchId, ledgerId, voidedAt: occurredAt });
  const voidedSnapshot = {
    costBatch: {
      id: batchId,
      workspaceId: "workspace-default",
      ledgerId,
      status: "voided",
      currency: "CNY",
      publishedAt: createdAt,
      voidedAt: occurredAt,
      voidedBy: actorId,
      voidReason: reason,
    },
    inbox: lifecycleInbox({ status: "voided", appliedBatchId: batchId, ledgerId, voidedAt: occurredAt, voidedBy: actorId, voidReason: reason }),
    ledger: { ...ledger("cost_pending"), id: ledgerId },
  };
  const voidedEvent = event({
    eventId: "E-VOID",
    objectType: "erp_cost_batch",
    objectId: batchId,
    action: "voided",
    snapshot: voidedSnapshot,
    actorId,
    occurredAt,
  });
  voidedEvent.before = { ledgerStatus: "finalized" };
  Object.assign(voidedEvent.after, { reason, transitionId, voidedBatchId: batchId });

  const reopenedEvent = event({
    eventId: "E-REOPEN",
    objectType: "monthly_ledger",
    objectId: ledgerId,
    action: "reopened_for_cost_recalculation",
    snapshot: { ...ledger("cost_pending"), id: ledgerId },
    actorId,
    occurredAt,
  });
  Object.assign(reopenedEvent.after, { reason, transitionId, voidedBatchId: batchId });
  return { voidedEvent, reopenedEvent, transitionId };
}

function legacyVoidLifecyclePair(options = {}) {
  const pair = voidLifecyclePair(options);
  for (const lifecycleEvent of [pair.voidedEvent, pair.reopenedEvent]) {
    delete lifecycleEvent.after.transitionId;
    delete lifecycleEvent.after.voidedBatchId;
  }
  return pair;
}

function fakeClient({
  existing = [],
  failOn = null,
  ledgerStatus = "cost_pending",
  hasFormalLifecycle = false,
  workspaceVisible = true,
  batchStatus = "published",
  inboxStatus = "applied",
  linkedInboxCount = 1,
  voidedBatchId = null,
  voidTransitionRows = 1,
} = {}) {
  const hashes = new Map(existing.map((row) => [row.event_id, row.content_hash]));
  const calls = [];
  return {
    hashes,
    calls,
    query: vi.fn(async (text, values) => {
      calls.push({ text, values });
      if (failOn && text.includes(failOn)) throw new Error("database failure");
      if (text === "begin" || text === "commit" || text === "rollback") return { rowCount: null, rows: [] };
      if (text.startsWith("select id from public.workspaces")) return { rowCount: workspaceVisible ? 1 : 0, rows: workspaceVisible ? [{ id: values[0] }] : [] };
      if (text.startsWith("select event_id, content_hash")) {
        const rows = values[1].filter((id) => hashes.has(id)).map((id) => ({ event_id: id, content_hash: hashes.get(id) }));
        return { rowCount: rows.length, rows };
      }
      if (text.startsWith("select status from public.ledgers") || text.startsWith("select l.status")) {
        return { rowCount: 1, rows: [{ status: ledgerStatus, has_formal_lifecycle: hasFormalLifecycle }] };
      }
      if (text.includes("linked_inbox_count") && text.includes("from public.erp_cost_batches b")) {
        return {
          rowCount: 1,
          rows: [{
            batch_status: batchStatus,
            ledger_id: "L-1",
            ledger_status: ledgerStatus,
            inbox_id: "INBOX-CB-VOID",
            inbox_status: inboxStatus,
            inbox_ledger_id: "L-1",
            applied_batch_id: "CB-VOID",
            voided_batch_id: voidedBatchId,
            linked_inbox_count: linkedInboxCount,
          }],
        };
      }
      if (text.startsWith("select * from public.void_erp_cost_batch")) {
        return { rowCount: voidTransitionRows, rows: voidTransitionRows ? [{ batch_id: values[1], inbox_id: values[2], ledger_status: ledgerStatus }] : [] };
      }
      if (text.startsWith("insert into public.audit_events")) {
        for (const row of JSON.parse(values[1])) hashes.set(row.event_id, row.content_hash);
      }
      return { rowCount: 1, rows: [] };
    }),
  };
}

describe("sync postgres transaction plan", () => {
  it("maps product replacement into workspace-scoped, parameterized SQL", async () => {
    const plan = await buildSyncPostgresPlan(envelope([event({ snapshot: productSnapshot() })]));
    const operations = plan.eventPlans[0].operations;
    expect(operations.map((operation) => operation.table)).toEqual([
      "products", "supplier_offers", "platform_skus", "platform_skus", "supplier_offers",
    ]);
    expect(operations.every((operation) => operation.text.includes("workspace_id"))).toBe(true);
    expect(operations[0].text).toContain("$1");
    expect(operations[0].text).not.toContain("商品");
    expect(operations[0].text).toContain("publication_status");
    expect(operations[0].values).toContain("approved_pending_listing");
    expect(operations[0].values[18]).toMatchObject({
      supplierProfiles: [{ supplierId: "SUP-1", sourceUrl: "https://detail.1688.com/offer/1" }],
      pendingVariants: [{ attribute: "待分配属性", sourceSku: "1688-PENDING" }],
    });
    expect(JSON.parse(operations[3].values[1])[0]).toMatchObject({ warehouse_sku: "WH-1", canonical_warehouse_sku: "WH-1" });
    expect(JSON.parse(operations[3].values[1])).toHaveLength(1);
  });

  it("syncs an active catalog manual cost by superseding only the same SKU before its upsert", async () => {
    const snapshot = {
      catalogManualCost: {
        id: "MC-1", workspaceId: "workspace-default", productId: "P-1", platformSkuId: "PS-1",
        platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", amount: 8.5, currency: "CNY",
        kind: "manual_confirmed", status: "active", note: "已核对", confirmedBy: "user-1",
        confirmedAt: createdAt, createdAt, updatedAt: createdAt,
      },
    };
    const plan = await buildSyncPostgresPlan(envelope([event({
      eventId: "E-MC-1", objectType: "catalog_manual_cost", objectId: "MC-1",
      action: "catalog_manual_cost_confirmed", snapshot,
    })]));
    const operations = plan.eventPlans[0].operations;
    expect(operations.map((operation) => operation.table)).toEqual(["catalog_manual_costs", "catalog_manual_costs"]);
    expect(operations[0].text).toContain("status = 'superseded'");
    expect(operations[0].values).toEqual(["workspace-default", "P-1", "SKU-1", createdAt, "MC-1"]);
    expect(operations[1].text).toContain("insert into public.catalog_manual_costs");
    expect(operations[1].values).toContain(8.5);
  });

  it("syncs custom sales-status definitions as a workspace-scoped configuration update", async () => {
    const snapshot = {
      id: "workspace-default",
      name: "默认工作区",
      defaultCurrency: "CNY",
      timezone: "Asia/Shanghai",
      selectionStatusDefinitions: [{ id: "testing", label: "测品", tone: "blue", requiresReadiness: false }],
      createdAt,
      updatedAt: createdAt,
    };
    const plan = await buildSyncPostgresPlan(envelope([event({
      eventId: "E-STATUS-1", objectType: "selection_status_definitions", objectId: "workspace-default",
      action: "selection_status_definitions_updated", snapshot,
    })]));
    const [operation] = plan.eventPlans[0].operations;
    expect(operation.table).toBe("workspaces");
    expect(operation.text).toContain("selection_status_definitions");
    expect(operation.values).toContain(snapshot.selectionStatusDefinitions);
  });

  it("deletes a merged source product before the primary snapshot reclaims its SKU rows", async () => {
    const mergedSnapshot = productSnapshot();
    mergedSnapshot.product.id = "P-PRIMARY";
    mergedSnapshot.platformSkus[0].productId = "P-PRIMARY";
    mergedSnapshot.supplierOffers[0].productId = "P-PRIMARY";
    const plan = await buildSyncPostgresPlan(envelope([
      { ...event({ eventId: "E-DELETE", objectId: "P-SOURCE", action: "product_deleted" }), after: null },
      event({ eventId: "E-MERGE", objectId: "P-PRIMARY", action: "product_merged", snapshot: mergedSnapshot }),
    ]));
    const deleteOperation = plan.eventPlans[0].operations[0];
    expect(deleteOperation).toMatchObject({
      table: "products",
      text: "delete from public.products where workspace_id = $1 and id = $2",
      values: ["workspace-default", "P-SOURCE"],
    });
    expect(plan.eventPlans[1].operations.map((operation) => operation.table)).toEqual([
      "products", "supplier_offers", "platform_skus", "platform_skus", "supplier_offers",
    ]);
  });

  it("maps sales group replacement, ERP publishing, approval, finalization and deletion in deterministic order", async () => {
    const salesSnapshot = {
      importBatch: { id: "I-1", workspaceId: "workspace-default", ledgerId: "L-1", fileName: "sales.xlsx", status: "completed", period: "2026-08", createdAt },
      ledger: ledger(),
      salesRows: [{ workspaceId: "workspace-default", groupKey: "店铺|SKC-1", skuKey: "SKU-1", store: "店铺", platformSkc: "SKC-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", quantity: 2, amount: 30, createdAt }],
    };
    const erpSnapshot = {
      costBatch: { id: "CB-1", workspaceId: "workspace-default", ledgerId: "L-1", sourceName: "erp.tsv", status: "published", currency: "CNY", publishedBy: "user-1", publishedAt: createdAt, createdAt },
      ledger: ledger("ready"),
      rows: [{ workspaceId: "workspace-default", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", platformSkc: "SKC-1", canonicalPlatformSkc: "SKC-1", unitCost: 10, currency: "CNY", publishedAt: createdAt }],
      inbox: lifecycleInbox(),
    };
    const approval = { id: "A-1", workspaceId: "workspace-default", ledgerId: "L-1", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", referenceCostId: "R-1", approvedAmount: 11, currency: "CNY", reason: "ERP 缺失", approvedBy: "user-1", approvedAt: createdAt, status: "approved", ledger: ledger("ready") };
    const finalized = { ...ledger("finalized"), finalizedAt: createdAt, finalizedBy: "user-1", formulaVersion: "v1", profitLines: [{ workspaceId: "workspace-default", platformSku: "SKU-1", canonicalPlatformSku: "SKU-1", store: "店铺", quantity: 2, revenue: 30, penalty: 0, formalCostSource: "erp", formalUnitCost: 10, purchaseCost: 20, warehouseCost: 1.4, profit: 8.6, profitRate: 28.67, formulaVersion: "v1", finalizedAt: createdAt, finalizedBy: "user-1" }] };
    const plan = await buildSyncPostgresPlan(envelope([
      event({ eventId: "E-S", objectType: "sales_import_batch", objectId: "I-1", action: "imported", snapshot: salesSnapshot }),
      event({ eventId: "E-C", objectType: "erp_cost_batch", objectId: "CB-1", action: "published", snapshot: erpSnapshot }),
      event({ eventId: "E-A", objectType: "cost_approval", objectId: "A-1", action: "approved_1688_fallback", snapshot: approval }),
      event({ eventId: "E-F", objectType: "monthly_ledger", objectId: "L-1", action: "finalized", snapshot: finalized }),
      { ...event({ eventId: "E-D", objectType: "monthly_ledger", objectId: "L-1", action: "deleted" }), after: null },
    ]));
    expect(plan.eventPlans[0].operations.map((item) => item.table)).toEqual(["ledgers", "import_batches", "sales_rows", "sales_rows"]);
    expect(plan.eventPlans[0].operations[2].text).toContain("group_key = any");
    expect(plan.eventPlans[1].operations.map((item) => item.table)).toEqual(["ledgers", "erp_cost_batches", "erp_cost_rows", "erp_cost_inbox"]);
    expect(plan.eventPlans[2].operations.map((item) => item.table)).toEqual(["cost_approvals", "ledgers"]);
    expect(plan.eventPlans[3].operations.map((item) => item.table)).toEqual(["ledgers", "profit_lines", "ledgers"]);
    expect(plan.eventPlans[3].operations[0].kind).toBe("finalize_guard");
    expect(plan.eventPlans[4].operations.map((item) => item.kind ?? item.table)).toEqual(["delete_guard", "ledgers"]);
  });

  it("updates a voided ERP batch and reopens a finalized ledger without retaining active profit rows", async () => {
    const { voidedEvent, reopenedEvent } = voidLifecyclePair();
    const plan = await buildSyncPostgresPlan(envelope([voidedEvent, reopenedEvent]));

    expect(plan.eventPlans[0].operations.map((item) => item.kind)).toEqual(["void_guard", "void_transition"]);
    expect(plan.eventPlans[0].operations[0]).toMatchObject({ values: ["workspace-default", "CB-VOID", "INBOX-CB-VOID"], allowFinalizedReopen: false });
    expect(plan.eventPlans[0].operations[0].text).toContain("for update of b, l, i");
    expect(plan.eventPlans[0].operations[1].text).toContain("void_erp_cost_batch");
    expect(plan.eventPlans[1].operations).toHaveLength(1);
    expect(plan.eventPlans[1].operations[0]).toMatchObject({ kind: "reopen_finalized_ledger" });
    expect(plan.eventPlans[1].operations[0].text).toContain("reopen_ledger_for_cost_recalculation");
    expect(plan.eventPlans[1].operations[0].values.at(-1)).toBe("成本批次错误");

    const client = fakeClient({ ledgerStatus: "finalized" });
    await expect(applySyncEnvelopeWithPostgresClient(envelope([voidedEvent, reopenedEvent]), { client })).resolves.toMatchObject({
      insertedEventCount: 2,
      transaction: "committed",
    });
    const voidCall = client.calls.find((call) => call.text.includes("void_erp_cost_batch"));
    expect(voidCall.values.at(-1)).toBe(true);
  });

  it("rejects a finalized-ledger reopen event without an audited reason", async () => {
    await expect(buildSyncPostgresPlan(envelope([
      event({
        eventId: "E-REOPEN-NO-REASON",
        objectType: "monthly_ledger",
        objectId: "L-1",
        action: "reopened_for_cost_recalculation",
        snapshot: ledger("cost_pending"),
      }),
    ]))).rejects.toMatchObject({ code: "REOPEN_REASON_REQUIRED", status: 409 });
  });

  it("uses remote lifecycle state instead of a forged client ledgerStatus when voiding", async () => {
    const { voidedEvent } = voidLifecyclePair();
    voidedEvent.eventId = "E-VOID-REMOTE";
    voidedEvent.before = { ledgerStatus: "cost_pending" };
    const client = fakeClient({ ledgerStatus: "finalized" });
    await expect(applySyncEnvelopeWithPostgresClient(envelope([voidedEvent]), { client })).rejects.toMatchObject({
      code: "ERP_VOID_REOPEN_REQUIRED",
      status: 409,
    });
    expect(client.calls.some((call) => call.text.includes("void_erp_cost_batch"))).toBe(false);
    expect(client.calls.some((call) => call.text.startsWith("insert into public.ledgers"))).toBe(false);
  });

  it.each([
    ["batch is not published", { batchStatus: "voided" }, "ERP_BATCH_NOT_PUBLISHED"],
    ["inbox is not applied", { inboxStatus: "voided", voidedBatchId: "CB-VOID" }, "ERP_INBOX_NOT_APPLIED"],
    ["formal batch has duplicate inbox links", { linkedInboxCount: 2 }, "ERP_INBOX_CARDINALITY_CONFLICT"],
    ["controlled transition affects zero rows", { voidTransitionRows: 0 }, "ERP_VOID_TRANSITION_CONFLICT"],
  ])("rejects void transition when %s", async (_label, clientOptions, code) => {
    const { voidedEvent } = voidLifecyclePair();
    voidedEvent.eventId = `E-VOID-${code}`;
    const client = fakeClient(clientOptions);
    await expect(applySyncEnvelopeWithPostgresClient(envelope([voidedEvent]), { client })).rejects.toMatchObject({ code, status: 409 });
    expect(client.calls.at(-1).text).toBe("rollback");
  });

  it("keeps publish, controlled void, and finalized reopen in one audited transaction", async () => {
    const { voidedEvent, reopenedEvent } = voidLifecyclePair({ reason: "成本错误" });
    voidedEvent.eventId = "E-VOID-TX";
    reopenedEvent.eventId = "E-REOPEN-VOID";
    const client = fakeClient({ ledgerStatus: "finalized" });
    const result = await applySyncEnvelopeWithPostgresClient(envelope([voidedEvent, reopenedEvent]), { client });
    expect(result).toMatchObject({ transaction: "committed", insertedEventCount: 2 });
    expect(client.calls.some((call) => call.text.includes("void_erp_cost_batch"))).toBe(true);
    expect(client.calls.some((call) => call.text.includes("reopen_ledger_for_cost_recalculation"))).toBe(true);
    expect(client.calls.some((call) => call.text.startsWith("update public.erp_cost_batches"))).toBe(false);
  });

  it("does not let a replayed reopen event authorize a new void event", async () => {
    const { voidedEvent, reopenedEvent } = voidLifecyclePair();
    const payload = envelope([voidedEvent, reopenedEvent]);
    const plan = await buildSyncPostgresPlan(payload);
    const client = fakeClient({
      ledgerStatus: "finalized",
      existing: [{ event_id: reopenedEvent.eventId, content_hash: plan.eventPlans[1].contentHash }],
    });
    await expect(applySyncEnvelopeWithPostgresClient(payload, { client })).rejects.toMatchObject({
      code: "ERP_VOID_REOPEN_REQUIRED",
      status: 409,
    });
    expect(client.calls.some((call) => call.text.includes("void_erp_cost_batch"))).toBe(false);
    expect(client.calls.some((call) => call.text.includes("reopen_ledger_for_cost_recalculation"))).toBe(false);
    if (client.calls.length > 0) expect(client.calls.at(-1).text).toBe("rollback");
  });

  it("acks an already persisted legacy void/reopen replay before strict pairing validation", async () => {
    const { voidedEvent, reopenedEvent } = legacyVoidLifecyclePair();
    const payload = envelope([voidedEvent, reopenedEvent]);
    const existing = await Promise.all(payload.events.map(async (item) => ({
      event_id: item.eventId,
      content_hash: await syncEventContentHash(item),
    })));
    const client = fakeClient({ ledgerStatus: "finalized", existing });
    await expect(applySyncEnvelopeWithPostgresClient(payload, { client })).resolves.toMatchObject({
      insertedEventCount: 0,
      replayedEventCount: 2,
      transaction: "committed",
    });
    expect(client.calls.some((call) => call.text.includes("void_erp_cost_batch"))).toBe(false);
    expect(client.calls.some((call) => call.text.includes("reopen_ledger_for_cost_recalculation"))).toBe(false);
  });

  it("derives a safe runtime identity for a pending legacy void/reopen pair", async () => {
    const { voidedEvent, reopenedEvent } = legacyVoidLifecyclePair();
    const client = fakeClient({ ledgerStatus: "finalized" });
    await expect(applySyncEnvelopeWithPostgresClient(envelope([voidedEvent, reopenedEvent]), { client })).resolves.toMatchObject({
      insertedEventCount: 2,
      transaction: "committed",
    });
    expect(client.calls.find((call) => call.text.includes("void_erp_cost_batch")).values.at(-1)).toBe(true);
    expect(client.calls.some((call) => call.text.includes("reopen_ledger_for_cost_recalculation"))).toBe(true);
  });

  it("rejects an ambiguous legacy pair without executing either transition", async () => {
    const { voidedEvent, reopenedEvent } = legacyVoidLifecyclePair();
    reopenedEvent.actorId = "finance-other";
    const client = fakeClient({ ledgerStatus: "finalized" });
    await expect(applySyncEnvelopeWithPostgresClient(envelope([voidedEvent, reopenedEvent]), { client })).rejects.toMatchObject({
      code: "INVALID_ERP_VOID_REOPEN_PAIR",
      status: 409,
    });
    expect(client.calls.some((call) => call.text.includes("void_erp_cost_batch"))).toBe(false);
    expect(client.calls.some((call) => call.text.includes("reopen_ledger_for_cost_recalculation"))).toBe(false);
    expect(client.calls.at(-1).text).toBe("rollback");
  });

  it.each([
    ["ledger", (pair) => { pair.reopenedEvent.objectId = "L-OTHER"; pair.reopenedEvent.after.snapshot.id = "L-OTHER"; }],
    ["actor", (pair) => { pair.reopenedEvent.actorId = "finance-other"; }],
    ["reason", (pair) => { pair.reopenedEvent.after.reason = "另一原因"; }],
    ["transition", (pair) => { pair.reopenedEvent.after.transitionId = "ERP-VOID:OTHER"; }],
    ["batch", (pair) => { pair.reopenedEvent.after.voidedBatchId = "CB-OTHER"; }],
    ["time", (pair) => { pair.reopenedEvent.createdAt = "2026-08-07T08:00:01.000Z"; }],
  ])("rejects a pending void/reopen pair with mismatched %s", async (_label, mutate) => {
    const pair = voidLifecyclePair();
    mutate(pair);
    const client = fakeClient({ ledgerStatus: "finalized" });
    await expect(applySyncEnvelopeWithPostgresClient(envelope([pair.voidedEvent, pair.reopenedEvent]), { client })).rejects.toMatchObject({
      code: "INVALID_ERP_VOID_REOPEN_PAIR",
      status: 409,
    });
    expect(client.calls.some((call) => call.text.includes("void_erp_cost_batch"))).toBe(false);
    expect(client.calls.some((call) => call.text.includes("reopen_ledger_for_cost_recalculation"))).toBe(false);
    if (client.calls.length > 0) expect(client.calls.at(-1).text).toBe("rollback");
  });

  it("rejects a pending reopen that appears before its void event", async () => {
    const { voidedEvent, reopenedEvent } = voidLifecyclePair();
    const client = fakeClient({ ledgerStatus: "finalized" });
    await expect(applySyncEnvelopeWithPostgresClient(envelope([reopenedEvent, voidedEvent]), { client })).rejects.toMatchObject({
      code: "INVALID_ERP_VOID_REOPEN_PAIR",
      status: 409,
    });
    expect(client.calls.some((call) => call.text.includes("void_erp_cost_batch"))).toBe(false);
    expect(client.calls.some((call) => call.text.includes("reopen_ledger_for_cost_recalculation"))).toBe(false);
    expect(client.calls.at(-1).text).toBe("rollback");
  });

  it.each([
    ["batch", "voidedAt"],
    ["batch", "voidedBy"],
    ["batch", "voidReason"],
    ["inbox", "voidedAt"],
    ["inbox", "voidedBy"],
    ["inbox", "voidReason"],
  ])("rejects void metadata missing from the %s %s field", async (side, field) => {
    const { voidedEvent } = voidLifecyclePair();
    delete voidedEvent.after.snapshot[side === "batch" ? "costBatch" : "inbox"][field];
    await expect(buildSyncPostgresPlan(envelope([voidedEvent]))).rejects.toMatchObject({
      code: "VOID_METADATA_REQUIRED",
      status: 409,
    });
  });

  it("commits once and makes an identical retry a business no-op", async () => {
    const payload = envelope([event({ snapshot: productSnapshot() })]);
    const client = fakeClient();
    const first = await applySyncEnvelopeWithPostgresClient(payload, { client, context: { syncVersion: "S-1" } });
    const businessWritesAfterFirst = client.calls.filter((call) => call.text.startsWith("insert into public.products")).length;
    const second = await applySyncEnvelopeWithPostgresClient(payload, { client, context: { syncVersion: "S-2" } });
    expect(first).toMatchObject({ insertedEventCount: 1, replayedEventCount: 0, transaction: "committed" });
    expect(second).toMatchObject({ insertedEventCount: 0, replayedEventCount: 1, eventIds: ["E-1"] });
    expect(client.calls.filter((call) => call.text.startsWith("insert into public.products"))).toHaveLength(businessWritesAfterFirst);
    expect(client.calls.filter((call) => call.text === "commit")).toHaveLength(2);
  });

  it("rejects conflicting event ID reuse and rolls the whole transaction back", async () => {
    const client = fakeClient();
    await applySyncEnvelopeWithPostgresClient(envelope([event({ snapshot: productSnapshot() })]), { client });
    const changed = productSnapshot();
    changed.product.name = "被修改的商品";
    await expect(applySyncEnvelopeWithPostgresClient(envelope([event({ snapshot: changed })]), { client })).rejects.toMatchObject({ code: "EVENT_CONFLICT", status: 409, eventIds: ["E-1"] });
    expect(client.calls.at(-1).text).toBe("rollback");
  });

  it("rolls back any business failure without inserting the audit event", async () => {
    const client = fakeClient({ failOn: "insert into public.platform_skus" });
    await expect(applySyncEnvelopeWithPostgresClient(envelope([event({ snapshot: productSnapshot() })]), { client })).rejects.toThrow("database failure");
    expect(client.calls.at(-1).text).toBe("rollback");
    expect(client.calls.some((call) => call.text.startsWith("insert into public.audit_events"))).toBe(false);
    expect(client.calls.some((call) => call.text === "commit")).toBe(false);
  });

  it("enforces authorization and workspace visibility before business writes", async () => {
    const payload = envelope([event({ snapshot: productSnapshot() })]);
    const denied = fakeClient();
    await expect(applySyncEnvelopeWithPostgresClient(payload, { client: denied, authorize: () => false })).rejects.toMatchObject({ code: "WORKSPACE_FORBIDDEN" });
    expect(denied.calls).toHaveLength(0);

    const hidden = fakeClient({ workspaceVisible: false });
    await expect(applySyncEnvelopeWithPostgresClient(payload, { client: hidden })).rejects.toMatchObject({ code: "WORKSPACE_FORBIDDEN" });
    expect(hidden.calls.at(-1).text).toBe("rollback");
    expect(hidden.calls.some((call) => call.text.startsWith("insert into public.products"))).toBe(false);
  });

  it("rejects cross-workspace snapshots before opening a transaction", async () => {
    const client = fakeClient();
    await expect(buildSyncPostgresPlan(envelope([event({ snapshot: productSnapshot("workspace-other") })]))).rejects.toMatchObject({ code: "WORKSPACE_MISMATCH" });
    expect(client.calls).toHaveLength(0);
  });

  it("accepts 500 production events and rejects 501 before opening a transaction", async () => {
    const auditEvents = (count) => Array.from({ length: count }, (_, index) => event({
      eventId: `E-LIMIT-${index}`,
      objectType: "workspace",
      objectId: "workspace-default",
      action: "backup_exported",
    }));
    const accepted = fakeClient();
    await expect(applySyncEnvelopeWithPostgresClient(envelope(auditEvents(500)), { client: accepted })).resolves.toMatchObject({
      insertedEventCount: 500,
    });
    const rejected = fakeClient();
    await expect(applySyncEnvelopeWithPostgresClient(envelope(auditEvents(501)), { client: rejected })).rejects.toMatchObject({
      code: "SYNC_BATCH_TOO_LARGE",
      status: 400,
    });
    expect(rejected.calls).toHaveLength(0);
  });

  it("does not include actorIdProvided in the persisted event content hash", async () => {
    const payload = envelope([event({ snapshot: productSnapshot() })]);
    const plan = await buildSyncPostgresPlan(payload);
    expect(plan.eventPlans[0].actorIdProvided).toBe(true);
    expect(plan.eventPlans[0].contentHash).toBe(await syncEventContentHash(plan.eventPlans[0].event));
    expect(plan.eventPlans[0].contentHash).not.toBe(await syncEventContentHash({ ...plan.eventPlans[0].event, actorIdProvided: true }));
  });

  it("guards finalized ledgers from deletion and repeated finalization", async () => {
    const deleteEvent = { ...event({ eventId: "E-D", objectType: "monthly_ledger", objectId: "L-1", action: "deleted" }), after: null };
    const client = fakeClient({ ledgerStatus: "finalized" });
    await expect(applySyncEnvelopeWithPostgresClient(envelope([deleteEvent]), { client })).rejects.toMatchObject({ code: "LEDGER_IMMUTABLE" });
    expect(client.calls.at(-1).text).toBe("rollback");
    expect(client.calls.some((call) => call.text.startsWith("delete from public.ledgers"))).toBe(false);
  });

  it("rejects a stale draft deletion when PostgreSQL still has formal ERP lifecycle history", async () => {
    const deleteEvent = { ...event({ eventId: "E-D-FORMAL", objectType: "monthly_ledger", objectId: "L-1", action: "deleted" }), after: null };
    const client = fakeClient({ ledgerStatus: "draft", hasFormalLifecycle: true });
    await expect(applySyncEnvelopeWithPostgresClient(envelope([deleteEvent]), { client })).rejects.toMatchObject({
      code: "LEDGER_HAS_FORMAL_COST_HISTORY",
      status: 409,
    });
    expect(client.calls.at(-1).text).toBe("rollback");
    expect(client.calls.some((call) => call.text.startsWith("delete from public.ledgers"))).toBe(false);
  });

  it("guards stale ledger deletion when only an applied or voided inbox remains", async () => {
    const deleteEvent = { ...event({ eventId: "E-D-INBOX", objectType: "monthly_ledger", objectId: "L-1", action: "deleted" }), after: null };
    const plan = await buildSyncPostgresPlan(envelope([deleteEvent]));
    expect(plan.eventPlans[0].operations[0].text).toContain("from public.erp_cost_inbox i");
    expect(plan.eventPlans[0].operations[0].text).toContain("i.status in ('applied', 'voided')");
    const client = fakeClient({ ledgerStatus: "draft", hasFormalLifecycle: true });
    await expect(applySyncEnvelopeWithPostgresClient(envelope([deleteEvent]), { client })).rejects.toMatchObject({
      code: "LEDGER_HAS_FORMAL_COST_HISTORY",
      status: 409,
    });
    expect(client.calls.some((call) => call.text.startsWith("delete from public.ledgers"))).toBe(false);
  });
});
