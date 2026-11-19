import Dexie from 'dexie';
import { db } from '../db/clientDatabase';
import { existingCostRowVersion, tableRevisionReader, transactionChangedTable } from '../db/derivedCache';
import { adoptionCostHeader } from './erpRecoveryReadCache';
import { projectCoverageCost } from '../../domain/costCoverage';
import { canonicalPlatformSku } from '../../domain/identifiers';
import { profitCostFields } from '../../domain/profitPageProjection';

// Fetch only the requested primary keys. Normal imports use long contiguous
// runs; sparse selections must never hydrate the intervening purchase evidence.
export async function readCostIds(ids, consume, signal) {
  const table = db.erpCostRows;
  for (let start = 0; start < ids.length; start += 32) {
    signal?.throwIfAborted();
    const part = ids.slice(start, start + 32);
    const rows = Number.isSafeInteger(part[0]) && Number.isSafeInteger(part.at(-1)) && part.at(-1) - part[0] === part.length - 1
      ? await table.where(':id').between(part[0], part.at(-1), true, true).toArray() : await table.bulkGet(part);
    for (const row of rows) if (row) consume(row);
  }
}

let actionLedger;
function actionCostFacts(ledger) {
  const tx = Dexie.currentTransaction;
  const version = existingCostRowVersion();
  const usable = version && !transactionChangedTable(tx, ['erpCostRows']);
  if (actionLedger?.version !== version || actionLedger?.id !== ledger.id || actionLedger?.period !== ledger.period || actionLedger?.workspaceId !== ledger.workspaceId) {
    actionLedger = {version, id:ledger.id, workspaceId:ledger.workspaceId, period:ledger.period, rows:new Map()};
  }
  const scope = actionLedger, updates = new Map();
  const project = (row, withinPeriod) => {
    const facts = {header:adoptionCostHeader(row), canonicalPlatformSku:row.canonicalPlatformSku, publishedAt:row.publishedAt,
      coverage:projectCoverageCost(row, ledger.period, withinPeriod)};
    if (usable && row.ledgerId === ledger.id) updates.set(row.id, facts);
    return facts;
  };
  function finish() {
    if (!updates.size) return;
    const publish = () => {
      if (scope !== actionLedger || version !== existingCostRowVersion()) return;
      for (const [id, facts] of updates) scope.rows.set(id, facts);
      while (scope.rows.size > 16000) scope.rows.delete(scope.rows.keys().next().value);
    };
    if (tx) tx.idbtrans.addEventListener('complete', publish, {once:true});
    else publish();
  }
  return {get: id => usable ? scope.rows.get(id) : null, project, finish};
}

// The write transaction owns the primary-key list. Only source-verified
// scalar facts are reusable. Original chosen purchases are still read on publish.
export async function readActionCostFacts(ledger, ids) {
  const cache = actionCostFacts(ledger);
  const facts = new Map(), missing = [];
  for (const id of ids) {
    const item = cache.get(id);
    if (item) facts.set(id, item);
    else missing.push(id);
  }
  await readCostIds(missing, row => {
    if (row.ledgerId === ledger.id) facts.set(row.id, cache.project(row));
  });
  cache.finish();
  return facts;
}

export async function readActionCostRows(ledger, consume) {
  const ids = await db.erpCostRows.where('ledgerId').equals(ledger.id).primaryKeys();
  const facts = await readActionCostFacts(ledger, ids);
  for (let i = ids.length-1; i >= 0; i--) {
    const item = facts.get(ids[i]);
    if (item) consume(item);
  }
}

export function costResolutionEntry(row, ledger, allowed, published) {
  if (row.ledgerId !== ledger.id || row.workspaceId && row.workspaceId !== ledger.workspaceId || !allowed.has(row.batchId)
    || !published.has(row.batchId) || !row.resolutions?.length) return null;
  return { id: row.id, batchId: row.batchId, sourceEnvelopeBatchId: row.sourceEnvelopeBatchId, resolutions: row.resolutions };
}

