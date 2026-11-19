import { expect, it } from 'vitest';
import { missingErpCostScope, needsNarrowerCostRequest, retryErpCostScope } from './erpCostSupplement';

const rows = [
  {store:'甲', platformSku:'A', platformSkc:'P', decision:{eligibleForExactProfit:true, unitCost:0}},
  {store:'乙', platformSku:'A', platformSkc:'P', decision:{eligibleForExactProfit:false}},
  {store:'甲', platformSku:'B', platformSkc:'P', decision:{eligibleForExactProfit:true}},
  {store:'甲', platformSku:'C', platformSkc:'Q', decision:{eligibleForExactProfit:false}},
];
const request = {platformSkcs:['P','Q'],expectedSkus:rows};
it('retries unread parents even after manual pricing, and only unresolved siblings of incomplete receipts', () => {
  const batches = [{ platformSkcs: ['P'], status: 'incomplete', deliveryId: 'D' }, { platformSkcs: ['Q'], status: 'failed' }];
  const scope = retryErpCostScope(request, batches, {expectedSkus:[rows[1], {platformSku:'outside',platformSkc:'other'}]});
  expect(scope.expectedSkus.map(row => row.platformSku).sort()).toEqual(['A', 'C']);
  expect(needsNarrowerCostRequest(request, batches, scope)).toBe(true);
  expect(retryErpCostScope(request, batches, { expectedSkus: [] }).expectedSkus).toEqual([{ platformSku:'C', platformSkc:'Q', store:'甲' }]);
});
it('filters effective store prices before deduplicating SKU siblings and keeps the missing store', () => {
  const scope = missingErpCostScope(rows);
  expect(scope.expectedSkus.map(row=>[row.platformSku,row.store])).toEqual([['A','乙'],['C','甲']]);
  expect(scope.platformSkcs).toEqual(['P','Q']);
  expect(needsNarrowerCostRequest(request,[{platformSkcs:['P','Q'],status:'pending'}],scope)).toBe(true);
});
it('waits for delivered evidence, preserves a matching unread resume, and permits later supplement of evaluated exceptions', () => {
  const batches=[{platformSkcs:['P'],deliveryId:'paid'},{platformSkcs:['Q'],status:'failed'}];
  const pending=missingErpCostScope(rows,{request,batches});
  expect(pending.platformSkcs).toEqual(['Q']);
  expect(needsNarrowerCostRequest(request,batches,pending)).toBe(false);
  const evaluated=missingErpCostScope(rows,{request,batches,inboxes:[{deliveryId:'paid',adoption:{state:'partial'}}]});
  expect(evaluated.platformSkcs).toEqual(['P','Q']);
  expect(needsNarrowerCostRequest(request,batches,evaluated)).toBe(true);
});
