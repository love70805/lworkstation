export function resolveWorkspacePrimaryAction({ selectedLedger = null, query = "" } = {}) {
  const params = new URLSearchParams(query);
  if (selectedLedger) params.set("ledger", selectedLedger.id);
  if (selectedLedger && ["finalized", "locked"].includes(selectedLedger.status)) {
    return {
      kind: "profit",
      title: "查看本月报告",
      detail: `${selectedLedger.period} 已保存报告与扣款`,
      path: `/profit?${params}`,
    };
  }
  if (selectedLedger && Number(selectedLedger.costSummary?.missingCount) > 0) {
    params.delete("store");
    params.delete("q");
    params.delete("supplier");
    return {
      kind: "cost",
      title: "核对本月成本",
      detail: `${selectedLedger.period} 查看整月待补成本`,
      path: `/cost-matching?${params}`,
    };
  }
  if (selectedLedger) return {
    kind: "profit",
    title: "查看利润核算",
    detail: `${selectedLedger.period} 当前核算结果`,
    path: `/profit?${params}`,
  };
  return {
    kind: "import",
    title: "导入销售台账",
    detail: "创建月度账本",
    path: "/import-preview",
  };
}