export async function completeProfitResolutionIndex(ledger, partial, signal) {
  const published = new Set(partial.publishedIds), resolutions = [...partial.resolutions];
  const unchecked = partial.unchecked ? new Set(partial.unchecked) : null;
  const resolvedIds = await db.erpCostRows.where('[ledgerId+resolutions.length]')
    .between([ledger.id, 0], [ledger.id, Dexie.maxKey], false, true).primaryKeys();
  const cache = actionCostFacts(ledger);
  await readCostIds(resolvedIds.filter(id => !unchecked || unchecked.has(id)).sort(Dexie.cmp), row => {
    cache.project(row);
    const entry = costResolutionEntry(row, ledger, published, published);
    if (entry) resolutions.push(entry);
  }, signal);
  cache.finish();
  return {publishedIds: partial.publishedIds, resolutions: resolutions.sort((a,b) => Dexie.cmp(a.id,b.id))};
}

const costRevision = tableRevisionReader('erpCostRows');
let lastHeaderIndex;
export async function readActionHeaderIndex(ledger, ids, { fresh = false } = {}) {
  const revision = costRevision(), tx = Dexie.currentTransaction;
  const reusable = !fresh && revision && !transactionChangedTable(tx, ['erpCostRows']);
  if (reusable && lastHeaderIndex?.revision === revision && lastHeaderIndex.ledgerId === ledger.id
    && lastHeaderIndex.headers.size === ids.length && ids.every(id => lastHeaderIndex.headers.has(id))) return lastHeaderIndex.headers;
  const headers = new Map();
  await db.erpCostRows.where('[ledgerId+workspaceId+batchId+platformSku+canonicalPlatformSku+publishedAt+sourceEnvelopeBatchId+warehouseSku+sourceOrder]')
    .between([ledger.id, Dexie.minKey], [ledger.id, Dexie.maxKey]).eachKey(([,workspaceId,batchId,platformSku,canonicalSku,publishedAt,sourceBatch,warehouseSku,sourceOrder], cursor) => {
      headers.set(cursor.primaryKey, {workspaceId,batchId,platformSku,canonicalSku,publishedAt,sourceBatch,warehouseSku,sourceOrder});
    });
  // A few legacy rows can lack one of the indexed fields. Read those originals
  // directly. For a predominantly legacy ledger keep the established scan.
  if (headers.size !== ids.length) {
    const missing = ids.filter(id => !headers.has(id));
    if (missing.length > 128 || missing.length > ids.length / 4) return null;
    await readCostIds(missing, row => {
      if (row.ledgerId !== ledger.id) return;
      const {workspaceId,batchId,platformSku,canonicalPlatformSku:canonicalSku,publishedAt,sourceEnvelopeBatchId:sourceBatch,warehouseSku,sourceOrder} = row;
      headers.set(row.id, {workspaceId,batchId,platformSku,canonicalSku,publishedAt,sourceBatch,warehouseSku,sourceOrder});
    });
  }
  if (headers.size !== ids.length || !ids.every(id => headers.has(id))) return null;
  if (reusable && headers.size <= 16000) {
    const remember = () => { if (costRevision() === revision) lastHeaderIndex = { ledgerId: ledger.id, revision, headers }; };
    if (tx) tx.idbtrans.addEventListener('complete', remember, {once:true});
    else remember();
  }
  return headers;
}

