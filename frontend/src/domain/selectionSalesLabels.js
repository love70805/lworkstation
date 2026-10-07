import Decimal from "decimal.js";
import { decimalSource, parseSalesAddedDate, SALES_TIMEZONE } from "./salesAnalytics";

const Exact = Decimal.clone({ precision: 80 });
const text = value => String(value ?? "").normalize("NFKC").trim();
const key = value => text(value).toUpperCase();
const validPeriod = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "");
const isSale = row => !row.isDeduction && !/盘亏|扣款|罚款|违约/.test(row.movementType ?? "");
export const SELECTION_SALES_LABEL_RULE = "ledger-month-end-seven-days@1";
export const SELECTION_SALES_LABELS = ["爆款", "高销", "一般", "低销"];

export function selectionSalesLabel(quantity) {
  const value = decimalSource(quantity, null);
  if (value === null || new Exact(value).lt(0)) return null;
  const count = new Exact(value);
  return count.gte(700) ? "爆款" : count.gte(100) ? "高销" : count.gte(10) ? "一般" : "低销";
}

// Alias conversion applies to derived labels only; a user's own tags are never rewritten.
export function normalizeSelectionSalesLabel(value) {
  return value === "热卖" ? "高销" : value === "较低" ? "一般" : SELECTION_SALES_LABELS.includes(value) ? value : null;
}

export function createSalesSourceCoverage({ period, storeName, scope = "full_month", declarationSource = "import_preview", supplierNumbers } = {}) {
  if (!validPeriod(period) || !text(storeName) || !["full_month", "partial"].includes(scope)) throw new Error("请确认台账来源月份、店铺及完整范围。");
  if (!["import_preview", "manual"].includes(declarationSource)) throw new Error("台账完整范围声明来源无效。");
  if (supplierNumbers !== undefined && (!Array.isArray(supplierNumbers) || !supplierNumbers.length || supplierNumbers.some(value => !text(value)))) throw new Error("请选择本次导入的供方货号。");
  return { version: supplierNumbers === undefined ? 1 : 2, period, store: text(storeName), scope, declarationSource,
    ...(supplierNumbers === undefined ? {} : { supplierNumbers: [...new Set(supplierNumbers.map(text))].sort() }) };
}

export function normalizeSalesSourceCoverage(coverage, { period, storeName } = {}) {
  if (coverage == null) return null; // Legacy imports have no implicit full-month coverage.
  if (![1, 2].includes(coverage.version) || (period && coverage.period !== period) || key(coverage.store) !== key(storeName)) throw new Error("台账来源声明与确认月份或店铺不一致。");
  return createSalesSourceCoverage({ period: coverage.period, storeName, scope: coverage.scope, declarationSource: coverage.declarationSource, ...(coverage.version === 2 ? { supplierNumbers: coverage.supplierNumbers ?? [] } : {}) });
}

export function salesSourceDateEvidence(rows = [], { period } = {}) {
  let salesRowCount = 0, validDateRowCount = 0, missingDateRowCount = 0, invalidDateRowCount = 0, outOfPeriodRowCount = 0;
  for (const row of rows) {
    if (!isSale(row)) continue;
    salesRowCount++;
    const parsed = parseSalesAddedDate(row.sourceAddedDate ?? row.rawAddedAt, { period });
    if (parsed.dateStatus === "valid") validDateRowCount++;
    else if (parsed.dateStatus === "missing") missingDateRowCount++;
    else if (parsed.dateStatus === "out_of_period") outOfPeriodRowCount++;
    else invalidDateRowCount++;
  }
  return { sourceField: "sourceAddedAt", timezone: SALES_TIMEZONE, status: !salesRowCount ? "unknown" : validDateRowCount === salesRowCount ? "complete" : !validDateRowCount ? "missing" : "partial", salesRowCount, validDateRowCount, missingDateRowCount, invalidDateRowCount, outOfPeriodRowCount, validDateRate: salesRowCount ? validDateRowCount / salesRowCount : null };
}

