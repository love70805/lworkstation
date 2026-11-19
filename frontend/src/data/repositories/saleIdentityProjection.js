import Dexie from 'dexie';
import { tableRevisionReader, transactionChangedTable } from '../db/derivedCache';

const salesRevision = tableRevisionReader('salesRows');
let page;

// Coverage and identity checks may use different spellings of the same
// legacy SKU. Preserve both the first and the last occurrence in source order.
export function collectSaleIdentities(includeDates) {
  const distinct = new Map();
  let position = 0;
  function add(row, index = position++) {
    const {workspaceId,ledgerId,store,platformSku,sku,platformSkc} = row;
    const item = {workspaceId,ledgerId,store,platformSku,sku,platformSkc};
    if (includeDates) item.importedAt = row.importedAt;
    const key = JSON.stringify(item), previous = distinct.get(key);
    if (previous) {
      previous.first = Math.min(previous.first,index);
      previous.last = Math.max(previous.last,index);
    } else distinct.set(key,{item,first:index,last:index});
  }
  const result = () => [...distinct.values()].flatMap(({item,first,last}) =>
    first === last ? [[first,item]] : [[first,item],[last,item]]).sort((a,b)=>a[0]-b[0]).map(([,item])=>item);
  return {add,result};
}

// Concurrent consumers may each own different source shards. Only complete
// native reads at one revision can prepare a financial identity projection.
export function capturePageSaleIdentities(ledger) {
  const revision = salesRevision();
  if (!revision || Dexie.currentTransaction) return null;
  const scope = JSON.stringify([revision,ledger.workspaceId,ledger.id]);
  if (page?.scope !== scope) page = {scope,collector:collectSaleIdentities(false),offsets:new Set(),count:0};
  const target = page;
  if (target.rows) return null;
  return {
    chunk(offset,rows) {
      if (target.rows || target.offsets.has(offset)) return;
      target.offsets.add(offset);
      rows.forEach((row,i)=>target.collector.add(row,offset+i));
      target.count += rows.length;
    },
    finish(total) {
      if (!target.rows && target === page && total === target.count && revision === salesRevision()) {
        target.rows = target.collector.result();
        target.collector = target.offsets = null;
      }
    },
  };
}
export function capturedSaleIdentities(ledger) {
  const scope = JSON.stringify([salesRevision(),ledger.workspaceId,ledger.id]);
  return page?.scope === scope && !transactionChangedTable(Dexie.currentTransaction,['salesRows']) ? page.rows : null;
}
