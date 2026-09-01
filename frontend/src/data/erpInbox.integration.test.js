import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getLatestErpCostInbox, listErpCostInbox, markErpCostInboxStatus, receiveErpCostInboxEnvelope, rejectErpCostInboxBatches, switchLoadedErpCostInbox } from "./database";
import { buildErpCostBatchEnvelope } from "../domain/erpCostBatchEnvelope";
import { buildErpCostInboxEnvelope } from "../domain/erpInboxContract";
import { buildErpInboxQueue } from "../domain/erpInboxMatching";
import { parseErpCostInput } from "../lib/erpCostImport";
import { switchLoadedErpInboxDraft } from "../lib/costMatching";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

function envelopeFixture({ batchId = "ERP-BATCH-INBOX-IT", deliveryId = "DELIVERY-IT", sentAt = "2026-08-08T01:00:00.000Z" } = {}) {
  const batch = buildErpCostBatchEnvelope({
    batchId,
    workspaceId: "workspace-default",
    ledgerId: "LEDGER-IT",
    requestId: "ERP-REQ-IT",
    platformSkcs: ["SKC-IT"],
    generatedAt: sentAt,
    results: [{ warehouseSku: "WH-IT", mappings: [{ platformSku: "SKU-IT", platformSkc: "SKC-IT" }], unitCost: 3.8 }],
    warehouseEvidence: [{ warehouseSku: "WH-IT", evidenceComplete: true, purchaseRecords: [{ recordId: `${batchId}-R1`, quantity: 1, unitPrice: 3.8, purchaseDate: "2026-07-01" }] }],
  });
  return buildErpCostInboxEnvelope({ batch, deliveryId, sentAt });
}

