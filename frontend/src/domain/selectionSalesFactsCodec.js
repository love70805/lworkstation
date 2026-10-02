// Positional tuples remove repeated property names and inherited scope fields
// from the disposable cache. This is lossless; business rows remain untouched.
const identityFields = ['platformSku', 'platformSkc', 'attribute', 'store', 'supplierNumber', 'sourceSheet', 'sourceRow', 'sourceOrder', 'sourceCount', 'batchId'];
const coverFields = ['id', 'batchId', 'platformSkc', 'platformSku', 'store', 'sourceSheet', 'sourceRow', 'quantityExact', 'selectionFactId'];
const labelFields = ['store', 'platformSkc', 'platformSku', 'sourceAddedDate', 'isDeduction', 'quantityExact', 'sourceCount'];
const sourceFields = ['batchId', 'sourceSheet', 'sourceRow', 'sourceAddedAt', 'sourceTimePrecision', 'sourceCount'];
const scopeFields = ['latest', 'uncertain', 'latestDate', 'uncertainTime', 'latestMissingPrice', 'dayMissingPrice', 'uncertainQuantity'];
const packRows = (rows, fields) => rows.map(row => fields.map(field => row[field]));
const unpackRows = (rows, fields, inherited = {}) => rows.map(values => ({ ...inherited, ...Object.fromEntries(fields.flatMap((field, index) => values[index] === undefined ? [] : [[field, values[index]]])) }));

export function packSelectionSalesFacts(facts, ledger) {
  const packSources = rows => packRows(rows, sourceFields);
  const candidates = values => [...values].map(([price, sources]) => [price, packSources(sources)]);
  const prices = [...facts.ledgerPriceIndex].map(([sku, scopes]) => [sku, [...scopes.values()].map(scope => {
    const useDay = scope.uncertainTime && (scope.dayCandidates.size > 1 || scope.dayMissingPrice);
    return [scope.store, scopeFields.map(field => scope[field]), [...scope.totals], candidates(scope.candidates), useDay ? candidates(scope.dayCandidates) : [], packSources(scope.missingSources), useDay ? packSources(scope.dayMissingSources) : []];
  })]);
  return { format: 1, workspaceId: facts.workspaceId, ledgerId: ledger.id, period: ledger.period, sourceRowCount: facts.sourceRowCount,
    identities: packRows(facts.ledgerIdentityRows, identityFields), cover: packRows(facts.coverRows, coverFields), prices,
    labels: packRows(facts.labelFacts.rows, labelFields), conflicts: packRows(facts.labelFacts.conflicts, labelFields), completeMonths: [...facts.labelFacts.completeMonths].map(([store, months]) => [store, [...months]]), completeStoreNames: facts.labelFacts.completeStoreNames };
}

export function unpackSelectionFactIdentities(packed) {
  return unpackRows(packed.identities, identityFields, { workspaceId: packed.workspaceId, ledgerId: packed.ledgerId, period: packed.period });
}

export function unpackSelectionSalesFacts(packed) {
  const inherited = { workspaceId: packed.workspaceId, ledgerId: packed.ledgerId };
  const ledgerPriceIndex = new Map(packed.prices.map(([sku, scopes]) => [sku, new Map(scopes.map(([store, flags, totals, candidates, dayCandidates, missingSources, dayMissingSources]) => {
    const sourceScope = { kind: 'ledger', ledgerId: packed.ledgerId, period: packed.period, store };
    const sources = rows => unpackRows(rows, sourceFields, sourceScope);
    const scope = { ...sourceScope, ...Object.fromEntries(scopeFields.map((field, index) => [field, flags[index]])), totals: new Map(totals), candidates: new Map(candidates.map(([price, rows]) => [price, sources(rows)])), dayCandidates: new Map(dayCandidates.map(([price, rows]) => [price, sources(rows)])), missingSources: sources(missingSources), dayMissingSources: sources(dayMissingSources) };
    return [JSON.stringify([packed.ledgerId, String(store ?? '').normalize('NFKC').trim().toUpperCase()]), scope];
  }))]));
  return { workspaceId: packed.workspaceId, sourceRowCount: packed.sourceRowCount, ledgerIdentityRows: unpackSelectionFactIdentities(packed), coverRows: unpackRows(packed.cover, coverFields, inherited), ledgerPriceIndex,
    labelFacts: { rows: unpackRows(packed.labels, labelFields, { ledgerId: packed.ledgerId }), conflicts: unpackRows(packed.conflicts, labelFields, { ledgerId: packed.ledgerId }), completeMonths: new Map(packed.completeMonths.map(([store, months]) => [store, new Set(months)])), completeStoreNames: packed.completeStoreNames } };
}
