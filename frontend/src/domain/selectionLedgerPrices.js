import Decimal from "decimal.js";
import { canonicalPlatformSku, canonicalPlatformSkc } from "./identifiers";
import { decimalSource, parseSalesAddedDate } from "./salesAnalytics";

const text = value => String(value ?? "").normalize("NFKC").trim();
const key = value => text(value).toUpperCase();
const Exact = Decimal.clone({ precision: 80 });
const isSale = row => !row.isDeduction && !/盘亏|扣款|罚款|违约/.test(row.movementType ?? "");

// Read-only contract: latest normal business timestamp within one SKU/store/month.
// Only prices at that instant compete; ties use that price's month net units.
// Neither this projection nor its provenance changes ledger revenue/formal costs.
export function buildSelectionLedgerPriceIndex({ salesRows = [], importBatches = [], ledgers = [], workspaceId = null, compactEvidence = false } = {}) {
  const ledgerById = new Map(ledgers.filter(row => !workspaceId || row.workspaceId === workspaceId).map(row => [row.id, row]));
  const batches = new Map(importBatches.filter(row => row.status === "completed" && (!workspaceId || row.workspaceId === workspaceId)).map(row => [row.id, row]));
  const index = new Map(), seen = new Map();
  const addSource = (sources, source) => {
    if (!compactEvidence || !sources.length) sources.push(source);
    else sources[0].sourceCount = (sources[0].sourceCount ?? 1) + 1;
  };
  for (const row of salesRows) {
    const ledger = ledgerById.get(row.ledgerId), batch = batches.get(row.batchId);
    if (!ledger || !batch || batch.ledgerId !== row.ledgerId || key(batch.store) !== key(row.store) || !text(row.platformSku ?? row.sku) || !isSale(row) || workspaceId && row.workspaceId !== workspaceId) continue;
    const sku = canonicalPlatformSku(row.platformSku ?? row.sku);
    if (!index.has(sku)) index.set(sku, new Map());
    const scopeKey = JSON.stringify([row.ledgerId, key(row.store)]), scopes = index.get(sku);
    if (!scopes.has(scopeKey)) scopes.set(scopeKey, { ledgerId: row.ledgerId, period: ledger.period, store: row.store, latest: -Infinity, candidates: new Map(), totals: new Map(), uncertain: false, latestDate: "", dayCandidates: new Map(), uncertainTime: false, latestMissingPrice: false, missingSources: [], dayMissingPrice: false, dayMissingSources: [], uncertainQuantity: false });
    const scope = scopes.get(scopeKey);
    const price = decimalSource(row.unitPriceRaw ?? row.unitPrice, null), quantity = decimalSource(row.quantityExact ?? row.quantity ?? row.qty, null);
    const parsed = parseSalesAddedDate(row.sourceAddedAt || row.rawAddedAt || row.sourceAddedDate, { period: ledger.period });
    const timestamp = parsed.sourceAddedTimestamp;
    const coordinate = row.sourceRow != null ? JSON.stringify([row.ledgerId, batch.fileHash ?? batch.id, key(row.store), row.sourceSheet ?? "", row.sourceRow]) : row.id ? `id:${row.id}` : null;
    const content = JSON.stringify([sku, price, quantity, timestamp, row.movementType]);
    if (coordinate && seen.has(coordinate)) { if (seen.get(coordinate) !== content) scope.uncertain = true; continue; }
    if (coordinate) seen.set(coordinate, content);
    if (quantity === null) { scope.uncertain = true; continue; }
    if (/退货|退款|冲销/.test(row.movementType ?? "" ) && new Exact(quantity).gt(0)) { scope.uncertain = true; continue; }
    const validPrice = price !== null && new Exact(price).gte(0);
    const priceKey = validPrice ? new Exact(price).toFixed() : null;
    if (validPrice) scope.totals.set(priceKey, (scope.totals.get(priceKey) ?? new Exact(0)).plus(quantity));
    else scope.uncertainQuantity = true;
    // Returns can offset net units, but only normal positive sales establish the
    // latest instant. Missing prices at that instant must not revive old prices.
    if (new Exact(quantity).lte(0) || /退货|退款|冲销/.test(row.movementType ?? "")) continue;
    if (parsed.dateStatus !== "valid" || !Number.isFinite(timestamp)) { scope.uncertain = true; continue; }
    const precision = row.sourceTimePrecision || parsed.sourceTimePrecision;
    const source = { kind: "ledger", ledgerId: row.ledgerId, period: ledger.period, store: row.store, batchId: row.batchId, sourceSheet: row.sourceSheet ?? null, sourceRow: row.sourceRow ?? null, sourceAddedAt: parsed.sourceAddedAt, sourceTimePrecision: precision };
    if (parsed.sourceAddedDate > scope.latestDate) { scope.latestDate = parsed.sourceAddedDate; scope.dayCandidates.clear(); scope.uncertainTime = false; scope.dayMissingPrice = false; scope.dayMissingSources = []; }
    if (parsed.sourceAddedDate === scope.latestDate) {
      if (validPrice) {
        if (!scope.dayCandidates.has(priceKey)) scope.dayCandidates.set(priceKey, []);
        addSource(scope.dayCandidates.get(priceKey), { ...source });
      } else { scope.dayMissingPrice = true; addSource(scope.dayMissingSources, { ...source }); }
      scope.uncertainTime ||= precision === "day";
    }
    if (timestamp < scope.latest) continue;
    if (timestamp > scope.latest) { scope.latest = timestamp; scope.candidates.clear(); scope.latestMissingPrice = false; scope.missingSources = []; }
    if (!validPrice) { scope.latestMissingPrice = true; addSource(scope.missingSources, { ...source }); continue; }
    if (!scope.candidates.has(priceKey)) scope.candidates.set(priceKey, []);
    addSource(scope.candidates.get(priceKey), { ...source });
  }
  return index;
}

