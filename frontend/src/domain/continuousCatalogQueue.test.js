import { describe, expect, it } from "vitest";
import { createContinuousCatalogQueue, checkContinuousCatalogIdentity } from "./continuousCatalogQueue";

describe("continuous catalog identity queue", () => {
  it("keeps full-list order while grouping multiple SKUs by canonical SKC and retaining missing-SKC stable identities", () => {
    const group = (platformSkc, platformSku) => ({ variants: [{ platformSkc, platformSku }] });
    const queue = createContinuousCatalogQueue("W", [group(" B ", "SKU-B1"), group("A", "SKU-A"), group("b", "SKU-B2"), group("", "S1"), group("", "S2"), { ...group("C", "SKU-C"), productId: "already-saved" }]);
    expect(queue.items.map(item => item.identity)).toEqual(["SKC:B", "SKC:A", "SKU:S1", "SKU:S2"]);
    expect(queue.workspaceId).toBe("W");
  });
  it("does not treat fallback blank drafts as source evidence or accept moved SKCs", () => {
    const item = { platformSkc: "A", platformSku: "A1" };
    expect(checkContinuousCatalogIdentity(item, { draft: { platformSkc: "A", variants: [{ platformSku: "A1" }] } })).toContain("移除");
    expect(checkContinuousCatalogIdentity(item, { draft: { platformSkc: "B" }, product: { id: "linked" } })).toContain("SKC 来源已变化");
  });
});
