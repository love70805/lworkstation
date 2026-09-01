import { describe, expect, it } from "vitest";
import { validateWorkspaceBackupPayload, WORKSPACE_BACKUP_FORMAT } from "./workspaceBackup";

describe("workspace backup validation", () => {
  it("校验格式、表结构和记录数", () => {
    const result = validateWorkspaceBackupPayload({
      format: WORKSPACE_BACKUP_FORMAT,
      formatVersion: 1,
      workspaceId: "workspace-default",
      tables: {
        products: [{ id: "P-1" }],
        platformSkus: [{ id: "S-1", workspaceId: "workspace-default", platformSku: "SKU-A" }],
      },
    }, { tableNames: ["products", "platformSkus"] });

    expect(result).toMatchObject({ recordCount: 2, tableCount: 2, workspaceId: "workspace-default" });
  });

  it("拒绝工作区内重复的平台 SKU", () => {
    expect(() => validateWorkspaceBackupPayload({
      format: WORKSPACE_BACKUP_FORMAT,
      formatVersion: 1,
      workspaceId: "workspace-default",
      tables: {
        platformSkus: [
          { id: "S-1", workspaceId: "workspace-default", platformSku: "SKU-A" },
          { id: "S-2", workspaceId: "workspace-default", platformSku: " sku-a " },
        ],
      },
    }, { tableNames: ["platformSkus"] })).toThrow("平台 SKU 必须全局唯一");
  });

  it("拒绝当前版本未知的数据表", () => {
    expect(() => validateWorkspaceBackupPayload({
      format: WORKSPACE_BACKUP_FORMAT,
      formatVersion: 1,
      tables: { unknown: [] },
    }, { tableNames: ["products"] })).toThrow("不识别的数据表");
  });
});
