export const dispatchHeaders = ['店铺', 'SKC', '订单号', '数量', '1688订单号'];
export const dispatchWidths = [12, 32, 26, 8, 30, 2, 11, 13];
export const dispatchFields = ['store', 'platformSkc', 'businessId', 'quantityExact', 'order1688'];
const mergeFields = ['store', 'platformSkc', 'order1688'];
export const visibleDispatchRows = rows => rows.filter(row => !row.manual || row.store);

export function dispatchColumns(sheet) {
  if (sheet?.A1?.v === '店铺' && sheet.B1?.v === 'SKC' && sheet.C1?.v === '订单号' && sheet.D1?.v === '数量' && sheet.E1?.v === '1688订单号') {
    return { store: 0, platformSkc: 1, businessId: 2, quantityExact: 3, order1688: 4 };
  }
  if (sheet?.A1?.v === 'SKC' && sheet.B1?.v === '订单号' && ['数量', '件数'].includes(sheet.C1?.v) && ['1688订单号', '1688单号'].includes(sheet.D1?.v)) {
    return { platformSkc: 0, businessId: 1, quantityExact: 2, order1688: 3, ...(['店铺', '店铺号'].includes(sheet.E1?.v) ? { store: 4 } : {}) };
  }
  return null;
}

// Only original XLSX merge references prove a group. Equal values and ordinary
// fill-down never do; each column has its own source anchor and boundaries.
export function dispatchSourceMerges(records) {
  const ranges = [];
  for (const field of mergeFields) {
    const identities = records.map(record => {
      if (record.manual || record.sourceFormat !== 'xlsx' || !record.fileHash || !record.sourceSheet || !Number.isSafeInteger(record.sourceRow) || record.sourceRow < 1) return null;
      const explicit = record.mergedFrom?.[field];
      if (explicit != null && (!Number.isSafeInteger(explicit) || explicit < 1 || explicit > record.sourceRow)) return null;
      if (record[field] == null || String(record[field]) === '') return null;
      return { key: JSON.stringify([record.fileHash, record.sourceSheet, field, explicit ?? record.sourceRow]), value: String(record[field]), explicit: explicit != null };
    });
    const values = new Map();
    for (const item of identities) if (item) {
      if (!values.has(item.key)) values.set(item.key, new Set());
      values.get(item.key).add(item.value);
    }
    for (let start = 0; start < identities.length;) {
      const item = identities[start];
      let end = start + 1;
      if (item && values.get(item.key).size === 1) while (end < identities.length && identities[end]?.key === item.key) end++;
      if (end - start > 1 && identities.slice(start, end).some(value => value.explicit)) ranges.push({ column: dispatchFields.indexOf(field), start, end: end - 1 });
      start = end;
    }
  }
  return ranges;
}

export function mergeDispatchPresentation(rows, records) {
  const result = rows.map(row => row.map(cell => cell == null ? null : { ...cell }));
  for (const range of dispatchSourceMerges(records)) {
    const anchor = range.start + 1;
    result[anchor][range.column] = { ...result[anchor][range.column], align: 'center', mergeDown: range.end - range.start + 1, stripeRow: anchor };
    for (let row = anchor + 1; row <= range.end + 1; row++) result[row][range.column] = { ...result[row][range.column], value: null, blank: true, align: 'center', stripeRow: anchor };
  }
  return result;
}
