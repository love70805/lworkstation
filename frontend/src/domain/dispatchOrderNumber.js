export const dispatchOrderHeaders = ['1688订单号', '1688单号', '1688'];
const key = value => String(value ?? '').normalize('NFKC').replace(/\s/g, '').toLowerCase();

// An old unmapped column is retained as a same-row remark. Recover only its
// explicit text identifier; never inherit a neighbouring order or guess digits.
export function dispatchOrderNumberForExport(row) {
  const explicit = String(row.order1688 ?? '').trim();
  if (explicit) return explicit;
  const candidates = [...new Set((row.remarks ?? []).filter(remark => dispatchOrderHeaders.some(header => key(header) === key(remark.header)))
    .map(remark => remark.value).filter(value => typeof value === 'string' && /^\d+$/.test(value.trim())).map(value => value.trim()))];
  return candidates.length === 1 ? candidates[0] : '';
}
