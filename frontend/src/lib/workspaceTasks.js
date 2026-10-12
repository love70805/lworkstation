export function buildWorkspaceTaskItems(summary) {
  const items = [];
  if ((summary?.blockedCaptureCount ?? 0) > 0) {
    items.push({ kind: "blocked-capture", tone: "danger", title: "采集存在阻断项", detail: `${summary.blockedCaptureCount} 条记录需要补齐资料`, action: "处理采集", path: "/products?view=pending" });
  } else if ((summary?.pendingCaptureCount ?? 0) > 0) {
    items.push({ kind: "capture", tone: "warning", title: "待确认采集", detail: `${summary.pendingCaptureCount} 条记录等待人工确认`, action: "打开队列", path: "/products?view=pending" });
  }
  for (const task of summary?.pendingLedgerTasks ?? []) {
    const month = task.period || "未设置月份";
    const query = `ledger=${encodeURIComponent(task.ledgerId)}`;
    if (task.kind === "cost") {
      items.push({ kind: "cost", tone: "warning", title: `${month} 成本${task.missingCount > 0 ? "待补" : "待核对"}`, detail: task.missingCount > 0 ? `${task.missingCount} 条平台 SKU 待补成本` : "核对本月正式成本与待确认项", action: "核对成本", path: `/cost-matching?${query}` });
    } else if (task.kind === "profit") {
      items.push({ kind: "profit", tone: "success", title: `${month} 利润待确认`, detail: "成本已齐，等待人工核对并保存报告", action: "核对利润", path: `/profit?${query}` });
    } else {
      items.push({ kind: "ledger", tone: "info", title: `${month} 账本待完善`, detail: "检查销售台账与成本准备状态", action: "查看台账", path: `/ledger?${query}` });
    }
  }
  return items;
}
