import {getDesktopRuntime,isDesktopRuntime} from './desktopRuntime';
import {serializeWorkspaceBackup} from './workspaceBackupDownload';
export async function callWorkspaceSafety(method,input,{optional=false}={}) {
  const runtime=getDesktopRuntime();
  if(!isDesktopRuntime(runtime)||typeof runtime[method]!=='function') {
    if(optional)return null;
    throw new Error('完整备份保护需要新版桌面工作站，请升级并重启后重试。');
  }
  const receipt=await runtime[method](input);
  if(receipt?.ok===false||receipt?.status==='failed')throw new Error(receipt.error||'完整备份或恢复未完成。');
  return receipt;
}
export async function saveClearBackup(payload) {
  const {json}=serializeWorkspaceBackup(payload);
  const receipt=await callWorkspaceSafety('saveClearBackup',{fileName:'before-clear.json',json});
  if(receipt?.status!=='saved'||!receipt.backupToken||!receipt.filePath||!receipt.sha256)throw new Error('清空前备份未成功保存并校验，未执行清空。');
  return receipt;
}
export async function prepareDesktopRestore(snapshot,currentPayload) {
  const {json}=serializeWorkspaceBackup(currentPayload);
  const receipt=await callWorkspaceSafety('prepareInboxRestore',{snapshot,currentWorkspace:{fileName:'before-restore.json',json}});
  if(!receipt?.ok||!receipt.id)throw new Error('桌面恢复保护未就绪，未恢复数据。');
  return receipt;
}
