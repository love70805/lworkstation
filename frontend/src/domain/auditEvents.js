function money(value) {
  return Number(value ?? 0).toLocaleString("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  });
}

export function describeAuditEvent(event) {
  const descriptions = {
    created: { tone: "info", title: "已创建月度账本", detail: event.after?.period ?? event.objectId },
    imported: { tone: "success", title: "销售台账导入完成", detail: `${event.after?.fileName ?? "导入文件"} · ${event.after?.validRowCount ?? 0} 条有效记录` },
    published: { tone: "success", title: "ERP 成本批次已发布", detail: `${event.after?.matchedCount ?? 0} 个平台 SKU 已匹配` },
    skcs_copied: { tone: "info", title: "平台 SKC 已复制", detail: `${event.after?.platformSkcCount ?? 0} 个查询项` },
    approved_1688_fallback: { tone: "warning", title: "1688 兜底成本已审批", detail: `${event.after?.platformSku ?? event.objectId} · 仅本账本生效` },
    revoked: { tone: "warning", title: "成本审批已撤销", detail: event.before?.platformSku ?? event.objectId },
    warehouse_rate_updated: { tone: "info", title: "仓储费率已更新", detail: `${money(event.before?.warehouseRate)} → ${money(event.after?.warehouseRate)}` },
    finalized: { tone: "success", title: "月度利润已定稿", detail: `${money(event.after?.profit)} · ${event.after?.lineCount ?? 0} 条 SKU 明细` },
    deleted: { tone: "danger", title: "月度账本已删除", detail: event.before?.period ?? event.objectId },
    capture_created: { tone: "info", title: "已登记 1688 采集", detail: event.after?.sourceProductId ?? event.objectId },
    capture_draft_saved: { tone: "info", title: "采集草稿已保存", detail: Number(event.after?.blockingCount ?? 0) > 0 ? `${event.after.blockingCount} 项待补资料` : "等待确认入库" },
    capture_ignored: { tone: "warning", title: "采集记录已忽略", detail: "不会进入正式商品库" },
    capture_confirmed: { tone: "success", title: "采集已确认入库", detail: `${event.after?.platformSkuCount ?? 0} 个平台 SKU 已写入商品库` },
    product_created: { tone: "success", title: "已创建正式商品", detail: `${event.after?.platformSkc ?? "未填写 SKC"} · ${event.after?.platformSkuCount ?? 0} 个平台 SKU` },
    product_updated: { tone: "info", title: "已更新商品资料", detail: `${event.after?.platformSkc ?? "未填写 SKC"} · ${event.after?.platformSkuCount ?? 0} 个平台 SKU` },
  backup_exported: { tone: "success", title: "已导出本机备份", detail: `${event.after?.recordCount ?? 0} 条记录 · ${event.after?.fileName ?? event.objectId}` },
  cloud_seed_exported: { tone: "info", title: "已导出云端种子包", detail: `${event.after?.recordCount ?? 0} 条记录 · ${event.after?.fileName ?? event.objectId}` },
  cloud_seed_imported: { tone: "success", title: "云端种子包已导入", detail: `${event.after?.insertedCount ?? 0} 条新增 · ${event.after?.fileName ?? event.objectId}` },
    backup_restored: { tone: "info", title: "已恢复本机备份", detail: `${event.after?.recordCount ?? 0} 条记录已写入` },
    workspace_reset: { tone: "warning", title: "已清空本机工作区", detail: "已创建空白默认工作区" },
  };

  return descriptions[event.action] ?? {
    tone: "info",
    title: "工作区数据已更新",
    detail: `${event.objectType ?? "记录"} · ${event.action ?? "变更"}`,
  };
}
