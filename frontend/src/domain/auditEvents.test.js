import { describe, expect, it } from "vitest";
import { describeAuditEvent } from "./auditEvents";

describe("audit event descriptions", () => {
  it("为商品、采集和备份动作提供中文业务描述", () => {
    expect(describeAuditEvent({ action: "product_created", after: { platformSkc: "SKC-1", platformSkuCount: 2 } })).toMatchObject({
      tone: "success",
      title: "已创建正式商品",
      detail: "SKC-1 · 2 个平台 SKU",
    });
    expect(describeAuditEvent({ action: "capture_confirmed", after: { platformSkuCount: 3 } }).title).toBe("采集已确认入库");
    expect(describeAuditEvent({ action: "backup_exported", objectId: "backup.json", after: { recordCount: 20 } }).detail).toBe("20 条记录 · backup.json");
  });

  it("对未知动作保留可追踪的回退描述", () => {
    expect(describeAuditEvent({ action: "future_action", objectType: "future_record" })).toEqual({
      tone: "info",
      title: "工作区数据已更新",
      detail: "future_record · future_action",
    });
  });
});
