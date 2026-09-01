import { describe, expect, it } from "vitest";
import { buildErpInboxQueue, evaluateErpInboxMatch } from "./erpInboxMatching";

const request = {
  id: "ERP-REQ-1",
  ledgerId: "LEDGER-1",
  platformSkcs: [{ platformSkc: "ＳＫＣ-2" }, { platformSkc: "skc-1" }],
};

const inbox = {
  status: "pending",
  ledgerId: "LEDGER-1",
  requestId: "ERP-REQ-1",
  envelope: {
    batch: {
      ledgerId: "LEDGER-1",
      requestId: "ERP-REQ-1",
      query: { platformSkcs: [{ platformSkc: "SKC-1" }, { platformSkc: "SKC-2" }] },
    },
  },
};

describe("ERP 收件批次严格匹配", () => {
  it("requires ledger, request, and the complete canonical SKC set", () => {
    expect(evaluateErpInboxMatch({ inbox, request, ledger: { id: "LEDGER-1", status: "cost_pending" } })).toMatchObject({
      scopeMatched: true,
      canAutoLoad: true,
      reason: "matched",
    });

    expect(evaluateErpInboxMatch({
      inbox: { ...inbox, requestId: "ERP-REQ-OLD", envelope: { batch: { ...inbox.envelope.batch, requestId: "ERP-REQ-OLD" } } },
      request,
      ledger: { id: "LEDGER-1", status: "cost_pending" },
    })).toMatchObject({ scopeMatched: false, canAutoLoad: false, reason: "request_mismatch" });

    expect(evaluateErpInboxMatch({
      inbox: { ...inbox, envelope: { batch: { ...inbox.envelope.batch, query: { platformSkcs: [{ platformSkc: "SKC-1" }] } } } },
      request,
      ledger: { id: "LEDGER-1", status: "cost_pending" },
    })).toMatchObject({ scopeMatched: false, canAutoLoad: false, reason: "skc_mismatch" });
  });

  it("keeps matched batches pending for finalized or locked ledgers", () => {
    expect(evaluateErpInboxMatch({ inbox, request, ledger: { id: "LEDGER-1", status: "finalized" } })).toMatchObject({
      scopeMatched: true,
      canAutoLoad: false,
      reason: "ledger_closed",
    });
  });

  it("orders pending batches oldest first and does not auto-load past a loaded batch", () => {
    const later = { ...inbox, id: "INBOX-LATER", envelope: { ...inbox.envelope, sentAt: "2026-08-19T02:00:00.000Z" } };
    const earlier = { ...inbox, id: "INBOX-EARLIER", envelope: { ...inbox.envelope, sentAt: "2026-08-19T01:00:00.000Z" } };
    const queue = buildErpInboxQueue({ inboxes: [later, earlier], requests: [request], ledger: { id: "LEDGER-1", status: "cost_pending" } });
    expect(queue.items.map((item) => item.inbox.id)).toEqual(["INBOX-EARLIER", "INBOX-LATER"]);
    expect(queue.autoLoad.inbox.id).toBe("INBOX-EARLIER");

    const blocked = buildErpInboxQueue({
      inboxes: [{ ...earlier, status: "loaded" }, later],
      requests: [request],
      ledger: { id: "LEDGER-1", status: "cost_pending" },
    });
    expect(blocked.autoLoad).toBeNull();
    expect(blocked.pendingCount).toBe(2);

    const otherLedgerLoaded = buildErpInboxQueue({
      inboxes: [{ ...earlier, status: "loaded", ledgerId: "LEDGER-OTHER", envelope: { batch: { ...earlier.envelope.batch, ledgerId: "LEDGER-OTHER" } } }, later],
      requests: [request],
      ledger: { id: "LEDGER-1", status: "cost_pending" },
    });
    expect(otherLedgerLoaded.autoLoad.inbox.id).toBe("INBOX-LATER");
  });

  it("keeps malformed SKC records in the queue as non-matching", () => {
    const malformed = { ...inbox, envelope: { batch: { ...inbox.envelope.batch, query: { platformSkcs: [null, {}, "SKC-1"] } } } };
    expect(() => buildErpInboxQueue({ inboxes: [malformed], requests: [request], ledger: { id: "LEDGER-1", status: "cost_pending" } })).not.toThrow();
    expect(buildErpInboxQueue({ inboxes: [malformed], requests: [request], ledger: { id: "LEDGER-1", status: "cost_pending" } }).items[0].reason).toBe("skc_mismatch");
  });

  it("keeps an old request visible but disables auto-load after the page SKC filter changes", () => {
    const queue = buildErpInboxQueue({
      inboxes: [inbox],
      requests: [request],
      ledger: { id: "LEDGER-1", status: "cost_pending" },
      currentPlatformSkcs: ["SKC-OTHER"],
    });
    expect(queue.autoLoad).toBeNull();
    expect(queue.items[0]).toMatchObject({
      scopeMatched: true,
      filterScopeMatched: false,
      canAutoLoad: false,
      reason: "current_filter_mismatch",
    });
  });
});
