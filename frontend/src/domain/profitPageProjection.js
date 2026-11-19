import { isErpCostWithinPeriod } from './erpCostPeriod';

const costFields = ['id', 'batchId', 'ledgerId', 'workspaceId', 'platformSku', 'canonicalPlatformSku', 'platformSkc',
  'warehouseSku', 'unitCost', 'amount', 'currency', 'publishedAt', 'resolutionStatus', 'unresolvedAnomalyCount',
  'accountingMode', 'orderNumber', 'supplierName', 'supplier1688Url', 'productName', 'attribute'];
export const saleFields = ['id', 'batchId', 'ledgerId', 'workspaceId', 'store', 'platformSkc', 'platformSku', 'sku',
  'groupKey', 'skuKey', 'supplierNumber', 'attribute', 'quantity', 'quantityExact', 'amount', 'amountExact', 'penalty',
  'sourceRow', 'sourceSheet', 'orderId', 'order1688', 'isDeduction', 'deductionAmount', 'movementType',
  'hasDirectUnitCost', 'directUnitCost', 'hasDirectPenalty', 'directPenalty'];

function pick(row, fields) {
  const result = {};
  for (const key of fields) if (row[key] !== undefined) result[key] = row[key];
  return result;
}

export const profitSaleFields = row => pick(row, saleFields);

// Built from the owned source row. The write, export and audit paths always verify the original evidence.
export function profitCostFields(row, period) {
  const result = pick(row, costFields);
  result.checkedPeriod = period;
  result.withinPeriod = isErpCostWithinPeriod(row, period);
  result.ignoredAnomaly = row.resolutions?.some(item => item.action === 'ignore_anomaly') === true;
  // Preserve the explicit zero-price rule without retaining purchase identities or records.
  if (row.unitCost === 0 && row.costDecision?.selectedRecords?.length) {
    result.costDecision = { resolutionStatus: row.costDecision.resolutionStatus,
      selectedRecords: row.costDecision.selectedRecords.map(r => ({ unitPrice: r.unitPrice, effectiveUnitPrice: r.effectiveUnitPrice,
        resolution: { action: r.resolution?.action } })) };
  }
  const terms = new Set();
  for (const record of row.costDecision?.selectedRecords ?? []) {
    for (const value of [record.order1688, record.purchaseOrderNo, record.purchaseOrderId, record.purchaseDate]) if (value) terms.add(value);
  }
  for (const record of row.purchaseRecords ?? []) {
    for (const value of [record.order1688, record.purchaseOrderNo, record.purchaseOrderId]) if (value) terms.add(value);
  }
  if (terms.size) result.purchaseSearchText = [...terms].join(' ');
  return result;
}

export const profitCostWithinPeriod = (row, period) => row?.checkedPeriod === period && row?.withinPeriod === true;

// A large month can have megabytes of searchable order numbers. Store those
// strings together so the complete, disposable page projection fits the cache.
export async function packProfitSearch(projection) {
  const { costs } = projection;
  const size = costs.reduce((length, row) => length + (row.purchaseSearchText?.length ?? 0), 0);
  if (size < 128 * 1024 || !globalThis.CompressionStream || !globalThis.DecompressionStream || !globalThis.Blob?.prototype.stream) return projection;
  const search = costs.map(row => row.purchaseSearchText ?? null);
  const stream = new Blob([JSON.stringify(search)]).stream().pipeThrough(new CompressionStream('gzip'));
  const searchBytes = await new Response(stream).arrayBuffer();
  return { ...projection, searchBytes, costs: costs.map(({ purchaseSearchText, ...row }) => row) };
}

export async function unpackProfitSearch(projection) {
  if (!projection.searchBytes) return projection;
  const stream = new Blob([projection.searchBytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const terms = await new Response(stream).json();
  return { resolutionIndex: projection.resolutionIndex,
    costs: projection.costs.map((row, index) => terms[index] == null ? row : { ...row, purchaseSearchText: terms[index] }) };
}
