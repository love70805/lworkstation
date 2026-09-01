import { describe, expect, it } from "vitest";
import { auditActionPermission, auditActionPermissions, createCloudAuthorizer } from "./cloudAuthorization";

describe("cloud authorization", () => {
  it("按事件动作映射角色权限", () => {
    const selection = createCloudAuthorizer({ role: "selection", expectedToken: "dev" });
    expect(selection({ workspaceId: "w1", token: "dev", operation: "audit_events", events: [{ action: "product_created" }] })).toBe(true);
    expect(selection({ workspaceId: "w1", token: "dev", operation: "audit_events", events: [{ action: "finalized" }] })).toBe(false);
    expect(auditActionPermission({ action: "published" })).toEqual({ table: "erp_cost_batches", operation: "insert" });
  });

  it("对作废和定稿重开执行独立的业务权限校验", () => {
    const eventFor = (action) => ({ action });
    for (const role of ["viewer", "selection"]) {
      const authorize = createCloudAuthorizer({ role });
      expect(authorize({ operation: "audit_events", events: [eventFor("voided")] })).toBe(false);
      expect(authorize({ operation: "audit_events", events: [eventFor("reopened_for_cost_recalculation")] })).toBe(false);
    }
    expect(createCloudAuthorizer({ role: "operations" })({ operation: "audit_events", events: [eventFor("voided")] })).toBe(false);
    expect(createCloudAuthorizer({ role: "operations" })({ operation: "audit_events", events: [eventFor("reopened_for_cost_recalculation")] })).toBe(false);
    expect(createCloudAuthorizer({ role: "finance" })({ operation: "audit_events", events: [eventFor("voided"), eventFor("reopened_for_cost_recalculation")] })).toBe(true);
    expect(createCloudAuthorizer({ role: "admin" })({ operation: "audit_events", events: [eventFor("voided"), eventFor("reopened_for_cost_recalculation")] })).toBe(true);
    expect(auditActionPermissions({ action: "voided" })).toEqual([
      { table: "erp_cost_batches", operation: "update" },
      { table: "erp_cost_inbox", operation: "update" },
      { table: "ledgers", operation: "update" },
    ]);
  });

  it("未知 action 只能写审计，不能取得业务表权限", () => {
    expect(auditActionPermissions({ action: "forged_business_write" })).toEqual([{ table: "audit_events", operation: "insert" }]);
  });

  it("云端种子迁移只允许管理员和指定工作区", () => {
    const finance = createCloudAuthorizer({ role: "finance", expectedToken: "dev", allowedWorkspaces: ["w1"] });
    const admin = createCloudAuthorizer({ role: "admin", expectedToken: "dev", allowedWorkspaces: ["w1"] });
    expect(finance({ workspaceId: "w1", token: "dev", operation: "import" })).toBe(false);
    expect(admin({ workspaceId: "w1", token: "dev", operation: "import" })).toBe(true);
    expect(admin({ workspaceId: "w2", token: "dev", operation: "preflight" })).toBe(false);
    expect(admin({ workspaceId: "w1", token: "bad", operation: "preflight" })).toBe(false);
  });
});

