const frozen = ledger => ['finalized', 'locked'].includes(ledger?.status);
const latest = reports => [...reports].sort((a, b) => (b.revision || 0) - (a.revision || 0) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];

export function hasSavedFinancialReport(ledger, reports = []) {
  return Boolean(frozen(ledger) && ledger.currentBaseReportId && reports.some(report => report.kind === 'financial' && report.workspaceId === ledger.workspaceId && report.ledgerId === ledger.id && report.period === ledger.period && report.baseReportId === ledger.currentBaseReportId));
}

// Projection only. Never replace the frozen base or rewrite a historical file.
export function currentLedgerResult(ledger, reports = [], deduction = null) {
  if (!ledger) return { state: 'empty', label: '尚无账本', profit: null, report: null };
  if (!frozen(ledger)) return { state: ledger.reportWorkflowVersion ? 'reopened' : 'pending', label: ledger.reportWorkflowVersion ? '基础已重开，待重算' : '待核算', profit: null, report: null };
  if (!ledger.currentBaseReportId) {
    return { state: 'legacy', label: '历史定稿', profit: ledger.profitSummary?.profit ?? null, report: null };
  }
  const scoped = reports.filter(report => report.workspaceId === ledger.workspaceId && report.ledgerId === ledger.id && report.period === ledger.period);
  const base = scoped.find(report => report.id === ledger.currentBaseReportId && report.kind === 'pre_deduction');
  if (!base) return { state: 'unavailable', label: '基础报告缺失，请检查备份', profit: null, report: null };
  const currentDeduction = deduction?.workspaceId === ledger.workspaceId && deduction.ledgerId === ledger.id && deduction.status === 'adopted' ? deduction : null;
  const financial = currentDeduction && latest(scoped.filter(report => report.kind === 'financial' && report.baseReportId === base.id && report.adoptedBatchIds?.includes(currentDeduction.id)));
  if (financial) return { state: 'financial', label: '正式利润表', profit: Number(financial.displayTotals?.profit ?? financial.totalsExact?.profitExact), report: financial };
  return {
    state: currentDeduction ? 'deduction_pending' : 'base',
    label: currentDeduction ? '扣款已更新，待生成' : '未扣款',
    profit: Number(base.displayTotals?.profit ?? base.totalsExact?.preDeductionExact),
    report: base,
  };
}

export function ledgerNextStep(ledger, { missingCount = ledger?.costSummary?.missingCount, loading = false } = {}) {
  if (loading) return { key: 'loading', text: '正在读取整月核算状态…', action: null };
  if (!ledger) return { key: 'import', text: '导入同月店铺台账，建立月度账本。', action: '导入台账' };
  if (frozen(ledger)) return { key: 'report', text: ledger.status === 'locked' ? '本月已锁定，可查看和下载已保存报告。' : '基础已保存，可查看报告；各店扣款齐全后可保存正式利润表。', action: '查看本月报告' };
  if (missingCount == null) return { key: 'cost', text: '打开成本核对，检查本月成本准备情况。', action: '核对成本' };
  if (missingCount > 0) return { key: 'cost', text: `整月还有 ${missingCount} 条 SKU 待补成本；店铺筛选不改变定稿范围。`, action: '补齐成本' };
  return { key: 'report', text: '整月成本已齐，登记代发与各店扣款后即可保存正式利润表。扣款待齐时可先保存未扣款报告。', action: '准备本月报告' };
}

export function reportReadiness({ ledger, stores = [], dispatch, deduction, reports = [], missingCount }) {
  const locked = ledger?.status === 'locked';
  const baseSaved = frozen(ledger) && Boolean(ledger?.currentBaseReportId);
  const missingStores = stores.filter(store => !deduction?.coveredStores?.includes(store));
  const baseReady = !locked && !frozen(ledger) && missingCount === 0 && Boolean(dispatch);
  return {
    baseSaved, missingStores, deductionSaved: hasSavedFinancialReport(ledger, reports),
    baseReady,
    financialReady: !locked && (baseSaved || baseReady) && Boolean(deduction) && missingStores.length === 0,
  };
}
