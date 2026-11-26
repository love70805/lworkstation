import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSelectionRead } from '../components/SelectionReadState';
import { readSalesProfitAnalysis } from '../data/repositories/salesProfitAnalysisRepository';
import { canonicalPlatformSku } from '../domain/identifiers';
import { storeIdentity } from '../domain/manualCostOverride';
import { CostFraction, Exact } from '../domain/profitAmounts';

const empty = [];
const money = value => {
  const exact = new Exact(value), rounded = exact.toDecimalPlaces(4);
  return '¥' + (rounded.isZero() && !exact.isZero() ? exact.toSignificantDigits(3) : rounded).toFixed();
};

// All variants on this screen share each ledger read. Preserve the store on both sides
// of a reference profit calculation when the same SKU sells at different prices.
export function useProductSkuAccounting(workspaceId, historicalRows, params) {
  const scopeLedger = params.get('ledger'), requestedMode = params.get('mode');
  const storeList = JSON.stringify(params.getAll('store').map(storeIdentity));
  const ledgerIds = JSON.stringify(scopeLedger ? [scopeLedger] : [...new Set(historicalRows.flatMap(row => (row.currentPrices ?? []).map(price => price.ledgerId)))].sort());
  const scope = JSON.stringify([workspaceId,ledgerIds,requestedMode]);
  const read = useCallback(async () => {
    const ledgers = [];
    if (workspaceId) for (const ledgerId of JSON.parse(ledgerIds)) {
      const result = await readSalesProfitAnalysis({ workspaceId, ledgerId, daily:false, includeDispatch:false, requestedMode });
      ledgers.push([ledgerId, result]);
    }
    return { scope, ledgers };
  }, [scope, workspaceId, ledgerIds, requestedMode]);
  const state = useSelectionRead(read);
  const data = state.data?.scope === scope ? state.data : null;
  const bySku = useMemo(() => {
    const index = new Map(historicalRows.map(row => [row.canonicalPlatformSku, { prices:row.currentPrices ?? empty, costs:[] }]));
    const stores = JSON.parse(storeList);
    for (const [id,ledger] of data?.ledgers ?? []) {
      for (const [key,unit] of Object.entries(ledger.unitCosts)) {
        const [store,sku] = JSON.parse(key), item = index.get(sku);
        if (!item || (scopeLedger ? stores.length && !stores.includes(store) : !item.prices.some(price => price.ledgerId === id && storeIdentity(price.store) === store))) continue;
        item.costs.push({ ledgerId:id, store, unit:unit == null ? null : CostFraction.from(unit).decimal(), rate:ledger.warehouseRate,
          period:ledger.period, mode:ledger.accountingMode, source:ledger.costSources?.[key] });
      }
    }
    return index;
  }, [historicalRows,data,scopeLedger,storeList]);
  return { bySku, loading:!data && state.status !== 'error', error:state.error, retry:state.retry };
}

export function CurrentSkuPrice({ prices = empty, loading }) {
  if (!prices.length) return <small>{loading ? '正在读取售价…' : '暂无台账售价'}</small>;
  return prices.map(price => <div className="catalog-accounting-value" key={price.ledgerId + ':' + price.store}>
    <strong title={price.value ?? undefined}>{price.status === 'ready' ? '¥' + price.value : price.status === 'choose' ? '多价待核' : '暂无有效售价'}</strong>
    <details className="sale-price-source"><summary>{price.store} 店 · {price.date || price.period}</summary>
      {price.candidates.map(candidate => <small key={candidate.priceExact}>¥{candidate.priceExact} · 月净销 {candidate.quantityExact ?? '待核'} 件</small>)}
      {price.sources.map((source,index) => <small key={index}>{source.sourceSheet || '台账'}{source.sourceRow != null && ' 第 ' + source.sourceRow + ' 行'}{source.sourceCount > 1 && ' 等 ' + source.sourceCount + ' 行'} · 批次 {source.batchId}</small>)}
    </details>
    {price.status === 'choose' && <small>{price.candidates.map(candidate => '¥' + candidate.priceExact).join(' / ')}</small>}
  </div>);
}
export function AccountingCosts({ costs, reference, loading, profitLink, linkState, skuLabel }) {
  const priced = costs.some(cost => cost.unit != null);
  return <div className="catalog-cost-cell">
    {costs.map(cost => <div key={cost.ledgerId + ':' + cost.store} className="catalog-accounting-value">
      <strong title={cost.unit ?? undefined}>{profitLink && cost.ledgerId ? <Link className="catalog-profit-link" to={profitLink(cost)} state={linkState} aria-label={`查看 ${cost.store} 店 ${skuLabel} 的利润明细和采购记录`} title="查看月度利润明细和采购记录">{cost.unit == null ? '核算成本待补' : money(cost.unit)}<span aria-hidden="true"> ›</span></Link> : cost.unit == null ? '核算成本待补' : money(cost.unit)}</strong>
      <small>{cost.store} 店 · {cost.period}{cost.unit != null && ' · ' + (cost.source === 'manual_override' ? '人工更正' : 'ERP')}</small>
    </div>)}
    {reference.unitCost != null && <div className="catalog-accounting-value"><strong>{money(reference.unitCost)}</strong><small>{reference.sourceLabel} · 选品参考</small></div>}
    {reference.historical && reference.supplier && <small>当前 1688 报价 {money(reference.supplier.unitCost)}</small>}
    {!priced && !costs.length && reference.unitCost == null && <><strong>{loading ? '读取中' : '待补'}</strong>{!loading && <small>{({ not_checked:'尚未查询采购', incomplete:'采购证据尚未读齐', no_valid_purchase:'已读齐，无有效采购', mapping_conflict:'商品映射待核对' })[reference.erpPurchaseState] ?? '采购资料待补'}</small>}</>}
  </div>;
}
export function SkuUnitProfit({ prices = empty, costs = empty, reference }) {
  if (!prices.length || prices.every(price => price.status !== 'ready')) return <small>待台账售价</small>;
  const rows = prices.filter(price => price.status === 'ready').flatMap(price => {
    const source = costs.find(cost => storeIdentity(price.store) === cost.store);
    const unit = source?.unit ?? reference?.unitCost;
    if (unit == null || source?.rate == null) return [];
    const value = CostFraction.from(price.value).minus(unit).minus(source.rate).decimal();
    return <div className="catalog-accounting-value" key={price.store}><strong className={new Exact(value).lt(0) ? 'danger-text' : ''} title={value}>{money(value)}</strong><small>{price.store} 店 · 仓储 {money(source.rate)}{source.unit == null && ' · 选品参考'}</small></div>;
  });
  return rows.length ? rows : <small>待同店成本与费率</small>;
}
export const accountingForVariant = (accounting, variant) => accounting.bySku.get(variant.platformSku?.trim() ? canonicalPlatformSku(variant.platformSku) : '') ?? { prices:empty, costs:empty };
