import { describe, expect, it } from "vitest";
import {
  activeSelectionStatusDefinitions,
  createCustomSelectionStatus,
  defaultSelectionStatusDefinitions,
  normalizeSelectionStatusDefinitions,
  resolveSelectionStatusId,
  selectionStatusById,
} from "./selectionStatuses";

describe("selection status definitions", () => {
  it("keeps legacy statuses readable while providing the new working defaults", () => {
    const definitions = defaultSelectionStatusDefinitions();
    expect(resolveSelectionStatusId("observing", definitions)).toBe("observing");
    expect(selectionStatusById(definitions, "on_sale")).toMatchObject({ label: "在售", requiresReadiness: true });
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
