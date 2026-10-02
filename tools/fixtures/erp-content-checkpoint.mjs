// Minimal valid controller replies for tests whose subject is ERP reads/UI.
// Binding enforcement itself is covered with the real background worker.
export function collectionReply(message, { requestId = 'SYN-COST-REQUEST', ledgerPeriod = '2026-08', platformSkcs } = {}) {
  if (message.type === 'shopeers.erp.previewContext') return { ok: Boolean(ledgerPeriod), ledgerPeriod, requestId, requestSnapshot: 'synthetic-request-snapshot', ...(platformSkcs ? { platformSkcs } : {}) };
  if (message.type === 'shopeers.erp.collectionCheckpoint') return message.payload.action === 'list'
    ? { ok: true, records: [] }
    : { ok: true, checkpoint: { ...message.payload, resultDeliveryId: message.payload.resultDeliveryId || 'ERP-RESULT-' + requestId } };
  return null;
}
