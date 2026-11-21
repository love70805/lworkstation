import { canonicalStore } from './batchSalesImport';
import { saleFields } from './profitPageProjection';

export const selectionSaleFields = ['id', 'workspaceId', 'ledgerId', 'batchId', 'platformSku', 'sku', 'platformSkc', 'attribute', 'store', 'supplierNumber', 'sourceSheet', 'sourceRow', 'sourceAddedDate', 'sourceAddedAt', 'rawAddedAt', 'sourceTimePrecision', 'movementType', 'isDeduction', 'quantityExact', 'quantity', 'qty', 'amountExact', 'amount', 'unitPriceRaw', 'unitPrice'];
const chartFields = ['store', 'sourceAddedDate', 'isDeduction', 'movementType', 'quantityExact', 'quantity', 'amountExact', 'amount', 'sourceSheet', 'sourceRow'];
const pageFields = [...new Set([...saleFields, ...selectionSaleFields, ...chartFields])];
const detailFields = new Set(['store', 'sourceAddedDate', 'isDeduction', 'movementType', 'quantityExact', 'quantity', 'amountExact', 'amount', 'platformSku', 'sku', 'platformSkc']);

// The trend already loaded these owned columns. A drilldown worker needs no order IDs or original evidence.
export function periodDetailColumns({ count, columns }) {
  return { count, columns: columns.filter(([field]) => detailFields.has(field)) };
}

// The three views share a bounded source scan. Repeated strings stay in a
// dictionary while the page is mounted. Only a computation worker expands rows.
export function packPageSales(rows, workspaceId) {
  const stores = new Map();
  let foreign = false;
  const owned = rows.filter(row => {
    if (!row) return false;
    if (row.workspaceId && row.workspaceId !== workspaceId) { foreign = true; return false; }
    if (!stores.has(row.store)) stores.set(row.store, new Set());
    stores.get(row.store).add(row.supplierNumber);
    return true;
  });
  const columns = [], negativeZero = Symbol();
  for (const field of pageFields) {
    const values = [], dictionary = new Map(), codes = new Uint16Array(owned.length);
    for (let i = 0; i < owned.length; i++) {
      const value = owned[i][field];
      if (value === undefined) continue;
      const key = Object.is(value, -0) ? negativeZero : value;
      let code = dictionary.get(key);
      if (code === undefined) { code = values.push(value); dictionary.set(key, code); }
      codes[i] = code;
    }
    if (values.length) columns.push([field, values, values.length === 1 && codes.every(code => code === 1) ? null : values.length < 256 ? Uint8Array.from(codes) : codes]);
  }
  return { count: owned.length, columns, stores, foreign };
}

export function expandPageSales(chunks, kind, { workspaceId, store = 'all', requireExplicitOwner = false }) {
  const fields = new Set(kind === 'profit-page-sales' ? saleFields : kind === 'selection-facts' ? selectionSaleFields
    : kind === 'sales-profit' ? [...chartFields, 'platformSku', 'sku', 'platformSkc'] : chartFields);
  const selectedStore = store === 'all' ? null : canonicalStore(store);
  const result = [];
  for (const chunk of chunks) {
    const rows = Array.from({ length: chunk.count }, () => ({}));
    for (const [field, values, codes] of chunk.columns) {
      if (!fields.has(field) && field !== 'workspaceId') continue;
      for (let i = 0; i < rows.length; i++) {
        const code = codes ? codes[i] : 1;
        if (code) rows[i][field] = values[code - 1];
      }
    }
    for (const row of rows) {
      if (!row.workspaceId) {
        if (requireExplicitOwner) continue;
        row.workspaceId = workspaceId;
      }
      if (selectedStore === null || canonicalStore(row.store) === selectedStore) result.push(row);
    }
  }
  return result;
}

// Preserve the source spelling, missing legacy owner and first-occurrence
// order used by the recovery signature, without expanding the month's sales.
export function pageRecoveryIdentities(chunks, ledgerId) {
  const byIdentity = new Map();
  for (const chunk of chunks) {
    const columns = new Map(chunk.columns.map(([key, values, codes]) => [key, {values, codes}]));
    const value = (key, i) => {
      const column = columns.get(key);
      return column?.values[(column.codes ? column.codes[i] : 1) - 1];
    };
    for (let i = 0; i < chunk.count; i++) {
      const row = { workspaceId:value('workspaceId',i), ledgerId, store:value('store',i),
        platformSku:value('platformSku',i), sku:value('sku',i), platformSkc:value('platformSkc',i) };
      byIdentity.set(JSON.stringify(row),row);
    }
  }
  return [...byIdentity.values()];
}
