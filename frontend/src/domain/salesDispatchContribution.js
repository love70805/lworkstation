import { CostFraction, Exact } from './profitAmounts';
import { canonicalPlatformSkc } from './identifiers';
import { salesStoreKey } from './salesChartModel';
import { salesProductKey } from './salesPeriodDetails';
import { parseSalesAddedDate } from './salesAnalytics';

const emptyPeriod = () => ({ quantity: new Exact(0), stores: new Map(), products: new Map() });
const unassignedStore = '店铺未分配';
const productKey = row => JSON.stringify([salesStoreKey(row.store), row.platformSkc?.trim() ? canonicalPlatformSkc(row.platformSkc) : '']);
const zeroSales = { revenueExact: '0', quantityExact: '0', warehouseCostExact: '0', purchaseCostExact: '0', profitExact: '0', profitFraction: ['0', '1'], count: 0 };

function addQuantity(map, key, fields, quantity) {
  const item = map.get(key) ?? { ...fields, quantity: new Exact(0) };
  item.quantity = item.quantity.plus(quantity);
  map.set(key, item);
}
function addDispatch(period, row, quantity) {
  period.quantity = period.quantity.plus(quantity);
  addQuantity(period.stores, salesStoreKey(row.store), { store: row.store }, quantity);
  addQuantity(period.products, productKey(row), row, quantity);
}

export function buildSalesDispatch(batch, rows, ledger, selectedStore = 'all') {
  const month = emptyPeriod(), days = new Map(), undatedByStore = new Map();
  let undated = new Exact(0), adoptedRowsTotal = new Exact(0);
  function collect(row, quantity) {
    if (quantity.isZero()) return;
    const store = row.store || unassignedStore;
    if (selectedStore !== 'all' && salesStoreKey(selectedStore) !== salesStoreKey(store)) return;
    const item = { store, platformSkc: row.platformSkc?.trim() || '' };
    addDispatch(month, item, quantity);
    const day = row.dispatchDate && parseSalesAddedDate(row.dispatchDate, { period: ledger.period });
    if (day?.dateStatus === 'valid') {
      const period = days.get(day.sourceAddedDate) ?? emptyPeriod();
      addDispatch(period, item, quantity);
      days.set(day.sourceAddedDate, period);
    } else {
      undated = undated.plus(quantity);
      const key = salesStoreKey(store);
      undatedByStore.set(key, (undatedByStore.get(key) ?? new Exact(0)).plus(quantity));
    }
  }
  for (const row of rows) {
    if (row.workspaceId !== ledger.workspaceId || row.ledgerId !== ledger.id || row.batchId !== batch.id || row.kind !== 'dispatch')
      throw new Error('代发行与本月采用来源不一致。');
    const quantity = new Exact(row.quantityExact);
    if (!quantity.isInteger() || quantity.isNegative()) throw new Error('代发件数无效。');
    adoptedRowsTotal = adoptedRowsTotal.plus(quantity);
    collect(row, quantity);
  }
  const unassigned = new Exact(batch.adoptedQuantityExact).minus(adoptedRowsTotal);
  if (unassigned.lt(0)) throw new Error('代发明细超过已采用总数。');
  collect({}, unassigned);
  const rate = ledger.warehouseRate ?? '0.7';
  const amounts = ({quantity, ...fields}) => ({ ...fields, dispatchQuantityExact: quantity.toFixed(), dispatchAmountExact: quantity.times(rate).toFixed() });
  const finish = p => ({ total: amounts({ quantity: p.quantity }), stores: [...p.stores.values()].map(amounts), products: [...p.products.values()].map(amounts) });
  return { month: finish(month), days: Object.fromEntries([...days].map(([date,p]) => [date,finish(p)])), undatedQuantityExact: undated.toFixed(), undatedByStore: Object.fromEntries([...undatedByStore].map(([key, qty]) => [key, qty.toFixed()])) };
}

export function addDispatchContribution(row, dispatch) {
  if (!row || !dispatch) return row;
  const sales = row.profitExact == null ? null : CostFraction.from(row.profitFraction ?? row.profitExact);
  const contribution = sales?.plus(dispatch.dispatchAmountExact);
  return { ...row, salesProfitExact: row.profitExact ?? null, salesProfitFraction: sales?.pair(), dispatchAmountExact: dispatch.dispatchAmountExact,
    dispatchQuantityExact: dispatch.dispatchQuantityExact, profitExact: contribution?.decimal() ?? null, profitFraction: contribution?.pair() };
}
function withDispatchRows(rows, dispatch, products) {
  const keyFor = products ? productKey : row => salesStoreKey(row.store);
  const extras = new Map(dispatch.map(item => [keyFor(item), item]));
  const joined = rows.map(row => {
    // Unassigned SKCs must not silently attach to a sale with a missing parent.
    if (products && !row.platformSkc) return row;
    const key = keyFor(row), item = extras.get(key);
    extras.delete(key);
    return addDispatchContribution(row,item);
  });
  for (const item of extras.values()) {
    const key = products ? salesProductKey(item.store,item.platformSkc,'dispatch') : salesStoreKey(item.store);
    joined.push(addDispatchContribution({ ...zeroSales, key, store: item.store, ...(products ? { platformSkc:item.platformSkc, platformSkus:[], averagePriceExact:null } : {}), dispatchOnly:true },item));
  }
  return joined;
}

export function chartWithDispatch(month, dispatch) {
  if (!dispatch) return month;
  const monthlySegments = withDispatchRows(month.monthlySegments ?? [], dispatch.month.stores, false);
  return { ...month, hasDispatch:true, undatedDispatchQuantity:dispatch.undatedQuantityExact, monthlySegments,
    stores:[...new Set([...(month.stores ?? []), ...dispatch.month.stores.map(row => row.store)])],
    undatedDispatchByStore:dispatch.undatedByStore, monthTotalsExact:addDispatchContribution(month.monthTotalsExact,dispatch.month.total),
    daily:month.daily.map(day => {
      const data = dispatch.days[day.date];
      if (!data) return day;
      const known = day.status === 'data' || day.status === 'known_zero';
      return { ...addDispatchContribution(day,data.total), ...(known ? {status:'data',segments:withDispatchRows(day.segments,data.stores,false)} : {dispatchStores:data.stores}) };
    }) };
}

export function detailWithDispatch(detail, dispatch, date) {
  if (!detail || !dispatch) return detail;
  const period = date ? dispatch.days[date] : dispatch.month;
  const result = { ...detail, hasDispatch:true, undatedDispatchQuantity:dispatch.undatedQuantityExact, undatedDispatchByStore:dispatch.undatedByStore };
  if (!period) return result;
  result.totalsExact = addDispatchContribution(detail.totalsExact,period.total);
  if (detail.status === 'unknown') return { ...result, dispatchStores:period.stores };
  if (!period.stores.length) return result;
  result.stores = withDispatchRows(detail.stores,period.stores,false);
  result.rows = withDispatchRows(detail.rows,period.products,true);
  return { ...result, status:'data' };
}
