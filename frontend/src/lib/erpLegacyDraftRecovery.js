import { buildErpCostInboxEnvelope, ERP_INBOX_FORMAT } from '../domain/erpInboxContract';
import { ERP_COST_BATCH_FORMAT, ERP_COST_BATCH_VERSION } from '../domain/erpCostBatchEnvelope';
import { COST_DRAFT_STORAGE_PREFIX } from './costMatchingDraft';
import { getLedgerSnapshot, listErpCostRequests, receiveErpCostInboxEnvelope } from '../data/database';

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export async function recoverCompleteErpCostDrafts({
  workspaceId,
  storage = browserStorage(),
  getSnapshot = getLedgerSnapshot,
  listRequests = listErpCostRequests,
  receive = receiveErpCostInboxEnvelope,
} = {}) {
  if (!workspaceId || !storage) return { recovered: 0, failures: [] };
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter(key => key?.startsWith(COST_DRAFT_STORAGE_PREFIX));
  const failures = [];
  let recovered = 0;
  for (const key of keys) {
    try {
      const draft = JSON.parse(storage.getItem(key) ?? 'null');
      if (!draft?.sourceText || draft.loadedInboxId || draft.resolutions?.length) continue;
      const source = JSON.parse(draft.sourceText);
      const batch = source?.format === ERP_INBOX_FORMAT ? source.batch : source;
      if (batch?.format !== ERP_COST_BATCH_FORMAT || Number(batch.formatVersion) !== ERP_COST_BATCH_VERSION
        || Number(batch.sourceFormatVersion ?? batch.formatVersion) !== ERP_COST_BATCH_VERSION
        || batch.workspaceId !== workspaceId || key !== `${COST_DRAFT_STORAGE_PREFIX}${batch.ledgerId}`) continue;
      const snapshot = await getSnapshot(batch.ledgerId);
      const requests = await listRequests(batch.ledgerId);
      if (snapshot?.ledger?.workspaceId !== workspaceId
        || !requests.some(request => request.id === batch.requestId && request.workspaceId === workspaceId && request.ledgerId === batch.ledgerId)) continue;
      const envelope = source?.format === ERP_INBOX_FORMAT ? source : buildErpCostInboxEnvelope({
        batch,
        deliveryId: `ERP-RESTORED-DRAFT-${batch.batchId}`,
        sentAt: batch.generatedAt,
        transport: 'restored-cost-draft',
      });
      const receipt = await receive({ envelope, receivedVia: 'restored-cost-draft' });
      if (!receipt?.id) continue;
      // The inbox is durable even if adoption failed; the normal recovery loop retries it.
      storage.removeItem(key);
      recovered++;
    } catch (error) {
      failures.push({ key, message: error.message });
    }
  }
  return { recovered, failures };
}
