export function resolveWorkspacePrimaryAction({ alertPath = "", latestOpenLedger = null } = {}) {
  if (alertPath.startsWith("/cost-matching") && latestOpenLedger) {
    return {
      kind: "profit",
      title: "查看利润核算",
      detail: `${latestOpenLedger.period} 当前核算结果`,
      path: `/profit?ledger=${encodeURIComponent(latestOpenLedger.id)}`,
    };
  }
  if (alertPath.startsWith("/profit") && latestOpenLedger) {
    return {
      kind: "cost",
      title: "查看 ERP 成本",
      detail: `${latestOpenLedger.period} 成本证据与匹配状态`,
      path: `/cost-matching?ledger=${encodeURIComponent(latestOpenLedger.id)}`,
    };
  }
  return {
    kind: "import",
    title: "导入销售台账",
    detail: latestOpenLedger ? `${latestOpenLedger.period} 可继续导入` : "创建或补充月度账本",
    path: "/import-preview",
  };
}
