// Historical identities are read hints only. They never authorize a current
// platform mapping or automatic adoption as a formal ERP cost.
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).normalize('NFKC').trim() : '';
const canonical = value => text(value).toUpperCase();
const pair = row => JSON.stringify([canonical(row.platformSku), canonical(row.platformSkc)]);
export function normalizeErpHistoryMappings(value = [], expectedSkus = []) {
  if (!Array.isArray(value) || value.length > 20000) throw new Error('历史仓库关联列表无效。');
  const expected = new Set(expectedSkus.map(pair));
  const result = new Map();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('历史仓库关联记录无效。');
    const row = Object.fromEntries(['platformSku', 'platformSkc', 'warehouseSku', 'sourceRecordId', 'sourceBatchId', 'observedAt']
      .map(key => [key, text(item[key])]));
    if (!row.platformSku || !row.platformSkc || !row.warehouseSku || !row.sourceRecordId
      || Object.values(row).some(field => field.length > 500) || !expected.has(pair(row))
      || !Number.isFinite(Date.parse(row.observedAt))) throw new Error('历史仓库关联缺少来源或超出当前 SKU/SKC 范围。');
    if (item.store) row.store = text(item.store);
    if (row.store?.length > 500) throw new Error('历史仓库关联店铺无效。');
    if (item.unitConversion != null) {
      const warehouseUnits = Number(item.unitConversion.warehouseUnits), platformUnits = Number(item.unitConversion.platformUnits);
      if (!(warehouseUnits > 0) || !(platformUnits > 0) || !Number.isFinite(warehouseUnits) || !Number.isFinite(platformUnits)) throw new Error('历史仓库关联单位换算无效。');
      row.unitConversion = { warehouseUnits, platformUnits };
    }
    result.set(JSON.stringify(row), row);
  }
  return [...result.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
