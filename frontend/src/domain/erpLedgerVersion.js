// Import batches are immutable identities. Cost adoption and manual changes must
// not invalidate a collection, while every new sales import must do so.
export function erpLedgerVersion(batches = []) {
  return JSON.stringify(batches.map(batch => [String(batch.id), String(batch.createdAt ?? '')])
    .sort((a, b) => a[0].localeCompare(b[0])));
}
