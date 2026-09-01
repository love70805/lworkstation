import { describe, expect, it } from "vitest";
import { assertCloudRoleCan, canCloudRole, cloudRoleMatrixSnapshot } from "./cloudPermissions";

describe("cloud role permission matrix", () => {
  it("覆盖五类工作区角色的核心职责", () => {
    expect(canCloudRole("selection", "products", "update")).toBe(true);
    expect(canCloudRole("selection", "profit_lines", "insert")).toBe(false);
    expect(canCloudRole("operations", "erp_cost_requests", "insert")).toBe(true);
    expect(canCloudRole("operations", "erp_cost_batches", "update")).toBe(false);
    expect(canCloudRole("operations", "erp_cost_inbox", "update")).toBe(false);
    expect(canCloudRole("finance", "erp_cost_batches", "update")).toBe(true);
    expect(canCloudRole("finance", "erp_cost_inbox", "update")).toBe(true);
    expect(canCloudRole("operations", "cost_approvals", "update")).toBe(false);
    expect(canCloudRole("finance", "profit_lines", "insert")).toBe(true);
    expect(canCloudRole("finance", "profit_lines", "delete")).toBe(true);
    expect(canCloudRole("operations", "profit_lines", "delete")).toBe(false);
    expect(canCloudRole("viewer", "products", "read")).toBe(true);
    expect(canCloudRole("viewer", "products", "update")).toBe(false);
    expect(canCloudRole("admin", "workspace_members", "delete")).toBe(true);
  });

  it("拒绝未知角色和未授权操作", () => {
    expect(canCloudRole("owner", "products", "read")).toBe(false);
    expect(() => assertCloudRoleCan("selection", "profit_lines", "insert")).toThrow("无权");
  });

  it("矩阵对所有表显式给出四类操作结果", () => {
    const snapshot = cloudRoleMatrixSnapshot();
    expect(snapshot.products).toEqual({ read: ["admin", "selection", "operations", "finance", "viewer"], insert: ["admin", "selection"], update: ["admin", "selection"], delete: [] });
    expect(snapshot.profit_lines.delete).toEqual(["admin", "finance"]);
  });
});

