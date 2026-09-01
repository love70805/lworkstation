import { describe, expect, it, vi } from "vitest";
import { receiveAndAcknowledgeInboxRecord } from "./inboxDelivery";

describe("inbox delivery acknowledgement", () => {
  it("does not acknowledge a record when parsing or persistence fails", async () => {
    const acknowledge = vi.fn();
    await expect(receiveAndAcknowledgeInboxRecord({
      record: { deliveryId: "invalid-record" },
      receive: vi.fn(async () => { throw new Error("invalid envelope"); }),
      acknowledge,
    })).rejects.toThrow("invalid envelope");
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("acknowledges only after the receiver returns an explicit success value", async () => {
    const order = [];
    const result = await receiveAndAcknowledgeInboxRecord({
      record: { deliveryId: "valid-record" },
      receive: vi.fn(async () => { order.push("receive"); return { id: "stored-record" }; }),
      acknowledge: vi.fn(async () => { order.push("acknowledge"); }),
    });
    expect(result).toEqual({ id: "stored-record" });
    expect(order).toEqual(["receive", "acknowledge"]);
  });

  it("keeps a record pending when a receiver returns no success signal", async () => {
    const acknowledge = vi.fn();
    await expect(receiveAndAcknowledgeInboxRecord({
      record: { deliveryId: "empty-result" },
      receive: vi.fn(async () => undefined),
      acknowledge,
    })).rejects.toMatchObject({ code: "INBOX_RECEIVE_FAILED" });
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
