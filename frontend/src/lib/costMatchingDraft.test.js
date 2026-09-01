import { describe, expect, it } from "vitest";
import { COST_DRAFT_STORAGE_PREFIX, clearCostDraft, costDraftKey, invalidateLegacyCostDrafts, readCostDraft, readRestorableCostDraft, writeCostDraft } from "./costMatchingDraft";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

describe("CostMatching versioned drafts", () => {
  it("invalidates all pre-reset draft keys without deleting current-version drafts", () => {
    const storage = memoryStorage({
      "shopeers:erp-cost-draft:LEDGER-OLD-1": "{}",
      "shopeers:erp-cost-draft:LEDGER-OLD-2": "{}",
      [`${COST_DRAFT_STORAGE_PREFIX}LEDGER-NEW`]: "{}",
      "unrelated-setting": "keep",
    });
    expect(invalidateLegacyCostDrafts(storage)).toBe(2);
    expect(storage.getItem("shopeers:erp-cost-draft:LEDGER-OLD-1")).toBeNull();
    expect(storage.getItem(`${COST_DRAFT_STORAGE_PREFIX}LEDGER-NEW`)).toBe("{}");
    expect(storage.getItem("unrelated-setting")).toBe("keep");
  });

  it("reads, expires and clears the current-version draft deterministically", () => {
    const storage = memoryStorage();
    writeCostDraft("LEDGER-1", { sourceText: "evidence", loadedInboxId: "INBOX-1" }, { storage, now: 1000 });
    expect(readCostDraft("LEDGER-1", { storage, now: 1001 })).toMatchObject({ sourceText: "evidence", loadedInboxId: "INBOX-1", updatedAt: 1000 });
    clearCostDraft("LEDGER-1", storage);
    expect(storage.getItem(costDraftKey("LEDGER-1"))).toBeNull();
  });

  it("fails closed when a persisted loaded draft points to a rejected inbox even if storage cleanup fails", async () => {
    const storage = memoryStorage();
    writeCostDraft("LEDGER-1", { sourceText: "evidence", loadedInboxId: "INBOX-REJECTED" }, { storage, now: 1000 });
    storage.removeItem = () => { throw new Error("storage unavailable"); };
    const restored = await readRestorableCostDraft("LEDGER-1", {
      storage,
      now: 1001,
      getInbox: async () => ({ id: "INBOX-REJECTED", status: "rejected" }),
    });
    expect(restored).toBeNull();
  });
});
