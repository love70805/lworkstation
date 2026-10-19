import { describe, expect, it } from "vitest";
import { validateWorkspaceBackupPayload, WORKSPACE_BACKUP_FORMAT } from "./workspaceBackup";
import { encodeSalesRowsAuditSnapshot, SALES_ROWS_AUDIT_MIN_ROWS } from "./salesRowsAuditSnapshot";

describe("workspace backup validation", () => {
  it('accepts both backup generations but rejects full desktop fields under the legacy format',()=>{
    for(const formatVersion of [1,2])expect(validateWorkspaceBackupPayload({format:WORKSPACE_BACKUP_FORMAT,formatVersion,tables:{}},{tableNames:[]}).recordCount).toBe(0);
    expect(()=>validateWorkspaceBackupPayload({format:WORKSPACE_BACKUP_FORMAT,formatVersion:3,tables:{}},{tableNames:[]})).toThrow('格式版本');
    expect(()=>validateWorkspaceBackupPayload({format:WORKSPACE_BACKUP_FORMAT,formatVersion:1,tables:{},desktopInbox:{}},{tableNames:[]})).toThrow('新版备份格式');
  });
  it('rejects malformed task recovery data before a database restore can start',()=>{
    const desktopInbox={format:'lworkstation-desktop-inbox-backup',formatVersion:1,recordCount:1,leaseCount:0,records:[{kind:'collection-task',taskId:'broken',status:'running'}],leases:[]};
    expect(()=>validateWorkspaceBackupPayload({format:WORKSPACE_BACKUP_FORMAT,formatVersion:2,tables:{},desktopInbox},{tableNames:[]})).toThrow('桌面收件备份');
  });
  it("validates compact imported audit snapshots while accepting legacy summary events", () => {
    const salesRows = encodeSalesRowsAuditSnapshot(Array.from({ length: SALES_ROWS_AUDIT_MIN_ROWS }, (_, index) => ({ id: index, raw: { 金额: "0.000001" } })));
    const payload = { format: WORKSPACE_BACKUP_FORMAT, formatVersion: 1, tables: { auditEvents: [
      { action: "imported", after: { snapshot: { salesRows } } },
      { action: "imported", after: { validRowCount: 5 } },
    ] } };
    expect(validateWorkspaceBackupPayload(payload, { tableNames: ["auditEvents"] }).recordCount).toBe(2);
    salesRows.strings[0] = "corrupted";
    expect(() => validateWorkspaceBackupPayload(payload, { tableNames: ["auditEvents"] })).toThrow("完整性校验失败");
  });

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
