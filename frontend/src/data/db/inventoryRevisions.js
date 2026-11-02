import { db } from './clientDatabase';
import { sourceRevision, tableRevisionReader, observeTableRevision } from './derivedCache';

const evidenceTables = ['erpCostRows','erpCostBatches','erpCostInbox','erpCostRequests'];
const calculationTables = ['erpCostRows','erpCostBatches','ledgers','salesRows','costApprovals'];
const lowestTables = [...new Set([...calculationTables,...evidenceTables])];
const evidenceReaders = evidenceTables.map(tableRevisionReader);
const calculationReaders = calculationTables.map(tableRevisionReader);
const lowestReaders = lowestTables.map(tableRevisionReader);
const publishedTables = ['erpCostRows','erpCostBatches'];
const publishedReaders = publishedTables.map(tableRevisionReader);
const revision = readers => {
  const values = readers.map(read => read());
  return values.every(Boolean) ? JSON.stringify(values) : sourceRevision();
};
export const inventoryEvidenceRevision = () => revision(evidenceReaders);
export const inventoryCalculationRevision = () => revision(calculationReaders);
export const inventoryLowestRevision = () => revision(lowestReaders);
export const publishedCostRevision = () => revision(publishedReaders);
export async function observePublishedCostRevision() {
  await Promise.all(publishedTables.flatMap(table => [db.table(table).count(), observeTableRevision(table)]));
}
export async function observeInventoryRevision(evidenceOnly = false, mode = 'weighted') {
  const tables = evidenceOnly ? evidenceTables : mode === 'historical_lowest' ? lowestTables : calculationTables;
  await Promise.all(tables.flatMap(table => [db.table(table).count(), observeTableRevision(table)]));
}
