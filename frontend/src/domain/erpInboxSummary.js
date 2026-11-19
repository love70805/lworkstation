import { canonicalPlatformSku, canonicalWarehouseSku } from './identifiers';
import { indexErpAnomalyEvidence } from './erpAnomalyEvidence';

// Read-only UI projection. Never use this object to validate,
// adopt, ignore or confirm a purchase; those paths read the original receipt.
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const list = value => Array.isArray(value) ? value : [];
const rowFields = ['platformSku', 'canonicalPlatformSku', 'platformSkc', 'warehouseSku', 'ledgerScopeRole', 'evidenceRef', 'sourceWarnings', 'attribute', 'productName', 'previewUnitCost', 'unitCost'];

export function erpInboxSummary(inbox) {
  const { envelope, ...header } = inbox;
  const batch = envelope?.batch;
  const summary = { ...header, displayOnly: true };
  if (!envelope) return summary;
  summary.envelope = pick(envelope, ['sentAt', 'transport']);
  if (!batch) return summary;
  summary.envelope.batch = {
    ...pick(batch, ['batchId', 'requestId', 'workspaceId', 'ledgerId', 'ledgerPeriod', 'costPeriod', 'generatedAt', 'query', 'summary']),
    sourceMeta: pick(batch.sourceMeta, ['detailFailures', 'mappingFailures', 'scopeDirectoryFailures']),
    rows: list(batch.rows).map(row => pick(row, rowFields)),
    warehouseEvidence: list(batch.warehouseEvidence).map(evidence => {
      const records = Array.isArray(evidence.purchaseRecords) ? evidence.purchaseRecords : null;
      const first = records?.[0]?.unitPrice;
      const special = first != null && String(first).trim() !== '' && [0, 1].includes(Number(first))
        && records.every(row => row.unitPrice != null && String(row.unitPrice).trim() !== '' && Number(row.unitPrice) === Number(first));
      return { ...pick(evidence, ['evidenceRef', 'warehouseSku', 'evidenceComplete', 'sourceWarnings']),
        reviewPriceSummary: records ? { count: records.length, uniformSpecialPrice: special ? Number(first) : null } : null };
    }),
  };
  return summary;
}

// Group across receipts only when the full original purchase facts match.
// Store a digest in the disposable header, never the canonical purchase data.
export async function purchaseEvidenceDigest(key) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export function indexedErpInboxSummary(inbox, period) {
  const summary = erpInboxSummary(inbox), batch = inbox.envelope?.batch;
  if (!batch || !period || !globalThis.crypto?.subtle) return summary;
  const pending = new Set((inbox.adoption?.items ?? []).filter(item => item.state === 'anomaly_pending' && (item.platformSku || item.canonicalPlatformSku))
    .map(item => canonicalPlatformSku(item.platformSku ?? item.canonicalPlatformSku)));
  if (!pending.size) return summary;
  const wanted = new Set((batch.rows ?? []).filter(row => row.platformSku && row.warehouseSku && pending.has(canonicalPlatformSku(row.platformSku))).map(row => canonicalWarehouseSku(row.warehouseSku)));
  if (!wanted.size) return summary;
  let groups;
  try { groups = indexErpAnomalyEvidence(batch, period, wanted); }
  catch { return summary; } // A damaged legacy receipt still has its recorded review state.
  const digests = [];
  for (const evidence of summary.envelope.batch.warehouseEvidence) {
    const group = evidence.warehouseSku && groups.get(canonicalWarehouseSku(evidence.warehouseSku));
    if (!group) continue;
    const prices = new Set(group.decision.anomalies.map(item => item.originalUnitPrice));
    const [price] = prices;
    if (prices.size === 1 && Number.isFinite(price) && price >= 0) evidence.originalAnomalyPrice = price;
    digests.push(purchaseEvidenceDigest(group.key).then(digest => { evidence.reviewGroup = digest; }));
  }
  return Promise.all(digests).then(() => summary);
}