// Key-only secondary indices let a repeat collection hit each current purchase
// row once. Incomplete legacy indices or a foreign/orphan winner fall back to
// the owning scan; a voided winner still suppresses its predecessors.
export async function readIndexedProfitCosts(ledger, allowed, published) {
  const table = db.erpCostRows;
  const [ids, total] = await Promise.all([table.where('ledgerId').equals(ledger.id).primaryKeys(), table.count()]);
  if (ids.length < 256 || total > ids.length * 3 || !ids.every(Number.isSafeInteger)) return null;
  const ownedKeys = new Set(ids), dates = new Map(), heads = new Map();
  // Dates are not inferred from auto-increment IDs (restores can insert older
  // publications later). Compare actual string values exactly as the source scan.
  const headers = await readActionHeaderIndex(ledger, ids);
  if (headers) {
    for (const [id, row] of headers) {
      if (typeof row.publishedAt !== 'string') return null;
      dates.set(id, row.publishedAt);
    }
  } else {
    const datesForIndex = await table.orderBy('publishedAt').limit(257).uniqueKeys();
    if (datesForIndex.length > 256 || datesForIndex.some(date => typeof date !== 'string')) return null;
    await Promise.all(datesForIndex.map(async date => {
      for (const id of await table.where('publishedAt').equals(date).primaryKeys()) if (ownedKeys.has(id)) dates.set(id,date);
    }));
  }
  if (dates.size !== ids.length) return null;
  let indexed = 0;
  const record = (sku, id) => {
    if (!ownedKeys.has(id) || typeof sku !== 'string') return;
    indexed++;
    const head = heads.get(sku), date = dates.get(id);
    if (!head) heads.set(sku,{id,date,first:id});
    else {
      head.first = Math.min(head.first,id);
      const order = date.localeCompare(head.date);
      if (order > 0 || !order && id > head.id) { head.date = date; head.id = id; }
    }
  };
  // A registered request is a vocabulary hint only: every cost key in this
  // ledger must be accounted for by the index, including unrequested SKUs.
  if (headers) for (const [id, row] of headers) record(row.canonicalSku, id);
  const hint = headers ? null : await db.erpCostRequests.where('ledgerId').equals(ledger.id).last();
  if (hint?.workspaceId === ledger.workspaceId && hint.expectedSkus?.length) {
    const skus = [...new Set(hint.expectedSkus.map(row=>canonicalPlatformSku(row.platformSku)).filter(Boolean))];
    await db.transaction('r',table,async()=>{
      for (let start=0;start<skus.length;start+=192) await Promise.all(skus.slice(start,start+192).map(async sku=>{
        for (const id of await table.where('canonicalPlatformSku').equals(sku).primaryKeys()) record(sku,id);
      }));
    });
  }
  if (indexed !== ids.length) {
    indexed=0; heads.clear();
    await table.orderBy('canonicalPlatformSku').eachKey((sku,cursor)=>record(sku,cursor.primaryKey));
  }
  if (indexed !== ids.length || heads.size > ids.length * 0.8) return null;
  const byId = new Map([...heads].map(([sku,h])=>[h.id,sku]));
  const selected = [...byId.keys()].sort((a,b)=>a-b);
  const values = new Map(), resolutions = [];
  const cache = actionCostFacts(ledger);
  let valid = true;
  await readCostIds(selected,row=>{
    const sku=byId.get(row.id);
    if (row.ledgerId !== ledger.id || row.workspaceId && row.workspaceId !== ledger.workspaceId || !allowed.has(row.batchId)
      || row.canonicalPlatformSku !== sku || canonicalPlatformSku(row.platformSku) !== sku) { valid=false; return; }
    const cost = published.has(row.batchId) ? profitCostFields(row,ledger.period) : null;
    values.set(sku,cost);
    cache.project(row,cost?.withinPeriod);
    const entry=costResolutionEntry(row,ledger,allowed,published);
    if (entry) resolutions.push(entry);
  });
  cache.finish();
  if (!valid || values.size !== heads.size) return null;
  const costs=[...heads].sort((a,b)=>a[1].first-b[1].first).flatMap(([sku])=>values.get(sku) ? [values.get(sku)] : []);
  return {costs, resolutionIndex:{ publishedIds:[...allowed].filter(id=>published.has(id)), resolutions, unchecked:ids.filter(id=>!byId.has(id)) }};
}