function windowFor(period) {
  if (!validPeriod(period)) return { startDate: null, endDate: null, rangeLabel: null };
  const [year, month] = period.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDate = `${period}-${String(last - 6).padStart(2,"0")}`, endDate = `${period}-${String(last).padStart(2,"0")}`;
  return { startDate, endDate, rangeLabel: `${startDate}—${endDate}` };
}

function identityStores(identity) {
  return [identity.store, identity.storeName, ...(identity.stores ?? []), ...(identity.storeNames ?? []), ...(identity.platformSkcEvidence ?? []).filter(candidate => !identity.platformSkc || key(candidate.value) === key(identity.platformSkc)).flatMap(candidate => (candidate.sources ?? []).map(source => source.store))].map(value => typeof value === "object" ? value?.store ?? value?.storeName : value).map(text).filter(Boolean);
}

// Catalog-independent source facts. Deduplication and completeness precede
// aggregation. Unresolved identities are resolved against the current catalog.
export function prepareSelectionSalesLabelFacts({ salesRows = [], importBatches = [], ledgers = [], workspaceId = null, compact = true } = {}) {
  const ledgerById = new Map(ledgers.filter(ledger => validPeriod(ledger.period) && (!workspaceId || ledger.workspaceId === workspaceId)).map(ledger => [ledger.id, ledger]));
  const batchById = new Map(importBatches.filter(batch => ledgerById.has(batch.ledgerId) && (!workspaceId || batch.workspaceId === workspaceId) && (!batch.workspaceId || batch.workspaceId === ledgerById.get(batch.ledgerId).workspaceId)).map(batch => [batch.id,batch]));
  const seen = new Map(), conflicts = [];
  const rows = [];
  for (const [index,row] of salesRows.entries()) {
    const ledger = ledgerById.get(row.ledgerId), batch = batchById.get(row.batchId);
    if (!ledger || (workspaceId && row.workspaceId !== workspaceId) || (row.workspaceId && row.workspaceId !== ledger.workspaceId) || (row.batchId && (!batch || batch.status !== "completed" || batch.ledgerId !== row.ledgerId))) continue;
    const coordinate = row.sourceRow != null ? JSON.stringify([row.ledgerId, batch?.fileHash ?? row.batchId, key(row.store), row.sourceSheet ?? "", row.sourceRow]) : row.id != null ? `id:${row.id}` : `unlocated:${index}`;
    const content = JSON.stringify([row.ledgerId,key(row.store),key(row.platformSkc),key(row.platformSku ?? row.sku),row.sourceAddedDate,row.rawAddedAt,row.quantityExact ?? row.quantity,row.amountExact ?? row.amount,Boolean(row.isDeduction)]);
    if (seen.has(coordinate)) { if (seen.get(coordinate) !== content) conflicts.push(row); continue; }
    seen.set(coordinate, content); rows.push(row);
  }
  const rowsByBatch = new Map(), rowCountByScope = new Map();
  for (const row of rows) {
    if (!rowsByBatch.has(row.batchId)) rowsByBatch.set(row.batchId,[]);
    rowsByBatch.get(row.batchId).push(row);
    const scopeKey = JSON.stringify([row.ledgerId,key(row.store)]);
    rowCountByScope.set(scopeKey,(rowCountByScope.get(scopeKey) ?? 0)+1);
  }
  const completeMonths = new Map(), completeProductMonths = new Map(), completeStoreNames = [];
  for (const batch of batchById.values()) {
    const ledger = ledgerById.get(batch.ledgerId), coverage = batch.sourceCoverage;
    const activeRows = rowsByBatch.get(batch.id) ?? [];
    const scopeRowCount = rowCountByScope.get(JSON.stringify([batch.ledgerId,key(batch.store)])) ?? 0;
    if (batch.status !== "completed" || ![1, 2].includes(coverage?.version) || coverage.scope !== "full_month" || coverage.period !== ledger.period || batch.period !== ledger.period || !key(batch.store) || key(coverage.store) !== key(batch.store) || !["import_preview","manual"].includes(coverage.declarationSource) || !Number.isInteger(batch.validRowCount) || batch.validRowCount !== activeRows.length || scopeRowCount !== activeRows.length || activeRows.some(row => key(row.store) !== key(batch.store))) continue;
    const storeKey = key(batch.store);
    if (coverage.version === 2) {
      if (!Array.isArray(coverage.supplierNumbers) || !coverage.supplierNumbers.length || activeRows.some(row => !coverage.supplierNumbers.includes(text(row.supplierNumber)))) continue;
      for (const skc of new Set(activeRows.map(row => key(row.platformSkc)).filter(Boolean))) {
        const identity = JSON.stringify([storeKey, skc]);
        if (!completeProductMonths.has(identity)) completeProductMonths.set(identity, new Set());
        completeProductMonths.get(identity).add(ledger.period);
      }
      completeStoreNames.push([storeKey, text(batch.store)]);
      continue;
    }
    completeStoreNames.push([storeKey, text(batch.store)]);
    if (!completeMonths.has(storeKey)) completeMonths.set(storeKey,new Set());
    completeMonths.get(storeKey).add(ledger.period);
  }
  const aggregate = input => {
    const grouped = new Map();
    for (const row of input) {
      const period = ledgerById.get(row.ledgerId)?.period;
      const parsed = parseSalesAddedDate(row.sourceAddedDate ?? row.rawAddedAt, { period });
      const quantity = decimalSource(row.quantityExact ?? row.quantity ?? row.qty, null);
      const window = windowFor(period);
      // The only date query in the label contract is month-end seven days.
      const date = parsed.dateStatus !== "valid" ? "invalid" : parsed.sourceAddedDate >= window.startDate ? window.endDate : period + "-01";
      const identity = JSON.stringify([row.ledgerId, row.store, row.platformSkc, row.platformSku ?? row.sku, date, quantity === null, isSale(row)]);
      if (!grouped.has(identity)) grouped.set(identity, { ledgerId: row.ledgerId, store: row.store, platformSkc: row.platformSkc, platformSku: row.platformSku ?? row.sku, sourceAddedDate: date, isDeduction: !isSale(row), quantityExact: quantity === null ? null : new Exact(0), sourceCount: 0 });
      const item = grouped.get(identity);
      item.sourceCount++;
      if (quantity !== null) item.quantityExact = item.quantityExact.plus(quantity);
    }
    return [...grouped.values()].map(row => ({ ...row, quantityExact: row.quantityExact?.toFixed() ?? null }));
  };
  return { rows: compact ? aggregate(rows) : rows, conflicts: compact ? aggregate(conflicts) : conflicts, completeMonths, completeProductMonths, completeStoreNames };
}

