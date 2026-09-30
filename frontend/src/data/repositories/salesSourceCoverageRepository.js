import { db } from '../db/clientDatabase';
import { getActiveMemberContext } from './selectionRepository';
import { createSalesSourceCoverage, salesSourceDateEvidence } from '../../domain/selectionSalesLabels';

const key = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
async function candidates(ledgerId) {
  const [batches, rows] = await Promise.all([db.importBatches.where('ledgerId').equals(ledgerId).toArray(), db.salesRows.where('ledgerId').equals(ledgerId).toArray()]);
  return batches.filter(batch => batch.status === 'completed' && key(batch.store) && batch.sourceCoverage?.scope !== 'full_month').map(batch => {
    const active = rows.filter(row => row.batchId === batch.id);
    const storeRows = rows.filter(row => key(row.store) === key(batch.store));
    return { batch, active, eligible: active.length > 0 && batch.validRowCount === active.length && active.length === storeRows.length && active.every(row => key(row.store) === key(batch.store)) };
  });
}
export async function listSalesSourceConfirmations(ledgerId) {
  const member = await getActiveMemberContext();
  const ledger = await db.ledgers.get(ledgerId);
  if (!ledger || ledger.workspaceId !== member.workspaceId) return [];
  return (await candidates(ledgerId)).map(({ batch, eligible }) => ({ id: batch.id, fileName: batch.fileName, store: batch.store, period: ledger.period, rowCount: batch.validRowCount, eligible: eligible && !['finalized', 'locked'].includes(ledger.status) }));
}
// Explicit metadata confirmation; financial rows and reports are immutable here.
export async function confirmSalesSourceCoverage({ ledgerId, batchId, confirmed = false }) {
  if (!confirmed) throw new Error('请先确认此文件包含该店整月完整台账。');
  return db.transaction('rw', db.settings, db.ledgers, db.importBatches, db.salesRows, db.auditEvents, async () => {
    const member = await getActiveMemberContext();
    const ledger = await db.ledgers.get(ledgerId);
    if (!ledger || ledger.workspaceId !== member.workspaceId || !['admin', 'finance'].includes(member.role)) throw new Error('当前成员无此账本的确认权限。');
    if (['finalized', 'locked'].includes(ledger.status)) throw new Error('请先显式重开账本，再确认来源。');
    const entry = (await candidates(ledgerId)).find(item => item.batch.id === batchId && item.eligible);
    if (!entry || entry.batch.workspaceId !== member.workspaceId || entry.batch.period !== ledger.period) throw new Error('来源已变化或存在分组重导残留，请重新导入本店完整月台账。');
    const sourceCoverage = createSalesSourceCoverage({ period: ledger.period, storeName: entry.batch.store, declarationSource: 'manual' });
    const now = new Date().toISOString();
    await db.importBatches.update(batchId, { sourceCoverage, dateEvidence: salesSourceDateEvidence(entry.active, { period: ledger.period }) });
    await db.auditEvents.add({ workspaceId: member.workspaceId, objectType: 'sales_import_batch', objectId: batchId, action: 'confirm_sales_source_coverage', actorId: member.memberId, createdAt: now, before: { sourceCoverage: entry.batch.sourceCoverage ?? null }, after: { ledgerId, sourceCoverage } });
    return sourceCoverage;
  });
}
