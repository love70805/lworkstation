import { describe, expect, it } from 'vitest';
import { activeOperatorScope, filterOperatorRows, normalizeOperatorConfig, parseOperatorNumbers } from './operatorScope';
import { buildLedgerErpCostRequest } from '../lib/erpRequest';
import { collectErpPlatformSkcs } from './erpQueryScope';

const rows = [
  { store: '甲店', supplierNumber: '001', platformSku: 'Sku-A', platformSkc: 'Skc-A', amount: 30 },
  { store: '甲店', supplierNumber: '', platformSku: 'Sku-A', platformSkc: 'Skc-A', amount: -10 },
  { store: '乙店', supplierNumber: '001', platformSku: 'Sku-B', platformSkc: 'Skc-B', amount: 50 },
  { store: '乙店', supplierNumber: '002', platformSku: 'Sku-C', platformSkc: 'Skc-C', amount: 80 },
];
const scope = { mode: 'mine', pairs: [{ store: '甲店', supplierNumber: '001' }] };
describe('local operator scope contract', () => {
  it('keeps the selected store SKU history and isolates identical supplier numbers', () => {
    expect(filterOperatorRows(rows, scope)).toEqual(rows.slice(0, 2));
    expect(filterOperatorRows(rows, { mode: 'all' })).toBe(rows);
    expect(rows).toHaveLength(4);
  });
  it('does not interpret empty, missing or malformed mine scope as all', () => {
    for (const value of [{}, { mode: 'mine', pairs: [] }, activeOperatorScope(normalizeOperatorConfig({ version: 1, mode: 'mine', activeProfileId: 'gone' }))]) expect(filterOperatorRows(rows, value)).toEqual([]);
    expect(normalizeOperatorConfig(null).mode).toBe('all');
    expect(normalizeOperatorConfig({ version: 99, mode: 'all' }).mode).toBe('mine');
  });
  it('matches actual pairs on reference/catalog objects, never a cross product', () => {
    const product = { storeNames: ['甲店', '乙店'], supplierNumbers: ['001', '002'], operatorPairs: [{ store: '甲店', supplierNumber: '002' }, { store: '乙店', supplierNumber: '001' }] };
    expect(filterOperatorRows([product], scope)).toEqual([]);
    expect(filterOperatorRows([product], { mode: 'mine', pairs: [{ store: '乙店', supplierNumber: '001' }] })).toEqual([product]);
  });
  it('preserves leading zeroes and matches pasted exact numbers', () => {
    expect(parseOperatorNumbers('001\n002，001;003\t004')).toEqual(['001', '002', '003', '004']);
  });
  it('builds real object ERP targets from exactly the visible scope', () => {
    const visible = filterOperatorRows(rows, scope);
    const { platformSkcs } = collectErpPlatformSkcs(visible);
    const expectedSkus = [{ platformSku: 'Sku-A', platformSkc: 'Skc-A' }];
    const request = buildLedgerErpCostRequest({ ledger: { id: 'L', workspaceId: 'W', period: '2026-09' }, platformSkcs, expectedSkus });
    expect(request.platformSkcs).toEqual([expect.objectContaining({ platformSkc: 'Skc-A' })]);
    expect(request.expectedSkus).toEqual([expect.objectContaining({ platformSku: 'Sku-A' })]);
    expect(JSON.stringify(request)).not.toContain('[object Object]');
    expect(collectErpPlatformSkcs(filterOperatorRows(rows, { mode: 'mine', pairs: [] })).platformSkcs).toEqual([]);
  });
});
