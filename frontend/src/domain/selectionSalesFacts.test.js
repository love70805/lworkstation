import { expect, it } from 'vitest';
import { prepareSelectionSalesFacts } from './selectionSalesFacts';
import { buildSelectionReferenceRows } from '../lib/selectionReferences';
import { buildSelectionSalesLabels } from './selectionSalesLabels';
import { derivedValueBytes } from '../data/db/derivedCache';
import { packSelectionSalesFacts, unpackSelectionFactIdentities } from './selectionSalesFactsCodec';

function fixture(patches = []) {
  const ledgers = [{ id: 'L', workspaceId: 'W', period: '2026-08' }];
  const salesRows = patches.map((patch, i) => ({ id: i + 1, workspaceId: 'W', ledgerId: 'L', batchId: 'B', store: '甲', platformSku: 'SKU', platformSkc: 'SKC', sourceRow: i + 2, sourceSheet: '明细', sourceAddedDate: '2026-08-31', sourceAddedAt: '2026-08-31T12:00:00+08:00', quantityExact: '1', unitPriceRaw: '0.000000001', ...patch }));
  const importBatches = [{ id: 'B', workspaceId: 'W', ledgerId: 'L', period: '2026-08', store: '甲', status: 'completed', fileHash: 'hash', validRowCount: salesRows.length, sourceCoverage: { version: 1, scope: 'full_month', period: '2026-08', store: '甲', declarationSource: 'manual' } }];
  return { workspaceId: 'W', ledgers, salesRows, importBatches, erpCosts: [{ workspaceId: 'W', ledgerId: 'L', platformSku: 'SKU', platformSkc: 'SKC', unitCost: 0, publishedAt: '2026-09-01' }] };
}
function compare(input, patches = {}) {
  const facts = structuredClone(prepareSelectionSalesFacts(input));
  const full = buildSelectionReferenceRows({ ...input, ledgerIdentityRows: input.salesRows.map(row => ({ ...row, period: input.ledgers.find(ledger => ledger.id === row.ledgerId).period })), ...patches, compactEvidence: true });
  const compact = buildSelectionReferenceRows({ ...input, salesRows: [], ledgerIdentityRows: facts.ledgerIdentityRows, selectionSalesFacts: facts, ...patches, compactEvidence: true });
  expect(compact).toEqual(full);
  const packedParts = input.ledgers.map(ledger => packSelectionSalesFacts(prepareSelectionSalesFacts({ ...input, ledgers: [ledger] }), ledger));
  const packedRows = buildSelectionReferenceRows({ ...input, salesRows: [], ledgerIdentityRows: packedParts.flatMap(unpackSelectionFactIdentities).sort((a, b) => Number(a.sourceOrder) - Number(b.sourceOrder)), selectionSalesFacts: { packedParts }, ...patches, compactEvidence: true });
  expect(packedRows).toEqual(full);
  return { facts, rows: compact };
}

it('preserves exact quantities, prices, returns, deductions and representative counts', () => {
  const input = fixture([{ quantityExact: '1000000000000000000000000000' }, { quantityExact: '0.0000000001' }, { quantityExact: '-1000000000000000000000000000', movementType: '退货' }, { isDeduction: true, quantityExact: '5000' }, { unitPriceRaw: '0', sourceAddedAt: '2026-08-31T13:00:00+08:00' }]);
  const { facts, rows } = compare(input);
  expect(rows[0]).toMatchObject({ catalogSalePrice: 0, coverSalesQuantity: 1.0000000001, automaticSalesTag: { quantityExact: '1.0000000001', sourceRowCount: 4 } });
  expect(facts.ledgerIdentityRows[0].sourceCount).toBe(5);
  expect(facts.labelFacts.rows.length).toBeLessThan(input.salesRows.length);
});

