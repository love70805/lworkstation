const prefix = 'lworkstation:trend-history:';
const memory = new Map();
const limit = 20;

export function saveTrendCheckpoint(entry, scope, snapshot) {
  if (!entry) return;
  const key = prefix + entry;
  const record = { scope, snapshot };
  memory.set(key,record);
  if (memory.size > limit) memory.delete(memory.keys().next().value);
  try {
    const keys = JSON.parse(sessionStorage.getItem(prefix) || '[]').filter(item => item !== key);
    keys.push(key);
    while (keys.length > limit) sessionStorage.removeItem(keys.shift());
    sessionStorage.setItem(key,JSON.stringify(record));
    sessionStorage.setItem(prefix,JSON.stringify(keys));
  } catch { /* The current window can still return when session storage is unavailable. */ }
}
export function readTrendCheckpoint(entry, scope) {
  const key = prefix + entry;
  let record = memory.get(key);
  if (!record && entry) {
    try { record = JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
  }
  return record?.scope === scope ? record.snapshot : null;
}
export function readTrendOrigin(state) {
  const origin = state?.trendOrigin;
  return origin?.entry && typeof origin.href === 'string' && /^\/workspace(?:\?|$)/.test(origin.href) ? origin : null;
}
export function trendReturnLocation(origin) {
  return { replace:true, state:{ trendEntry:origin.entry } };
}

export function productProfitHref({ ledgerId, skc, sku, stores = [], mode }) {
  const params = new URLSearchParams({ ledger:ledgerId, view:'detail', focusSkc:skc, q:sku || skc, store:stores.length === 1 ? stores[0] : 'all', missing:'0' });
  for (const store of stores) params.append('focusStore',store);
  if (sku) params.set('focusSku',sku);
  if (mode) params.set('fromMode',mode);
  return '/profit?' + params;
}
