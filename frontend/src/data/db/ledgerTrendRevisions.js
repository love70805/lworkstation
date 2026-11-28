// Per-ledger versions are disposable display metadata. The ordinary table
// clock remains authoritative for older writers, resets and overlapping writes.
const tables = new Set(['ledgers', 'salesRows', 'erpCostRows', 'erpCostBatches',
  'costApprovals', 'monthlySupplementBatches', 'monthlySupplementRows']);
const prefix = table => 'shopeers-trend-revision-v1:' + table;
const keyFor = (table, ledgerId) => prefix(table) + ':ledger:' + ledgerId;

export function trendLedgerRevision(table, ledgerId, tableClock) {
  try {
    const key = prefix(table);
    if (!tableClock) return null;
    if (!localStorage.getItem(key) && !localStorage.getItem(key + ':all')) {
      // First read of an existing database after upgrading.
      localStorage.setItem(key + ':all', crypto.randomUUID());
      localStorage.setItem(key, tableClock);
    }
    if (localStorage.getItem(key) !== tableClock) return tableClock;
    return JSON.stringify([localStorage.getItem(key + ':all'), localStorage.getItem(keyFor(table, ledgerId))]);
  } catch { return tableClock; }
}

export function beginLedgerChanges(table, tableClock) {
  if (!tables.has(table)) return null;
  const key = prefix(table);
  try {
    // A writer from another version may only have moved the table clock.
    if (!tableClock || localStorage.getItem(key) !== tableClock) {
      localStorage.setItem(key + ':all', crypto.randomUUID());
    }
  } catch { /* the table clock will be used until a scoped write succeeds */ }
  return { ids: new Set(), pending: null };
}

export function finishLedgerChanges(table, changes, previous, next) {
  if (!changes) return;
  const key = prefix(table);
  try {
    if (changes.ids === null || changes.pending !== previous) {
      localStorage.setItem(key + ':all', crypto.randomUUID());
    } else {
      for (const id of changes.ids) localStorage.setItem(keyFor(table, id), next);
    }
    // Publish only after all affected versions have been updated.
    localStorage.setItem(key, next);
  } catch { /* unmatched marker falls back to the ordinary table clock */ }
}

function collectOwners(changes, rows) {
  if (!changes.ids) return;
  for (const row of rows) {
    if (!row) continue;
    if (!row.ledgerId) { changes.ids = null; return; }
    changes.ids.add(row.ledgerId);
  }
}

export function captureLedgerChanges(table, request, changes) {
  if (!changes?.ids) return;
  if (request.type === 'deleteRange') { changes.ids = null; return; }
  const keyOf = table.schema.primaryKey.extractKey;
  if (table.name === 'ledgers') {
    for (const id of request.keys ?? request.values.map(keyOf)) changes.ids.add(id);
    return;
  }
  if (request.values) collectOwners(changes, request.values);
  if (request.type === 'add' || !changes.ids) return;
  const keys = (request.keys ?? request.values.map(keyOf)).filter(key => key != null);
  if (!keys.length) return;
  // Queue the old-value read before the mutation without delaying or reordering
  // writes. Both sides of a move, and the owner of a deleted key, must expire.
  return table.getMany({ trans: request.trans, keys, cache: 'immutable' })
    .then(rows => collectOwners(changes, rows), () => { changes.ids = null; });
}