// All input tables must belong to the same workspace. The optional workspaceId
// also enforces this in standalone callers. This is a read-only projection: it
// never synthesizes monthly sales/cost rows or edits catalog/manual tags.
export function buildSelectionSalesLabels({ salesRows = [], importBatches = [], ledgers = [], products = [], productSkus = [], store = "all", period = null, workspaceId = null, labelFacts = null } = {}) {
  if (period !== null && !validPeriod(period)) throw new Error("销量标签月份无效。");
  const ledgerById = new Map(ledgers.filter(ledger => validPeriod(ledger.period) && (!workspaceId || ledger.workspaceId === workspaceId)).map(ledger => [ledger.id, ledger]));
  const batchById = new Map(importBatches.filter(batch => ledgerById.has(batch.ledgerId) && (!workspaceId || batch.workspaceId === workspaceId) && (!batch.workspaceId || batch.workspaceId === ledgerById.get(batch.ledgerId).workspaceId)).map(batch => [batch.id,batch]));
  const groups = new Map(), skuSkcs = new Map(), storeNames = new Map(), identityConflictedGroups = new Set();
  const productById = new Map(products.map(product => [product.id,product]));
  const ensureGroup = (skc, stores = [], sku = "") => {
    if (!text(skc)) return null;
    const canonical = key(skc);
    if (!groups.has(canonical)) groups.set(canonical, { platformSkc: text(skc), canonicalPlatformSkc: canonical, stores: new Set() });
    const group = groups.get(canonical);
    for (const value of stores) { const name = text(value); if (name) { group.stores.add(key(name)); storeNames.set(key(name), name); } }
    if (text(sku)) { if (!skuSkcs.has(key(sku))) skuSkcs.set(key(sku), new Set()); skuSkcs.get(key(sku)).add(canonical); }
    return group;
  };
  for (const identity of productSkus) {
    const parent = productById.get(identity.productId);
    const group = ensureGroup(identity.platformSkc || parent?.platformSkc || parent?.skc, [...identityStores(parent ?? {}), ...identityStores(identity)], identity.platformSku ?? identity.sku);
    if (group && identity.platformSkcConflict) identityConflictedGroups.add(group.canonicalPlatformSkc);
  }
  for (const product of products) ensureGroup(product.platformSkc || product.skc, identityStores(product));

  const prepared = labelFacts ?? prepareSelectionSalesLabelFacts({ salesRows, importBatches, ledgers, workspaceId, compact: false });
  const { rows, conflicts, completeMonths } = prepared;
  const productMonths = (store, skc) => new Set([...(completeMonths.get(store) ?? []), ...(prepared.completeProductMonths?.get(JSON.stringify([store, skc])) ?? [])]);
  for (const row of rows) {
    const name = text(row.store);
    if (name) storeNames.set(key(name), name);
    ensureGroup(row.platformSkc, name ? [name] : [], row.platformSku ?? row.sku);
  }
  for (const row of rows) {
    if (text(row.platformSkc)) continue;
    const candidates = skuSkcs.get(key(row.platformSku ?? row.sku));
    if (candidates?.size === 1) ensureGroup([...candidates][0], [row.store]);
  }
  for (const skcs of skuSkcs.values()) if (skcs.size > 1) for (const skc of skcs) identityConflictedGroups.add(skc);
  for (const [storeKey, name] of prepared.completeStoreNames) storeNames.set(storeKey, name);
  const selectedStores = store === "all" ? [...new Set([...rows.map(row => key(row.store)).filter(Boolean), ...completeMonths.keys()])] : [...new Set((Array.isArray(store) ? store : [store]).map(key).filter(Boolean))];
  const selectedStoreKeys = new Set(selectedStores), conflictRows = new Set(conflicts);
  const commonMonths = selectedStores.length ? [...(completeMonths.get(selectedStores[0]) ?? [])].filter(month => selectedStores.every(name => completeMonths.get(name)?.has(month))).sort().reverse() : [];
  const chosenPeriod = period ?? commonMonths[0] ?? null;
  const covered = chosenPeriod && selectedStores.length && selectedStores.every(name => completeMonths.get(name)?.has(chosenPeriod));
  const status = covered ? "ready" : selectedStores.length > 1 ? "no_common_month" : "no_complete_month";
  const window = windowFor(chosenPeriod), storeProblems = new Set(), groupProblems = new Map(), totals = new Map();
  // A product uses only its own source stores. An unrelated incomplete store
  // must not invalidate it; a multi-store product still needs a common month.
  const groupPeriods = new Map([...groups.values()].map(group => {
    const stores = [...group.stores].filter(name => selectedStoreKeys.has(name));
    const months = stores.length ? [...productMonths(stores[0], group.canonicalPlatformSkc)].filter(month => stores.every(name => productMonths(name, group.canonicalPlatformSkc).has(month))).sort().reverse() : [];
    return [group.canonicalPlatformSkc, period ?? months[0] ?? null];
  }));
  const addProblem = (skc, reason) => { if (!groupProblems.has(skc)) groupProblems.set(skc,new Set()); groupProblems.get(skc).add(reason); };
  for (const skc of identityConflictedGroups) addProblem(skc,"identity_conflict");
  const resolveSkc = row => key(row.platformSkc) || (skuSkcs.get(key(row.platformSku ?? row.sku))?.size === 1 ? [...skuSkcs.get(key(row.platformSku ?? row.sku))][0] : "");
  for (const row of [...rows, ...conflicts]) {
    const storeKey = key(row.store), ledger = ledgerById.get(row.ledgerId);
    if (!selectedStoreKeys.has(storeKey) || !isSale(row)) continue;
    const skc = resolveSkc(row);
    if (!skc) { storeProblems.add(JSON.stringify([storeKey, ledger?.period])); continue; }
    const itemPeriod = groupPeriods.get(skc);
    if (!itemPeriod || ledger?.period !== itemPeriod) continue;
    const itemWindow = windowFor(itemPeriod);
    ensureGroup(skc, [row.store], row.platformSku ?? row.sku);
    if (!totals.has(skc)) totals.set(skc,{ month: new Exact(0), window: new Exact(0), sourceRowCount: 0 });
    const total = totals.get(skc), quantity = decimalSource(row.quantityExact ?? row.quantity ?? row.qty, null);
    if (conflictRows.has(row)) { addProblem(skc,"source_conflict"); continue; }
    total.sourceRowCount += row.sourceCount ?? 1;
    if (quantity === null) { addProblem(skc,"invalid_quantity"); continue; }
    total.month = total.month.plus(quantity);
    if (skuSkcs.get(key(row.platformSku ?? row.sku))?.size > 1) addProblem(skc,"identity_conflict");
    const parsed = parseSalesAddedDate(row.sourceAddedDate ?? row.rawAddedAt,{period:itemPeriod});
    if (parsed.dateStatus !== "valid") { addProblem(skc,"missing_dates"); continue; }
    if (parsed.sourceAddedDate >= itemWindow.startDate && parsed.sourceAddedDate <= itemWindow.endDate) total.window = total.window.plus(quantity);
  }
  const items = [...groups.values()].map(group => {
    const scopedStores = [...group.stores].filter(name => selectedStoreKeys.has(name));
    const total = totals.get(group.canonicalPlatformSkc), problems = groupProblems.get(group.canonicalPlatformSkc) ?? new Set();
    const itemPeriod = groupPeriods.get(group.canonicalPlatformSkc);
    const itemCovered = itemPeriod && scopedStores.length && scopedStores.every(name => productMonths(name, group.canonicalPlatformSkc).has(itemPeriod));
    let itemStatus = itemCovered ? "ready" : scopedStores.length > 1 ? "no_common_month" : "no_complete_month", reason = itemStatus;
    if (!group.stores.size) { itemStatus = "unknown_store"; reason = "unknown_store"; }
    else if (!scopedStores.length) { itemStatus = "out_of_scope"; reason = "out_of_scope"; }
    else if (itemCovered && scopedStores.some(name => storeProblems.has(JSON.stringify([name, itemPeriod])))) { itemStatus = "insufficient"; reason = "unresolved_identity"; }
    else if (itemCovered && problems.size) { itemStatus = "insufficient"; reason = [...problems][0]; }
    if (itemStatus === "ready" && ((total?.window ?? new Exact(0)).lt(0) || (total?.month ?? new Exact(0)).lt(0))) { itemStatus = "insufficient"; reason = "invalid_quantity"; }
    const quantityExact = itemStatus === "ready" ? (total?.window ?? new Exact(0)).toFixed() : null;
    return { platformSkc: group.platformSkc, canonicalPlatformSkc: group.canonicalPlatformSkc, status: itemStatus, reason: itemStatus === "ready" ? null : reason, label: quantityExact === null ? null : selectionSalesLabel(quantityExact), quantityExact, knownQuantityExact: total?.window.toFixed() ?? null, monthQuantityExact: total?.month.toFixed() ?? null, sourceRowCount: total?.sourceRowCount ?? 0, stores: scopedStores.map(name => storeNames.get(name) ?? name), period: itemPeriod, ...windowFor(itemPeriod), rule: SELECTION_SALES_LABEL_RULE };
  }).sort((a,b) => a.canonicalPlatformSkc.localeCompare(b.canonicalPlatformSkc));
  return { period: chosenPeriod, ...window, status, stores: selectedStores.map(name => storeNames.get(name) ?? name), timezone: SALES_TIMEZONE, rule: SELECTION_SALES_LABEL_RULE, items };
}

