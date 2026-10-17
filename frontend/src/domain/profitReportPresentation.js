// Presentation is derived from the report's frozen dispatch, never live sources.
export function dispatchRegistrantNames(rows = []) {
  return [...new Set(rows.filter(row => !row.manual).map(row => String(row.ownerMarker ?? '').trim()).filter(Boolean))];
}

export function profitReportFileName(report, { dispatchRows = [] } = {}) {
  const names = report.registrantNames ?? dispatchRegistrantNames(dispatchRows);
  const owner = names.join('、').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
  const match = /^(\d{4})-(\d{2})$/.exec(report.period);
  const month = match ? `${match[1]}年${Number(match[2])}月` : String(report.period).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
  return `${owner}${month}利润表${report.kind === 'financial' ? '' : '（未扣款）'}.xlsx`;
}
