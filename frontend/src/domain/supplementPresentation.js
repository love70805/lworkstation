// IndexedDB sorts string primary keys as :0, :1, :10 ... :2. The numeric
// adoption position owns the selected row order; never group by SKU/value.
export function adoptedSupplementOrdinal(row) {
  if (!row.batchId) return null;
  if (Number.isSafeInteger(row.adoptedRowOrdinal) && row.adoptedRowOrdinal >= 0) return row.adoptedRowOrdinal;
  const prefix = `${row.batchId}:`;
  if (typeof row.id !== 'string' || !row.id.startsWith(prefix)) return null;
  const suffix = row.id.slice(prefix.length);
  return /^(0|[1-9]\d*)$/.test(suffix) && Number.isSafeInteger(Number(suffix)) ? Number(suffix) : null;
}

export function orderSupplementPresentation(rows, { rememberAdoptedOrdinal = false } = {}) {
  const groups = new Map(), output = [];
  rows.forEach((row, index) => {
    const ordinal = adoptedSupplementOrdinal(row);
    const source = !row.manual && row.fileHash && row.sourceSheet && Number.isSafeInteger(row.sourceRow) && row.sourceRow > 0;
    const key = ordinal != null ? JSON.stringify(['adopted', row.batchId]) : source ? JSON.stringify(['source', row.fileHash, row.sourceSheet]) : null;
    const entry = { row: rememberAdoptedOrdinal && ordinal != null ? { ...row, adoptedRowOrdinal: ordinal } : row, position: ordinal ?? (source ? row.sourceRow : index), index };
    if (key == null) output.push([entry]);
    else {
      if (!groups.has(key)) { const group = []; groups.set(key, group); output.push(group); }
      groups.get(key).push(entry);
    }
  });
  // Old frozen reports have no adoption position. Restore the known original
  // rows within each exact file/sheet, keeping source groups in first-seen order.
  return output.flatMap(group => group.toSorted((a,b) => a.position - b.position || a.index - b.index).map(entry => entry.row));
}
