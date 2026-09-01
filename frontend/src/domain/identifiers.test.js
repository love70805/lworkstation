import { describe, expect, it } from "vitest";
import {
  assertUniquePlatformSkus,
  canonicalPlatformSku,
  findPlatformSkuDuplicates,
  platformSkuIdentity,
} from "./identifiers";

describe("platform SKU identity", () => {
  it("normalizes width, whitespace, and case for the workspace uniqueness key", () => {
    expect(canonicalPlatformSku("  ａｂｃ-01  ")).toBe("ABC-01");
    expect(platformSkuIdentity("workspace-a", "abc-01")).toBe("workspace-a::ABC-01");
  });

  it("detects duplicates only inside the same workspace", () => {
    const records = [
      { id: "1", workspaceId: "workspace-a", platformSku: "sku-1" },
      { id: "2", workspaceId: "workspace-a", platformSku: " SKU-1 " },
      { id: "3", workspaceId: "workspace-b", platformSku: "sku-1" },
    ];

    expect(findPlatformSkuDuplicates(records)).toEqual([
      expect.objectContaining({ workspaceId: "workspace-a", canonicalPlatformSku: "SKU-1" }),
    ]);
    expect(() => assertUniquePlatformSkus(records)).toThrowError(expect.objectContaining({ code: "duplicate_platform_sku" }));
    expect(assertUniquePlatformSkus(records.slice(1))).toBe(true);
  });
});
