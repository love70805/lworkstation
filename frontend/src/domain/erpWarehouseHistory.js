import { canonicalPlatformSku, canonicalPlatformSkc, canonicalWarehouseSku } from './identifiers';
import { calculateWarehouseCostDecision } from './erpCostResolution';
import { validateCostPeriod } from './erpPurchaseEvidence';

export const WAREHOUSE_HISTORY_FORMAT = 'shopeers-erp-warehouse-history';
const text = value => String(value ?? '').trim();
const pair = row => JSON.stringify([canonicalPlatformSku(row.platformSku), canonicalPlatformSkc(row.platformSkc)]);

// A warehouse history file provides purchase evidence, never a live platform
// binding. Its application is an explicit, audited manual correction action.
export function readWarehouseHistory(value, period) {
  validateCostPeriod(period);
  if (value?.format !== WAREHOUSE_HISTORY_FORMAT || value.formatVersion !== 1) throw new Error('请选择 ERP 助手导出的仓库历史采购证据 JSON。');
  if (value.ledgerPeriod !== period) throw new Error('历史核价月份与当前账本不一致，请按当前月份重新导出。');
  if (!Number.isFinite(Date.parse(value.generatedAt))) throw new Error('历史采购证据缺少有效采集时间。');
  if (value.sourceMeta?.complete !== true || Number(value.sourceMeta?.detailFailureCount) !== 0) throw new Error('仓库采购读取未完成，请补齐失败记录后导出。');
  const scope = new Set((value.warehouseSkus ?? []).map(canonicalWarehouseSku));
  const entries = value.warehouseEvidence?.warehouses;
  if (!scope.size || scope.size > 20 || scope.has('') || !Array.isArray(entries) || entries.length !== scope.size) throw new Error('仓库核价范围或证据数量不一致。');
  const warehouses = new Map();
  for (const entry of entries) {
    const key = canonicalWarehouseSku(entry.warehouseSku);
    if (!scope.has(key) || warehouses.has(key)) throw new Error('仓库采购证据重复或超出定向范围。');
    if (entry.evidenceComplete !== true || !Array.isArray(entry.sourceWarnings) || entry.sourceWarnings.length || !Array.isArray(entry.purchaseRecords) || !Array.isArray(entry.excludedRecords)) throw new Error('仓库采购证据不完整，暂不能补齐成本。');
    const records = [...entry.purchaseRecords, ...entry.excludedRecords];
    const ids = new Set();
    for (const record of records) {
      const id = text(record.recordId);
      if (!id || ids.has(id) || canonicalWarehouseSku(record.warehouseSku) !== key) throw new Error('采购记录标识重复或仓库归属不一致。');
      ids.add(id);
    }
    const decision = calculateWarehouseCostDecision({ warehouseSku: entry.warehouseSku, purchaseRecords: records, evidenceComplete: true, period });
    warehouses.set(key, { ...entry, decision });
  }
  return { ...value, warehouses };
}

export function planWarehouseHistoryCosts({ history, period, targets = [], knownMappings = [] }) {
  const parsed = readWarehouseHistory(history, period);
  const mappings = [...(Array.isArray(history.historicalMappings) ? history.historicalMappings : []).map(row => ({ ...row, historyOrigin: 'imported_history' })),
    ...knownMappings.map(row => ({ ...row, historyOrigin: 'published_erp_cost' }))];
  const parents = new Map();
  for (const row of targets) {
    const key = canonicalPlatformSku(row.platformSku);
    if (!parents.has(key)) parents.set(key, new Set());
    parents.get(key).add(canonicalPlatformSkc(row.platformSkc));
  }
  const ready = [], pending = [];
  for (const target of targets) {
    if (!target.platformSkc || parents.get(canonicalPlatformSku(target.platformSku))?.size !== 1) { pending.push({ ...target, reason: '台账 SKU 的 SKC 归属不明确' }); continue; }
    const candidates = mappings.filter(row => pair(row) === pair(target) && (!row.store || row.store === target.store));
    if (candidates.some(row => row.unitConversion && (Number(row.unitConversion.warehouseUnits) !== Number(row.unitConversion.platformUnits)
      || !(Number(row.unitConversion.warehouseUnits) > 0)))) { pending.push({ ...target, reason: '历史关联涉及单位换算，需核对' }); continue; }
    const warehouseKeys = new Set(candidates.map(row => canonicalWarehouseSku(row.warehouseSku)).filter(Boolean));
    if (warehouseKeys.size !== 1) { pending.push({ ...target, reason: warehouseKeys.size ? '历史仓库关联存在冲突' : '尚无准确历史仓库关联' }); continue; }
    const warehouse = parsed.warehouses.get([...warehouseKeys][0]);
    if (!warehouse) { pending.push({ ...target, reason: '本次未读取对应仓库采购' }); continue; }
    if (warehouse.decision.resolutionStatus !== 'resolved') { pending.push({ ...target, reason: warehouse.decision.unresolvedAnomalyCount ? '采购价格有异常，需核价' : '本月及以前尚无合格采购' }); continue; }
    ready.push({ ...target, warehouseSku: warehouse.warehouseSku, unitCost: warehouse.decision.formalUnitCost,
      selectedRecordIds: warehouse.decision.selectedRecordIds, historyEvidence: {
        format: WAREHOUSE_HISTORY_FORMAT, formatVersion: 1, ledgerPeriod: period, generatedAt: parsed.generatedAt,
        warehouseSku: warehouse.warehouseSku, historicalMapping: { platformSku: target.platformSku, platformSkc: target.platformSkc, store: target.store, warehouseSku: warehouse.warehouseSku },
        historicalMappingSources: candidates.map(row => ({ sourceRecordId: row.id ?? null, sourceBatchId: row.batchId ?? row.sourceBatchId ?? null,
          observedAt: row.observedAt ?? row.publishedAt ?? null, source: row.source ?? row.historyOrigin, historyOrigin: row.historyOrigin })),
        warehouseEvidence: warehouse, selectedRecordIds: warehouse.decision.selectedRecordIds,
      } });
  }
  return { ready, pending, warehouseCount: parsed.warehouses.size };
}
