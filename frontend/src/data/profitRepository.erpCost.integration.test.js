import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrGetMonthlyLedger,
  db,
  DEFAULT_WORKSPACE_ID,
  deleteMonthlyLedger,
  finalizeMonthlyLedger,
  getLatestLedgerCosts,
  markErpCostInboxStatus,
  receiveErpCostInboxEnvelope,
  rejectErpCostInboxBatches,
  selectProfitAuditActor,
  saveErpCostRequest,
  savePublishedErpCostBatch,
  setActiveMemberContext,
  voidPublishedErpCostBatch,
} from "./database";
import { buildErpCostRequest, reconcileErpCostRows } from "../domain/erpCosts";
import { buildErpCostBatchEnvelope } from "../domain/erpCostBatchEnvelope";
import { buildErpCostInboxEnvelope, parseErpInboxMessage } from "../domain/erpInboxContract";

const period = "2026-08";

function record(recordId, unitPrice, quantity = 1, purchaseDate = "2026-07-01") {
  return {
    recordId,
    warehouseSku: "WH-AUDIT",
    purchaseDate,
    quantity,
    unitPrice,
    eligible: true,
    exclusionReasons: [],
  };
}

async function context({
  platformSkcs = ["SKC-AUDIT"],
  expectedSkus = [{ platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT" }],
} = {}) {
  const ledger = await createOrGetMonthlyLedger({ period, createdBy: "repository-test" });
  const request = buildErpCostRequest({
    id: `ERP-REQ-${crypto.randomUUID()}`,
    workspaceId: DEFAULT_WORKSPACE_ID,
    ledgerId: ledger.id,
    platformSkcs,
    expectedSkus,
    requestedBy: "repository-test",
    requestedAt: "2026-08-12T08:00:00.000Z",
  });
  await saveErpCostRequest(request);
  return { ledger, request };
}

function reconcile({ purchaseRecords, resolutions = [], previewUnitCost = null }) {
  return reconcileErpCostRows({
    workspaceId: DEFAULT_WORKSPACE_ID,
    expectedSkus: [{ platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT", warehouseSku: "WH-AUDIT" }],
    costRows: [{
      platformSku: "SKU-AUDIT",
      platformSkc: "SKC-AUDIT",
      warehouseSku: "WH-AUDIT",
      previewUnitCost,
      purchaseRecords,
      evidenceComplete: true,
      supplierName: "审计供应商",
      supplier1688Url: "https://detail.1688.com/offer/730242606884.html",
      confirmed: true,
      formalCost: 99,
      manualUnitPrice: 99,
    }],
    resolutions,
  });
}

function sourceEnvelope({
  ledger,
  request,
  purchaseRecords,
  previewUnitCost = null,
  platformSkcs = ["SKC-AUDIT"],
  expectedSkus = null,
  mappings = [{ platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT" }],
} = {}) {
  return buildErpCostBatchEnvelope({
    batchId: `ERP-BATCH-${crypto.randomUUID()}`,
    workspaceId: DEFAULT_WORKSPACE_ID,
    ledgerId: ledger.id,
    requestId: request.id,
    platformSkcs,
    expectedSkus,
    generatedAt: "2026-08-12T08:15:00.000Z",
    results: [{
      warehouseSku: "WH-AUDIT",
      mappings,
      previewUnitCost,
      supplierName: "审计供应商",
      supplier1688Url: "https://detail.1688.com/offer/730242606884.html",
    }],
    warehouseEvidence: [{
      warehouseSku: "WH-AUDIT",
      evidenceComplete: true,
      purchaseRecords,
    }],
  });
}

async function publishAppliedInbox({ ledger, request, unitPrice, deliveryId }) {
  if (await db.salesRows.where("ledgerId").equals(ledger.id).count() === 0) {
    await db.salesRows.add({ ledgerId: ledger.id, workspaceId: DEFAULT_WORKSPACE_ID, batchId: `IMPORT-${deliveryId}`, groupKey: `G-${deliveryId}`, platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT", quantity: 1, amount: 10 });
  }
  const purchaseRecords = [record(`${deliveryId}-R1`, unitPrice)];
  const batch = sourceEnvelope({ ledger, request, purchaseRecords, previewUnitCost: unitPrice });
  const received = await receiveErpCostInboxEnvelope({
    envelope: buildErpCostInboxEnvelope({ batch, deliveryId }),
    receivedVia: "test",
  });
  await markErpCostInboxStatus(received.id, "loaded");
  const published = await savePublishedErpCostBatch({
    ledgerId: ledger.id,
    inboxId: received.id,
    requestId: request.id,
    reconciliation: reconcile({ purchaseRecords, previewUnitCost: unitPrice }),
    sourceEnvelope: batch,
    sourceName: `ERP ${unitPrice}`,
  });
  return { inboxId: received.id, batchId: published.batchId };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("ERP cost repository independent recalculation", () => {
  it("uses the active member as the audit actor while retaining ERP Assistant as transport source", async () => {
    expect(selectProfitAuditActor({ requestedActor: "erp-assistant-v8" })).toBe("local-user");
    expect(selectProfitAuditActor({ activeMemberId: "finance-cloud-1", requestedActor: "erp-assistant-v8", cloudConfigured: true })).toBe("finance-cloud-1");
    expect(() => selectProfitAuditActor({ requestedActor: "local-user", cloudConfigured: true })).toThrow("已登录的工作区成员");

    const { ledger, request } = await context();
    await setActiveMemberContext({ memberId: "finance-cloud-1", role: "finance", workspaceId: DEFAULT_WORKSPACE_ID });
    const purchaseRecords = [record("ACTOR-R1", 4)];
    const batch = sourceEnvelope({ ledger, request, purchaseRecords, previewUnitCost: 4 });
    const received = await receiveErpCostInboxEnvelope({
      envelope: buildErpCostInboxEnvelope({ batch, deliveryId: `ERP-ACTOR-${crypto.randomUUID()}` }),
      receivedVia: "local-http",
    });
    await rejectErpCostInboxBatches({ ids: [received.id], rejectedBy: "local-user" });

    const audits = await db.auditEvents.where("objectId").equals(received.id).toArray();
    expect(audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "received", actorId: "finance-cloud-1", after: expect.objectContaining({ receivedVia: "local-http" }) }),
      expect.objectContaining({ action: "rejected", actorId: "finance-cloud-1" }),
    ]));
    expect(await db.erpCostInbox.get(received.id)).toMatchObject({ receivedVia: "local-http", rejectedBy: "finance-cloud-1" });
  });

  it("acknowledges an idempotent ERP delivery without resolving a new audit actor", async () => {
    const { ledger, request } = await context();
    const purchaseRecords = [record("IDEMPOTENT-ACTOR-R1", 4)];
    const batch = sourceEnvelope({ ledger, request, purchaseRecords, previewUnitCost: 4 });
    const envelope = buildErpCostInboxEnvelope({ batch, deliveryId: `ERP-IDEMPOTENT-${crypto.randomUUID()}` });
    const first = await receiveErpCostInboxEnvelope({ envelope, receivedVia: "local-http" });
    const settingsRead = vi.spyOn(db.settings, "get").mockRejectedValue(new Error("member context unavailable"));

    await expect(receiveErpCostInboxEnvelope({ envelope, receivedVia: "local-http" })).resolves.toMatchObject({
      id: first.id,
      idempotent: true,
    });
    expect(settingsRead).not.toHaveBeenCalled();
    settingsRead.mockRestore();
  });

  it("publishes only expected rows while retaining shared-warehouse auxiliary evidence in the source contract", async () => {
    const expectedSkus = [{ platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT" }];
    const { ledger, request } = await context({ platformSkcs: ["SKC-AUDIT", "SKC-AUX"], expectedSkus });
    const purchaseRecords = Array.from({ length: 12 }, (_, index) => record(`SHARED-${index + 1}`, 4, 1, `2026-07-${String(index + 1).padStart(2, "0")}`));
    const reconciliation = reconcile({ purchaseRecords, previewUnitCost: 4 });
    const envelope = sourceEnvelope({
      ledger,
      request,
      purchaseRecords,
      previewUnitCost: 4,
      platformSkcs: ["SKC-AUDIT", "SKC-AUX"],
      expectedSkus,
      mappings: [
        { platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT", ledgerScopeRole: "expected" },
        { platformSku: "SKU-AUX", platformSkc: "SKC-AUX", ledgerScopeRole: "auxiliary" },
      ],
    });
    const published = await savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: envelope,
    });
    const storedRows = await db.erpCostRows.where("batchId").equals(published.batchId).toArray();
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0].platformSku).toBe("SKU-AUDIT");
    const savedBatch = await db.erpCostBatches.get(published.batchId);
    expect(savedBatch.sourceContract.warehouseEvidence[0].purchaseRecords).toHaveLength(12);
  });

  it("rejects an auxiliary row if the page tries to publish it as a formal match", async () => {
    const expectedSkus = [{ platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT" }];
    const { ledger, request } = await context({ platformSkcs: ["SKC-AUDIT", "SKC-AUX"], expectedSkus });
    const purchaseRecords = [record("R1", 4)];
    const reconciliation = reconcile({ purchaseRecords, previewUnitCost: 4 });
    reconciliation.matches[0].ledgerScopeRole = "auxiliary";
    const envelope = sourceEnvelope({
      ledger,
      request,
      purchaseRecords,
      previewUnitCost: 4,
      platformSkcs: ["SKC-AUDIT", "SKC-AUX"],
      expectedSkus,
      mappings: [
        { platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT", ledgerScopeRole: "expected" },
        { platformSku: "SKU-AUX", platformSkc: "SKC-AUX", ledgerScopeRole: "auxiliary" },
      ],
    });
    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: envelope,
    })).rejects.toThrow("不是当前账本 expected 范围");
  });

  it("keeps a verified expected-plus-auxiliary inbox complete when receiving it with its recorded request", async () => {
    const expectedSkus = [{ platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT" }];
    const { ledger, request } = await context({ platformSkcs: ["SKC-AUDIT", "SKC-AUX"], expectedSkus });
    const purchaseRecords = Array.from({ length: 12 }, (_, index) => record(`INBOX-SHARED-${index + 1}`, 4));
    const batch = sourceEnvelope({
      ledger,
      request,
      purchaseRecords,
      previewUnitCost: 4,
      platformSkcs: ["SKC-AUDIT", "SKC-AUX"],
      expectedSkus,
      mappings: [
        { platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT", ledgerScopeRole: "expected" },
        { platformSku: "SKU-AUX", platformSkc: "SKC-AUX", ledgerScopeRole: "auxiliary" },
      ],
    });
    const deliveryId = `ERP-DELIVERY-${crypto.randomUUID()}`;
    await receiveErpCostInboxEnvelope({
      envelope: {
        type: "shopeers.erp.cost.batch",
        source: "erp-assistant-v8",
        format: "shopeers-erp-cost-inbox",
        formatVersion: 2,
        deliveryId,
        sentAt: "2026-08-12T08:16:00.000Z",
        transport: "local-http",
        baseline: batch.baseline,
        batch,
      },
      receivedVia: "test",
    });
    const stored = await db.erpCostInbox.where("deliveryId").equals(deliveryId).first();
    expect(stored.envelope.batch.evidenceStatus).toBe("complete");
    expect(stored.envelope.batch.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ platformSku: "SKU-AUDIT", ledgerScopeRole: "expected" }),
      expect.objectContaining({ platformSku: "SKU-AUX", ledgerScopeRole: "auxiliary" }),
    ]));
  });

  it("loads 19 of 19 expected rows from inbox while retaining a shared-warehouse auxiliary variant as audit-only", async () => {
    const querySkcs = [
      "st260608151900573902683",
      "st260606170768328630349",
      "SKC-SHARED-3",
      "SKC-SHARED-4",
      "SKC-SHARED-5",
      "SKC-SHARED-6",
      "SKC-SHARED-7",
    ];
    const expectedSkus = [
      { platformSku: "I3mqgejkr1vhv7", platformSkc: querySkcs[0] },
      ...Array.from({ length: 18 }, (_, index) => ({
        platformSku: `SKU-SHARED-EXPECTED-${String(index + 2).padStart(2, "0")}`,
        platformSkc: querySkcs[(index + 2) % querySkcs.length],
      })),
    ];
    const { ledger, request } = await context({ platformSkcs: querySkcs, expectedSkus });
    const sharedWarehouseSku = "SH25092037232977233-Y";
    const results = expectedSkus.map((item, index) => ({
      warehouseSku: index === 0 ? sharedWarehouseSku : `WH-SHARED-EXPECTED-${index + 1}`,
      mappings: index === 0 ? [
        { ...item, ledgerScopeRole: "expected" },
        { platformSku: "I0mr8u67we1unj", platformSkc: querySkcs[1], ledgerScopeRole: "auxiliary" },
      ] : [{ ...item, ledgerScopeRole: "expected" }],
      previewUnitCost: 4,
    }));
    const warehouseEvidence = results.map((result, index) => ({
      warehouseSku: result.warehouseSku,
      evidenceComplete: true,
      purchaseRecords: Array.from({ length: index === 0 ? 12 : 1 }, (_, recordIndex) => ({
        recordId: `SHARED-${index + 1}-${recordIndex + 1}`,
        warehouseSku: result.warehouseSku,
        purchaseDate: `2026-07-${String(recordIndex + 1).padStart(2, "0")}`,
        quantity: 1,
        unitPrice: 4,
        eligible: true,
      })),
      excludedRecords: [],
    }));
    const batch = buildErpCostBatchEnvelope({
      batchId: `ERP-BATCH-${crypto.randomUUID()}`,
      workspaceId: DEFAULT_WORKSPACE_ID,
      ledgerId: ledger.id,
      requestId: request.id,
      platformSkcs: querySkcs,
      expectedSkus,
      generatedAt: "2026-08-20T08:15:00.000Z",
      results,
      warehouseEvidence,
    });
    const deliveryId = `ERP-DELIVERY-${crypto.randomUUID()}`;
    await receiveErpCostInboxEnvelope({
      envelope: {
        type: "shopeers.erp.cost.batch",
        source: "erp-assistant-v8",
        format: "shopeers-erp-cost-inbox",
        formatVersion: 2,
        deliveryId,
        sentAt: "2026-08-20T08:16:00.000Z",
        transport: "local-http",
        baseline: batch.baseline,
        batch,
      },
      receivedVia: "test",
    });
    const storedInbox = await db.erpCostInbox.where("deliveryId").equals(deliveryId).first();
    await markErpCostInboxStatus(storedInbox.id, "loaded");
    const parsed = parseErpInboxMessage(storedInbox.envelope, {
      expectedWorkspaceId: DEFAULT_WORKSPACE_ID,
      expectedLedgerId: ledger.id,
      expectedRequestId: request.id,
      expectedPlatformSkcs: request.platformSkcs,
      expectedSkus: request.expectedSkus,
    });
    const reconciliation = reconcileErpCostRows({
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedSkus,
      costRows: parsed.rows,
      batchId: batch.batchId,
    });
    expect(reconciliation.summary).toMatchObject({ matchedCount: 19, missingCount: 0, auxiliaryCount: 1 });
    expect(reconciliation.auxiliaryCostRows).toEqual([
      expect.objectContaining({ platformSku: "I0mr8u67we1unj", ledgerScopeRole: "auxiliary", warehouseSku: sharedWarehouseSku }),
    ]);
    const published = await savePublishedErpCostBatch({
      ledgerId: ledger.id,
      inboxId: storedInbox.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: parsed.batch,
    });
    const storedFormalRows = await db.erpCostRows.where("batchId").equals(published.batchId).toArray();
    expect(storedFormalRows).toHaveLength(19);
    expect(storedFormalRows.some((row) => row.platformSku === "I0mr8u67we1unj")).toBe(false);
  });

  it("rejects formal publication when an old recorded request cannot verify declared auxiliary scope", async () => {
    const expectedSkus = [{ platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT" }];
    const { ledger, request } = await context({ platformSkcs: ["SKC-AUDIT", "SKC-AUX"], expectedSkus });
    const purchaseRecords = [record("OLD-REQUEST", 4)];
    const reconciliation = reconcile({ purchaseRecords, previewUnitCost: 4 });
    const envelope = sourceEnvelope({
      ledger,
      request,
      purchaseRecords,
      previewUnitCost: 4,
      platformSkcs: ["SKC-AUDIT", "SKC-AUX"],
      expectedSkus,
      mappings: [
        { platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT", ledgerScopeRole: "expected" },
        { platformSku: "SKU-AUX", platformSkc: "SKC-AUX", ledgerScopeRole: "auxiliary" },
      ],
    });
    await db.erpCostRequests.update(request.id, { expectedSkus: [] });
    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: envelope,
    })).rejects.toThrow("缺少精确 expected SKU 范围");
  });

  it("rejects unresolved evidence even when extension decision fields claim confirmation", async () => {
    const { ledger, request } = await context();
    const reconciliation = reconcile({ purchaseRecords: [record("ONE", 1)] });
    expect(reconciliation.matches[0].status).toBe("anomaly_pending");
    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: sourceEnvelope({ ledger, request, purchaseRecords: [record("ONE", 1)], previewUnitCost: 99 }),
    })).rejects.toThrow("未在 Shopeers 完成处置");
  });

  it("publishes a verified one-yuan true price with immutable evidence and resolution audit", async () => {
    const { ledger, request } = await context();
    const resolutions = [{
      warehouseSku: "WH-AUDIT",
      recordId: "ONE",
      action: "confirm_true_price",
      originalUnitPrice: 1,
      resolvedUnitPrice: 1,
      reason: "已与供应商账单核对，真实采购价为 1 元",
      resolvedBy: "finance-1",
      resolvedAt: "2026-08-12T08:30:00.000Z",
    }];
    const reconciliation = reconcile({ purchaseRecords: [record("ONE", 1, 2)], resolutions, previewUnitCost: 99 });
    const published = await savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: sourceEnvelope({ ledger, request, purchaseRecords: [record("ONE", 1, 2)], previewUnitCost: 99 }),
      publishedBy: "finance-1",
    });
    const [stored] = await db.erpCostRows.where("batchId").equals(published.batchId).toArray();
    expect(stored).toMatchObject({
      unitCost: 1,
      resolutionStatus: "resolved",
      unresolvedAnomalyCount: 0,
      supplierName: "审计供应商",
      supplier1688Url: "https://detail.1688.com/offer/730242606884.html",
      purchaseRecords: [{ recordId: "ONE", unitPrice: 1 }],
      resolutions: [{ recordId: "ONE", action: "confirm_true_price", resolvedUnitPrice: 1 }],
    });
  });

  it("rejects zero-price true confirmation and accepts a positive correction", async () => {
    const { ledger, request } = await context();
    const invalid = reconcile({
      purchaseRecords: [record("ZERO", 0)],
      resolutions: [{
        warehouseSku: "WH-AUDIT",
        recordId: "ZERO",
        action: "confirm_true_price",
        originalUnitPrice: 0,
        resolvedUnitPrice: 0,
        resolvedBy: "finance-1",
        resolvedAt: "2026-08-12T08:30:00.000Z",
      }],
    });
    expect(invalid.matches[0].status).toBe("anomaly_pending");

    const corrected = reconcile({
      purchaseRecords: [record("ZERO", 0, 2), record("R2", 2, 1, "2026-06-02"), record("R1", 3, 1, "2026-06-01")],
      resolutions: [{
        warehouseSku: "WH-AUDIT",
        recordId: "ZERO",
        action: "correct_price",
        originalUnitPrice: 0,
        resolvedUnitPrice: 4,
        reason: "ERP 录入错误",
        resolvedBy: "finance-1",
        resolvedAt: "2026-08-12T08:30:00.000Z",
      }],
    });
    const correctedRecords = [record("ZERO", 0, 2), record("R2", 2, 1, "2026-06-02"), record("R1", 3, 1, "2026-06-01")];
    const published = await savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation: corrected,
      sourceEnvelope: sourceEnvelope({ ledger, request, purchaseRecords: correctedRecords }),
    });
    const [stored] = await db.erpCostRows.where("batchId").equals(published.batchId).toArray();
    expect(stored.unitCost).toBe(3.25);
  });

  it("rejects a page cost that differs from repository recalculation", async () => {
    const { ledger, request } = await context();
    const reconciliation = reconcile({ purchaseRecords: [record("R1", 4)] });
    reconciliation.matches[0].unitCost = 8;
    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: sourceEnvelope({ ledger, request, purchaseRecords: [record("R1", 4)] }),
    })).rejects.toThrow("页面成本与仓储层独立复算结果不一致");
  });

  it("keeps TSV and legacy summary rows preview-only", async () => {
    const { ledger, request } = await context();
    const reconciliation = reconcile({ purchaseRecords: [record("R1", 4)] });
    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: null,
    })).rejects.toThrow("TSV、旧批次和页面汇总只能预览");
  });

  it("rejects malformed source warnings before formal publication", async () => {
    const { ledger, request } = await context();
    const purchaseRecords = [record("R1", 4)];
    const reconciliation = reconcile({ purchaseRecords });
    const envelope = sourceEnvelope({ ledger, request, purchaseRecords });
    envelope.sourceMeta = { ...envelope.sourceMeta, sourceWarnings: "malformed-warning" };
    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: envelope,
    })).rejects.toThrow("来源警告");
  });

  it.each(["row", "evidence"])("rejects malformed %s source warnings before formal publication", async (target) => {
    const { ledger, request } = await context();
    const purchaseRecords = [record("R1", 4)];
    const reconciliation = reconcile({ purchaseRecords, previewUnitCost: 4 });
    const envelope = sourceEnvelope({ ledger, request, purchaseRecords, previewUnitCost: 4 });
    if (target === "row") envelope.rows[0] = { ...envelope.rows[0], sourceWarnings: "malformed-warning" };
    else envelope.warehouseEvidence[0] = { ...envelope.warehouseEvidence[0], sourceWarnings: { code: "malformed-warning" } };
    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: envelope,
    })).rejects.toThrow("来源警告");
  });

  it("rejects an outer-v1 inbox batch even when the inner v2 evidence is complete", async () => {
    const { ledger, request } = await context();
    const purchaseRecords = [record("R1", 4)];
    const reconciliation = reconcile({ purchaseRecords, previewUnitCost: 4 });
    const inbox = buildErpCostInboxEnvelope({
      batch: sourceEnvelope({ ledger, request, purchaseRecords, previewUnitCost: 4 }),
      deliveryId: "DELIVERY-LEGACY-REPOSITORY",
    });
    const parsed = parseErpInboxMessage({ ...inbox, formatVersion: 1 });
    expect(parsed.batch.evidenceStatus).toBe("legacy_partial");
    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: parsed.batch,
    })).rejects.toThrow("旧批次");
  });

  it("keeps a valid source warning array preview-only", async () => {
    const { ledger, request } = await context();
    const purchaseRecords = [record("R1", 4)];
    const reconciliation = reconcile({ purchaseRecords });
    const envelope = sourceEnvelope({ ledger, request, purchaseRecords });
    envelope.sourceMeta = { ...envelope.sourceMeta, sourceWarnings: ["top-level-collection-warning"] };
    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation,
      sourceEnvelope: envelope,
    })).rejects.toThrow("完整采购证据");
  });

  it("accepts formal rows only when their parent batch is explicitly published", async () => {
    const { ledger } = await context();
    await db.erpCostBatches.bulkAdd([
      { id: "B-PUBLISHED", workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: ledger.id, status: "published" },
      { id: "B-UNKNOWN", workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: ledger.id, status: "migrating" },
    ]);
    await db.erpCostRows.bulkAdd([
      { batchId: "B-PUBLISHED", ledgerId: ledger.id, workspaceId: DEFAULT_WORKSPACE_ID, platformSku: "SKU-VALID", canonicalPlatformSku: "SKU-VALID", unitCost: 4, publishedAt: "2026-08-20T00:00:00.000Z" },
      { batchId: "B-PUBLISHED", ledgerId: ledger.id, workspaceId: DEFAULT_WORKSPACE_ID, platformSku: "SKU-UNKNOWN", canonicalPlatformSku: "SKU-UNKNOWN", unitCost: 3, publishedAt: "2026-08-20T00:00:00.000Z" },
      { batchId: "B-UNKNOWN", ledgerId: ledger.id, workspaceId: DEFAULT_WORKSPACE_ID, platformSku: "SKU-UNKNOWN", canonicalPlatformSku: "SKU-UNKNOWN", unitCost: 9, publishedAt: "2026-08-21T00:00:00.000Z" },
      { batchId: "B-MISSING", ledgerId: ledger.id, workspaceId: DEFAULT_WORKSPACE_ID, platformSku: "SKU-MISSING", canonicalPlatformSku: "SKU-MISSING", unitCost: 8, publishedAt: "2026-08-22T00:00:00.000Z" },
    ]);

    expect((await getLatestLedgerCosts(ledger.id)).map((row) => row.platformSku)).toEqual(["SKU-VALID"]);
  });

  it("creates an applied audit inbox for a manual complete-v2 publication so it can be voided", async () => {
    const { ledger, request } = await context();
    await db.salesRows.add({ ledgerId: ledger.id, workspaceId: DEFAULT_WORKSPACE_ID, batchId: "IMPORT-MANUAL", groupKey: "G-MANUAL", platformSku: "SKU-AUDIT", platformSkc: "SKC-AUDIT", quantity: 1, amount: 10 });
    const purchaseRecords = [record("MANUAL-R1", 4)];
    const source = sourceEnvelope({ ledger, request, purchaseRecords, previewUnitCost: 4 });
    const published = await savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation: reconcile({ purchaseRecords, previewUnitCost: 4 }),
      sourceEnvelope: source,
      sourceName: "manual-v2.json",
    });

    expect(published.inboxId).toBeTruthy();
    expect(await db.erpCostInbox.get(published.inboxId)).toMatchObject({
      batchId: source.batchId,
      status: "applied",
      appliedBatchId: published.batchId,
      receivedVia: "manual-v2-import",
      envelope: expect.any(Object),
    });
    const publishedAudit = (await db.auditEvents.where("objectId").equals(published.batchId).toArray())
      .find((event) => event.action === "published");
    expect(publishedAudit.after.snapshot.inbox).toMatchObject({
      id: published.inboxId,
      status: "applied",
      appliedBatchId: published.batchId,
      envelope: expect.any(Object),
    });
    await voidPublishedErpCostBatch({ inboxId: published.inboxId, reason: "手工导入批次复核作废" });
    expect(await db.erpCostBatches.get(published.batchId)).toMatchObject({ status: "voided" });
  });

  it("rolls back formal publication when the linked inbox cannot transition to applied", async () => {
    const { ledger, request } = await context();
    const purchaseRecords = [record("ATOMIC-R1", 4)];
    const batch = sourceEnvelope({ ledger, request, purchaseRecords, previewUnitCost: 4 });
    const received = await receiveErpCostInboxEnvelope({
      envelope: buildErpCostInboxEnvelope({ batch, deliveryId: "DELIVERY-ATOMIC-ROLLBACK" }),
      receivedVia: "test",
    });
    await markErpCostInboxStatus(received.id, "loaded");
    const batchCountBefore = await db.erpCostBatches.count();
    const rowCountBefore = await db.erpCostRows.count();
    const auditCountBefore = await db.auditEvents.count();
    const failInboxUpdate = () => {
      throw new Error("simulated inbox write failure");
    };
    db.erpCostInbox.hook("updating", failInboxUpdate);

    try {
      await expect(savePublishedErpCostBatch({
        ledgerId: ledger.id,
        inboxId: received.id,
        requestId: request.id,
        reconciliation: reconcile({ purchaseRecords, previewUnitCost: 4 }),
        sourceEnvelope: batch,
      })).rejects.toThrow("simulated inbox write failure");
    } finally {
      db.erpCostInbox.hook("updating").unsubscribe(failInboxUpdate);
    }

    expect(await db.erpCostBatches.count()).toBe(batchCountBefore);
    expect(await db.erpCostRows.count()).toBe(rowCountBefore);
    expect(await db.auditEvents.count()).toBe(auditCountBefore);
    expect(await db.erpCostInbox.get(received.id)).toMatchObject({ status: "loaded" });
    expect(await db.ledgers.get(ledger.id)).not.toHaveProperty("costSummary");
  });

  it("rejects a stale envelope after its loaded inbox was deleted", async () => {
    const { ledger, request } = await context();
    const purchaseRecords = [record("REJECTED-R1", 4)];
    const batch = sourceEnvelope({ ledger, request, purchaseRecords, previewUnitCost: 4 });
    const received = await receiveErpCostInboxEnvelope({
      envelope: buildErpCostInboxEnvelope({ batch, deliveryId: "DELIVERY-REJECTED-DRAFT" }),
      receivedVia: "test",
    });
    await markErpCostInboxStatus(received.id, "loaded");
    await rejectErpCostInboxBatches({ ids: [received.id] });

    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      requestId: request.id,
      reconciliation: reconcile({ purchaseRecords, previewUnitCost: 4 }),
      sourceEnvelope: batch,
    })).rejects.toThrow("收件批次");
    expect(await db.erpCostBatches.count()).toBe(0);
    expect(await db.erpCostRows.count()).toBe(0);
  });

  it("voids an applied batch without deleting its formal rows or source evidence", async () => {
    const { ledger, request } = await context();
    const applied = await publishAppliedInbox({ ledger, request, unitPrice: 4, deliveryId: "DELIVERY-VOID" });

    const result = await voidPublishedErpCostBatch({
      inboxId: applied.inboxId,
      reason: "采购价录入错误，等待重新采集",
      voidedBy: "finance-1",
    });

    expect(result).toMatchObject({ batchId: applied.batchId, reopened: false, missingCount: 1 });
    expect(await db.erpCostBatches.get(applied.batchId)).toMatchObject({ status: "voided", voidReason: "采购价录入错误，等待重新采集" });
    expect(await db.erpCostInbox.get(applied.inboxId)).toMatchObject({ status: "voided", voidedBatchId: applied.batchId });
    expect(await db.erpCostRows.where("batchId").equals(applied.batchId).count()).toBe(1);
    expect((await db.erpCostBatches.get(applied.batchId)).sourceContract.warehouseEvidence).toHaveLength(1);
    expect(await getLatestLedgerCosts(ledger.id)).toEqual([]);
    expect(await db.ledgers.get(ledger.id)).toMatchObject({ status: "cost_pending", costSummary: { missingCount: 1 } });
  });

  it("reopens a finalized ledger with a reason and preserves the previous profit snapshot in audit", async () => {
    const { ledger, request } = await context();
    const applied = await publishAppliedInbox({ ledger, request, unitPrice: 4, deliveryId: "DELIVERY-FINAL" });
    await finalizeMonthlyLedger({
      ledgerId: ledger.id,
      profitLines: [{ platformSku: "SKU-AUDIT", canonicalPlatformSku: "SKU-AUDIT", finalizable: true, profit: 6 }],
      profitSummary: { revenue: 10, purchaseCost: 4, profit: 6 },
      formulaVersion: "profit@1",
      finalizedBy: "finance-1",
    });

    await expect(voidPublishedErpCostBatch({ inboxId: applied.inboxId, reason: "", voidedBy: "finance-2" })).rejects.toThrow("必须填写原因");
    await voidPublishedErpCostBatch({ inboxId: applied.inboxId, reason: "月末复核发现采购单关联错误", voidedBy: "finance-2" });

    expect(await db.profitLines.where("ledgerId").equals(ledger.id).count()).toBe(0);
    const reopened = await db.ledgers.get(ledger.id);
    expect(reopened).toMatchObject({ status: "cost_pending" });
    expect(reopened).not.toHaveProperty("profitSummary");
    expect(reopened).not.toHaveProperty("finalizedAt");
    const audit = (await db.auditEvents.where("objectId").equals(ledger.id).toArray()).find((event) => event.action === "reopened_for_cost_recalculation");
    expect(audit.before).toMatchObject({ status: "finalized", reason: "月末复核发现采购单关联错误", snapshot: { profitLines: [expect.objectContaining({ platformSku: "SKU-AUDIT", profit: 6 })] } });
    const voidAudit = (await db.auditEvents.where("objectId").equals(applied.batchId).toArray()).find((event) => event.action === "voided");
    expect(voidAudit.after).toMatchObject({
      transitionId: audit.after.transitionId,
      voidedBatchId: applied.batchId,
      reason: audit.after.reason,
    });
    expect(voidAudit.actorId).toBe(audit.actorId);
    expect(voidAudit.createdAt).toBe(audit.createdAt);
  });

  it("rejects ordinary voiding for a locked ledger", async () => {
    const { ledger, request } = await context();
    const applied = await publishAppliedInbox({ ledger, request, unitPrice: 4, deliveryId: "DELIVERY-LOCKED" });
    await db.ledgers.update(ledger.id, { status: "locked", lockedAt: "2026-08-27T00:00:00.000Z", lockedBy: "finance-1" });
    await expect(voidPublishedErpCostBatch({ inboxId: applied.inboxId, reason: "测试", voidedBy: "finance-2" })).rejects.toThrow("已锁定账本");
    expect(await db.erpCostBatches.get(applied.batchId)).toMatchObject({ status: "published" });
  });

  it("does not fall back to an older formal cost after voiding the latest batch and allows a new batch to replace the tombstone", async () => {
    const { ledger, request } = await context();
    const older = await publishAppliedInbox({ ledger, request, unitPrice: 3, deliveryId: "DELIVERY-OLD" });
    await db.erpCostRows.where("batchId").equals(older.batchId).modify({ publishedAt: "2026-08-20T00:00:00.000Z" });
    const latest = await publishAppliedInbox({ ledger, request, unitPrice: 5, deliveryId: "DELIVERY-LATEST" });
    await db.erpCostRows.where("batchId").equals(latest.batchId).modify({ publishedAt: "2026-08-21T00:00:00.000Z" });
    expect((await getLatestLedgerCosts(ledger.id))[0].unitCost).toBe(5);

    await voidPublishedErpCostBatch({ inboxId: latest.inboxId, reason: "最新批次错误", voidedBy: "finance-1" });
    expect(await getLatestLedgerCosts(ledger.id)).toEqual([]);

    const replacement = await publishAppliedInbox({ ledger, request, unitPrice: 4, deliveryId: "DELIVERY-REPLACEMENT" });
    await db.erpCostRows.where("batchId").equals(replacement.batchId).modify({ publishedAt: "2026-08-22T00:00:00.000Z" });
    expect((await getLatestLedgerCosts(ledger.id))[0].unitCost).toBe(4);
  });

  it("refuses to physically delete a ledger once it has an applied or voided ERP lifecycle", async () => {
    const { ledger, request } = await context();
    const applied = await publishAppliedInbox({ ledger, request, unitPrice: 4, deliveryId: "DELIVERY-NODELETE" });
    await expect(deleteMonthlyLedger(ledger.id)).rejects.toThrow("正式 ERP 成本生命周期");
    expect(await db.ledgers.get(ledger.id)).toBeTruthy();
    expect(await db.erpCostBatches.get(applied.batchId)).toMatchObject({ status: "published" });

    await voidPublishedErpCostBatch({ inboxId: applied.inboxId, reason: "验证作废记录仍不可物理删除" });
    await expect(deleteMonthlyLedger(ledger.id)).rejects.toThrow("正式 ERP 成本生命周期");
    expect(await db.erpCostInbox.get(applied.inboxId)).toMatchObject({ status: "voided" });
    expect(await db.erpCostRows.where("batchId").equals(applied.batchId).count()).toBe(1);
  });
});