it.each([
  [{ platformSkc: 'OTHER' }, {}],
  [{ platformSkc: '' }, {}],
  [{ sourceAddedDate: null, sourceAddedAt: null }, {}],
  [{ sourceAddedDate: '2026-09-01' }, {}],
  [{ quantityExact: 'bad' }, {}],
  [{ sourceRow: 2 }, { sourceRow: 2 }],
  [{ sourceRow: 2 }, { sourceRow: 2, quantityExact: '5' }],
  [{ sourceRow: 2 }, { sourceRow: 2, platformSkc: 'OTHER', platformSku: 'OTHER' }],
  [{ platformSku: undefined, sku: 'SKU' }, {}],
  [{ sourceRow: undefined, id: undefined }, { sourceRow: undefined, id: undefined, quantityExact: '5' }],
])('matches the full source projection for exceptional source evidence %#', (...patches) => compare(fixture(patches)));

it('resolves an unbound SKU only after current catalog changes and keeps manual fields authoritative', () => {
  const input = fixture([{ platformSkc: '' }, { platformSku: 'OTHER' }]);
  input.erpCosts = [];
  const before = compare(input);
  expect(before.rows.find(row => row.platformSku === 'OTHER').automaticSalesTag.reason).toBe('unresolved_identity');
  const patches = { products: [{ id: 'P', name: '人工名', platformSkc: 'SKC', store: '甲', attributes: { fieldEdits: { variants: { SKU: { salePrice: true } } } } }], platformSkus: [{ id: 'S', platformSku: 'SKU', platformSkc: 'SKC', productId: 'P', salePrice: 2 }] };
  const after = compare(input, patches);
  expect(after.rows.find(row => row.platformSku === 'SKU')).toMatchObject({ productName: '人工名', catalogSalePrice: 2, automaticSalesTag: { status: 'ready', quantityExact: '2' } });
  expect(after.facts).toEqual(before.facts);
});

it('keeps month/store completeness, invalid dates and every month selection', () => {
  const input = fixture([{}, { sourceAddedDate: '2026-08-01' }]);
  input.ledgers.push({ id: 'OLD', workspaceId: 'W', period: '2026-07' });
  for (const [ledgerId, period, store, scope] of [['OLD', '2026-07', '甲', 'full_month'], ['OLD', '2026-07', '乙', 'full_month'], ['L', '2026-08', '乙', 'partial']]) {
    const id = `${ledgerId}-${store}`;
    input.importBatches.push({ id, workspaceId: 'W', ledgerId, period, store, status: 'completed', validRowCount: 1, sourceCoverage: { version: 1, period, store, scope, declarationSource: 'manual' } });
    input.salesRows.push({ ...input.salesRows[0], id: input.salesRows.length + 1, ledgerId, batchId: id, store, sourceAddedDate: `${period}-28`, sourceAddedAt: `${period}-28T12:00:00+08:00` });
  }
  const facts = prepareSelectionSalesFacts(input);
  for (const store of ['all', '甲', '乙']) for (const period of [null, '2026-07', '2026-08']) {
    expect(buildSelectionSalesLabels({ ...input, store, period, labelFacts: facts.labelFacts })).toEqual(buildSelectionSalesLabels({ ...input, store, period }));
    compare(input, { store });
  }
});

it('has bounded per-identity/month facts rather than daily source arrays', () => {
  const input = fixture(Array.from({ length: 2800 }, (_, i) => ({ platformSku: `S${i % 100}`, sourceAddedDate: `2026-08-${String(Math.floor(i / 100) + 1).padStart(2, '0')}`, sourceAddedAt: `2026-08-${String(Math.floor(i / 100) + 1).padStart(2, '0')}T12:00:00+08:00` })));
  const facts = prepareSelectionSalesFacts(input);
  expect(facts.labelFacts.rows).toHaveLength(200);
  expect(facts.ledgerIdentityRows).toHaveLength(100);
  expect(facts.coverRows).toHaveLength(100);
  expect(derivedValueBytes(facts)).toBeLessThan(800000);
  const packed = packSelectionSalesFacts(facts, input.ledgers[0]);
  expect(derivedValueBytes(packed)).toBeLessThan(derivedValueBytes(facts) * 0.5);
});
