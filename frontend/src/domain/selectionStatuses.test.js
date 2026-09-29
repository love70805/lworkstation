import { describe, expect, it } from "vitest";
import {
  activeSelectionStatusDefinitions,
  createCustomSelectionStatus,
  defaultSelectionStatusDefinitions,
  normalizeSelectionStatusDefinitions,
  resolveSelectionStatusId,
  selectionStatusById,
  resolveProductStatus,
} from "./selectionStatuses";

describe("selection status definitions", () => {
  it("keeps legacy statuses readable while providing the new working defaults", () => {
    const definitions = defaultSelectionStatusDefinitions();
    expect(resolveSelectionStatusId("observing", definitions)).toBe("observing");
    expect(selectionStatusById(definitions, "on_sale")).toMatchObject({ label: "已上架", requiresReadiness: false });
  });

  it("merges publication aliases without changing legacy values or technical lifecycle", () => {
    const legacy = { status: "active", salesStatus: "on_sale", publicationStatus: "off_shelf" };
    expect(resolveProductStatus(legacy)).toMatchObject({ statusId: "on_sale", legacyConflict: true, legacyStatuses: { salesStatus: "on_sale", publicationStatus: "off_shelf" } });
    expect(legacy.publicationStatus).toBe("off_shelf");
    expect(resolveProductStatus({ status: "active" }).statusId).toBe("pending_review");
    expect(resolveProductStatus({ productStatus: "active", userStatus: "off_sale" }).statusId).toBe("off_sale");
    expect(resolveProductStatus({ productStatus: "off_sale", ...legacy }).legacyConflict).toBe(false);
    expect(resolveProductStatus({ salesStatus: "pending_review", publicationStatus: "published_pending_review" }).legacyConflict).toBe(false);
    expect(resolveProductStatus({ salesStatus: "sourcing", publicationStatus: "unpublished" }).statusId).toBe("sourcing");
    expect(resolveSelectionStatusId("listed")).toBe("on_sale");
    expect(resolveSelectionStatusId("off_shelf")).toBe("off_sale");
  });

  it("keeps custom IDs and adds missing merged stages to old definitions", () => {
    const definitions = normalizeSelectionStatusDefinitions([{ id: "on_sale", label: "在售", requiresReadiness: true }, { id: "custom-old", label: "旧自定义" }, { id: "旧自定义-ID", label: "保留标识" }]);
    expect(definitions.find(item => item.id === "on_sale")).toMatchObject({ label: "已上架", requiresReadiness: false });
    expect(definitions.some(item => item.id === "approved_pending_listing")).toBe(true);
    expect(definitions.find(item => item.id === "旧自定义-ID").label).toBe("保留标识");
    expect(resolveProductStatus({ salesStatus: "custom-old", publicationStatus: "listed" }, definitions)).toMatchObject({ statusId: "custom-old", legacyConflict: false });
  });

  it("allows a custom status and excludes archived statuses from normal choices", () => {
    const custom = createCustomSelectionStatus({ label: "等样品", tone: "warning" });
    const definitions = normalizeSelectionStatusDefinitions([
      ...defaultSelectionStatusDefinitions(),
      custom,
      { ...custom, id: "paused", label: "暂停跟进", archivedAt: "2026-08-10T00:00:00.000Z" },
    ]);

    expect(selectionStatusById(definitions, custom.id)).toMatchObject({ label: "等样品", tone: "warning" });
    expect(activeSelectionStatusDefinitions(definitions).some((status) => status.id === "paused")).toBe(false);
  });
});