export function selectionLedgerPrice(index, platformSku, { ledgerId = null, store = null } = {}) {
  let scopes = [...(index.get(canonicalPlatformSku(platformSku))?.values() ?? [])];
  if (ledgerId) scopes = scopes.filter(scope => scope.ledgerId === ledgerId);
  if (store && store !== "all") scopes = scopes.filter(scope => key(scope.store) === key(store));
  if (!scopes.length) return { status: "missing", value: null, candidates: [], sources: [] };
  const latestPeriod = scopes.map(scope => scope.period).sort().at(-1);
  scopes = scopes.filter(scope => scope.period === latestPeriod);
  if (scopes.length !== 1) return { status: "choose", reason: "ambiguous_store", value: null, period: latestPeriod, candidates: [], sources: scopes.map(({ ledgerId, period, store }) => ({ ledgerId, period, store })) };
  const scope = scopes[0];
  const timeUncertain = scope.uncertainTime && (scope.dayCandidates.size > 1 || scope.dayMissingPrice);
  const candidates = [...(timeUncertain ? scope.dayCandidates : scope.candidates)].map(([price, sources]) => ({ value: Number(price), priceExact: price, quantityExact: scope.totals.get(price)?.toFixed?.() ?? scope.totals.get(price) ?? null, sources }));
  const sources = [...candidates.flatMap(candidate => candidate.sources), ...(timeUncertain ? scope.dayMissingSources : scope.missingSources)];
  const base = { kind: "ledger", period: scope.period, store: scope.store, ledgerId: scope.ledgerId, sourceAddedAt: sources[0]?.sourceAddedAt ?? null, candidates, sources };
  if (!candidates.length) return { ...base, status: "missing", value: null };
  const invalidNet = candidates.some(candidate => new Exact(candidate.quantityExact ?? 0).lt(0));
  if (candidates.length === 1 && !scope.uncertain && !invalidNet && !scope.latestMissingPrice && !timeUncertain) return { ...base, status: "ready", value: candidates[0].value };
  const ranked = [...candidates].sort((a, b) => new Exact(b.quantityExact ?? 0).cmp(a.quantityExact ?? 0));
  const uniqueWinner = !scope.uncertain && !scope.uncertainQuantity && !scope.latestMissingPrice && !invalidNet && !timeUncertain && ranked.length > 1 && new Exact(ranked[0].quantityExact).gt(ranked[1].quantityExact);
  return { ...base, status: uniqueWinner ? "ready" : "choose", reason: uniqueWinner ? "net_quantity" : timeUncertain ? "missing_time" : scope.latestMissingPrice ? "missing_latest_price" : "ambiguous_price", value: uniqueWinner ? ranked[0].value : null };
}

export function selectionCatalogLedgerBySkc(rows = []) {
  const result = new Map();
  for (const row of rows) {
    if (!row.platformSkc || !row.ledgerId || row.catalogEligible === false) continue;
    const skc = canonicalPlatformSkc(row.platformSkc), previous = result.get(skc);
    if (!previous || (Date.parse(row.publishedAt ?? "") || 0) > (Date.parse(previous.publishedAt ?? "") || 0)) result.set(skc, row);
  }
  return result;
}
