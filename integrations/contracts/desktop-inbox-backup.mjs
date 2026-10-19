export const DESKTOP_INBOX_BACKUP_FORMAT='lworkstation-desktop-inbox-backup';
export const DESKTOP_RESTORE_COMMIT='desktopInboxRestoreCommit';
export const INBOX_RUNTIME_KINDS=new Set(['extension-status','selection-extension-status','selection-active-context']);
const businessKinds=new Set(['request','batch','catalog-batch','collection-task','selection-capture']);
export function validateDesktopInboxBackup(value) {
  if(value===undefined)return;
  const fail=()=>{throw new Error('桌面收件备份格式或完整性校验失败。');};
  if(!value||value.format!==DESKTOP_INBOX_BACKUP_FORMAT||value.formatVersion!==1||!Array.isArray(value.records)||!Array.isArray(value.leases)
    ||value.recordCount!==value.records.length||value.leaseCount!==value.leases.length)fail();
  for(const record of value.records) {
    if(!record||typeof record!=='object'||!businessKinds.has(record.kind)||record.envelope?.__inboxArchive)fail();
  }
  for(const lease of value.leases)if(!lease||lease.kind!=='task-heartbeat'||typeof lease.taskId!=='string')fail();
  return value;
}