describe("ERP 本机收件箱", () => {
  it("stores a batch once and treats retries as idempotent", async () => {
    const envelope = envelopeFixture();
    const first = await receiveErpCostInboxEnvelope({ envelope, receivedVia: "test" });
    const second = await receiveErpCostInboxEnvelope({ envelope, receivedVia: "test" });
    expect(first).toMatchObject({ idempotent: false, batchId: "ERP-BATCH-INBOX-IT" });
    expect(second).toMatchObject({ idempotent: true, id: first.id });
    expect((await getLatestErpCostInbox("LEDGER-IT")).batchId).toBe("ERP-BATCH-INBOX-IT");
  });

  it("keeps applied, rejected and voided transitions behind dedicated repository flows", async () => {
    const envelope = envelopeFixture();
    const received = await receiveErpCostInboxEnvelope({ envelope });
    await expect(markErpCostInboxStatus(received.id, "applied", { appliedBatchId: "COST-1" })).rejects.toThrow("状态无效");
    await expect(markErpCostInboxStatus(received.id, "rejected")).rejects.toThrow("状态无效");
    await expect(markErpCostInboxStatus(received.id, "voided")).rejects.toThrow("状态无效");
    expect(await db.erpCostInbox.get(received.id)).toMatchObject({ status: "pending" });
  });

  it("rejects pending batches singly or in bulk while retaining envelopes and audit", async () => {
    const first = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-DELETE-1", deliveryId: "D-DELETE-1" }) });
    const second = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-DELETE-2", deliveryId: "D-DELETE-2" }) });
    const third = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-DELETE-3", deliveryId: "D-DELETE-3" }) });

    await rejectErpCostInboxBatches({ ids: [first.id], rejectedBy: "tester" });
    const bulk = await rejectErpCostInboxBatches({ ids: [second.id, third.id], rejectedBy: "tester" });

    expect(bulk.rejectedCount).toBe(2);
    expect(await db.erpCostInbox.get(first.id)).toMatchObject({ status: "rejected", rejectedBy: "tester", envelope: expect.any(Object) });
    expect(await db.erpCostInbox.get(second.id)).toMatchObject({ status: "rejected", rejectedBy: "tester", envelope: expect.any(Object) });
    expect(await db.erpCostInbox.get(third.id)).toMatchObject({ status: "rejected", rejectedBy: "tester", envelope: expect.any(Object) });
    expect((await db.auditEvents.where("objectType").equals("erp_cost_inbox").toArray()).filter((event) => event.action === "rejected")).toHaveLength(3);
  });

  it("rejects a loaded batch as a terminal state", async () => {
    const received = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-DELETE-LOADED", deliveryId: "D-DELETE-LOADED" }) });
    await markErpCostInboxStatus(received.id, "loaded");
    const result = await rejectErpCostInboxBatches({ ids: [received.id], rejectedBy: "tester" });
    expect(result).toMatchObject({ rejectedCount: 1, loadedIds: [received.id] });
    expect(await db.erpCostInbox.get(received.id)).toMatchObject({ status: "rejected" });
    await expect(markErpCostInboxStatus(received.id, "pending")).rejects.toThrow("不能重新进入待处理状态");
  });

  it("does not let the delete flow consume an applied batch or mutate a locked ledger inbox", async () => {
    const applied = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-APPLIED-NODELETE", deliveryId: "D-APPLIED-NODELETE" }) });
    await db.erpCostInbox.update(applied.id, { status: "applied", appliedBatchId: "COST-APPLIED" });
    await expect(rejectErpCostInboxBatches({ ids: [applied.id] })).rejects.toThrow("只有待处理或已载入");

    const locked = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-LOCKED-NODELETE", deliveryId: "D-LOCKED-NODELETE" }) });
    await db.ledgers.add({ id: "LEDGER-IT", workspaceId: "workspace-default", period: "2026-08", status: "locked" });
    await expect(rejectErpCostInboxBatches({ ids: [locked.id] })).rejects.toThrow("已锁定账本");
    expect(await db.erpCostInbox.get(locked.id)).toMatchObject({ status: "pending" });
  });

  it("lists pending batches oldest first and excludes processed batches", async () => {
    const later = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-LATER", deliveryId: "D-LATER", sentAt: "2026-08-08T02:00:00.000Z" }) });
    const earlier = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-EARLIER", deliveryId: "D-EARLIER", sentAt: "2026-08-08T01:00:00.000Z" }) });

    expect((await listErpCostInbox({ ledgerId: "LEDGER-IT", statuses: ["pending"] })).map((row) => row.batchId)).toEqual(["B-EARLIER", "B-LATER"]);

    await markErpCostInboxStatus(earlier.id, "loaded");
    expect((await listErpCostInbox({ ledgerId: "LEDGER-IT", statuses: ["pending"] })).map((row) => row.batchId)).toEqual(["B-LATER"]);
    expect((await listErpCostInbox({ ledgerId: "LEDGER-IT", statuses: ["pending", "loaded"] })).map((row) => row.batchId)).toEqual(["B-EARLIER", "B-LATER"]);
    expect(later.status).toBe("pending");
  });

  it("switches loaded batches atomically", async () => {
    const previous = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-PREVIOUS", deliveryId: "D-PREVIOUS" }) });
    const candidate = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-CANDIDATE", deliveryId: "D-CANDIDATE" }) });
    await markErpCostInboxStatus(previous.id, "loaded");

    await switchLoadedErpCostInbox({
      candidateId: candidate.id,
      previousId: previous.id,
      switchedAt: "2026-08-19T08:00:00.000Z",
    });

    expect(await db.erpCostInbox.get(candidate.id)).toMatchObject({ status: "loaded", loadedAt: "2026-08-19T08:00:00.000Z" });
    expect(await db.erpCostInbox.get(previous.id)).toMatchObject({ status: "pending", unloadReason: "switched_batch" });
  });

  it("leaves the candidate pending when concurrent state makes the transaction invalid", async () => {
    const previous = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-STALE", deliveryId: "D-STALE" }) });
    const candidate = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-NEXT", deliveryId: "D-NEXT" }) });
    await db.erpCostInbox.update(previous.id, { status: "applied", appliedBatchId: "COST-STALE" });

    await expect(switchLoadedErpCostInbox({
      candidateId: candidate.id,
      previousId: previous.id,
      switchedAt: "2026-08-19T08:00:00.000Z",
    })).rejects.toThrow("当前载入状态已变化");

    expect(await db.erpCostInbox.get(candidate.id)).toMatchObject({ status: "pending" });
    expect(await db.erpCostInbox.get(previous.id)).toMatchObject({ status: "applied" });
  });

  it("rolls back the candidate when the second write fails inside the transaction", async () => {
    const previous = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-ROLLBACK-PREVIOUS", deliveryId: "D-ROLLBACK-PREVIOUS" }) });
    const candidate = await receiveErpCostInboxEnvelope({ envelope: envelopeFixture({ batchId: "B-ROLLBACK-CANDIDATE", deliveryId: "D-ROLLBACK-CANDIDATE" }) });
    await markErpCostInboxStatus(previous.id, "loaded");
    const failPreviousWrite = (_changes, primaryKey) => {
      if (primaryKey === previous.id) throw new Error("forced second write failure");
    };
    db.erpCostInbox.hook("updating").subscribe(failPreviousWrite);
    try {
      await expect(switchLoadedErpCostInbox({
        candidateId: candidate.id,
        previousId: previous.id,
        switchedAt: "2026-08-19T08:00:00.000Z",
      })).rejects.toThrow("forced second write failure");
    } finally {
      db.erpCostInbox.hook("updating").unsubscribe(failPreviousWrite);
    }

    expect(await db.erpCostInbox.get(candidate.id)).toMatchObject({ status: "pending" });
    expect(await db.erpCostInbox.get(previous.id)).toMatchObject({ status: "loaded" });
  });

  it("loads a matching pending inbox through the CostMatching import path and leaves unmatched batches pending", async () => {
    await receiveErpCostInboxEnvelope({ envelope: envelopeFixture() });
    const [candidate] = await listErpCostInbox({ ledgerId: "LEDGER-IT", statuses: ["pending"] });
    const request = { id: "ERP-REQ-IT", ledgerId: "LEDGER-IT", platformSkcs: ["SKC-IT"] };
    const ledger = { id: "LEDGER-IT", status: "cost_pending" };
    const queue = buildErpInboxQueue({ inboxes: [candidate], requests: [request], ledger, currentPlatformSkcs: ["SKC-IT"] });
    expect(queue.autoLoad?.inbox.id).toBe(candidate.id);

    const parsed = await switchLoadedErpInboxDraft({
      candidate,
      parseCandidate: () => parseErpCostInput(JSON.stringify(candidate.envelope), {
        expectedWorkspaceId: "workspace-default",
        expectedLedgerId: "LEDGER-IT",
        expectedRequestId: "ERP-REQ-IT",
        expectedPlatformSkcs: ["SKC-IT"],
      }),
      switchStatus: switchLoadedErpCostInbox,
      now: () => "2026-08-19T08:00:00.000Z",
    });
    expect(parsed.envelope).toMatchObject({ batchId: "ERP-BATCH-INBOX-IT", evidenceStatus: "complete" });
    expect(await db.erpCostInbox.get(candidate.id)).toMatchObject({ status: "loaded" });

    const unmatched = buildErpInboxQueue({ inboxes: [candidate], requests: [request], ledger, currentPlatformSkcs: ["SKC-OTHER"] });
    expect(unmatched.autoLoad).toBeNull();
  });

  it("stores an outer-v1 inbox as preview-only legacy evidence", async () => {
    const envelope = envelopeFixture({ batchId: "B-LEGACY-PREVIEW", deliveryId: "D-LEGACY-PREVIEW" });
    const received = await receiveErpCostInboxEnvelope({ envelope: { ...envelope, formatVersion: 1 } });
    const stored = await db.erpCostInbox.get(received.id);
    const parsed = parseErpCostInput(JSON.stringify(stored.envelope), {
      expectedWorkspaceId: "workspace-default",
      expectedLedgerId: "LEDGER-IT",
      expectedRequestId: "ERP-REQ-IT",
      expectedPlatformSkcs: ["SKC-IT"],
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.envelope).toMatchObject({ sourceFormatVersion: 1, evidenceStatus: "legacy_partial" });
  });
});

