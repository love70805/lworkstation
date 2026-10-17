import { dispatchOrderNumberForExport } from './dispatchOrderNumber';
import { suggestSupplementMapping, supplementHeaders } from './monthlySupplements';
import { exact } from './profitReports';
import { decimalSource } from './salesAnalytics';

// User-selected originals may recover an unmapped merged column, but can never
// replace frozen identities, quantities, amounts, or already recorded orders.
export function recoverDispatchOrdersFromSources(frozenRows, sources) {
  const matchedSources = sources.filter(source => frozenRows.some(row => row.fileHash === source.fileHash && row.sourceSheet === source.sheetName));
  if (!matchedSources.length) throw new Error('所选文件与本报告原始来源不一致，请选择当时导入的原表。');
  return frozenRows.map(row => {
    if (row.manual || dispatchOrderNumberForExport(row)) return { ...row };
    const source = matchedSources.find(item => item.fileHash === row.fileHash && item.sheetName === row.sourceSheet);
    if (!source) return { ...row };
    const index = source.sourceRows ? source.sourceRows.indexOf(row.sourceRow) : row.sourceRow - 1;
    const values = source.cells[index], mapping = suggestSupplementMapping(supplementHeaders(source,source.headerRow));
    if (!values || Number(mapping.order1688) < 0) throw new Error(`${source.fileName} / ${source.sheetName}：未识别 1688 单号列，请核对原表表头。`);
    const get = field => {
      const column = Number(mapping[field]), value = values[column];
      if (String(value ?? '').trim() || column < 0 || source.sourceFormat === 'csv') return value;
      const merge = source.merges?.find(range => range.s.c === column && range.e.c === column && range.s.r < index && range.e.r >= index);
      return merge ? source.cells[merge.s.r]?.[column] : value;
    };
    if (String(get('businessId') ?? '').trim() !== row.businessId || String(get('platformSkc') ?? '').trim() !== String(row.platformSkc ?? '') || exact(decimalSource(get('quantity'),null)) !== exact(row.quantityExact)) throw new Error(`${source.fileName} / ${source.sheetName} 第 ${row.sourceRow} 行与冻结记录不一致，未更改报告。`);
    const value = get('order1688');
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || Math.abs(value) >= 1e15)) throw new Error(`第 ${row.sourceRow} 行的数字单号可能丢失精度，请核对原始文本单号。`);
    return { ...row, order1688: String(value ?? '').trim() };
  });
}
