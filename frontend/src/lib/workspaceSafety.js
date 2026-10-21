import {getDesktopRuntime,isDesktopRuntime} from './desktopRuntime';
import {serializeWorkspaceBackup} from './workspaceBackupDownload';
export async function callWorkspaceSafety(method,input,{optional=false}={}) {
  const runtime=getDesktopRuntime();
  if(!isDesktopRuntime(runtime)||typeof runtime[method]!=='function') {
    if(optional)return null;
    throw new Error('完整备份保护需要新版桌面工作站，请升级并重启后重试。');
  }
  const receipt=await runtime[method](input);
  if(receipt?.ok!==true)throw new Error(receipt?.error||'完整备份或恢复未完成。');
  return receipt;
}
export async function prepareDesktopRestore(snapshot,currentPayload,targetPayload) {
  const {json}=serializeWorkspaceBackup(currentPayload);
  const targetWorkspace={fileName:'restore-target.json',json:serializeWorkspaceBackup({...targetPayload,desktopInbox:undefined}).json};
  const receipt=await callWorkspaceSafety('prepareInboxRestore',{snapshot,currentWorkspace:{fileName:'before-restore.json',json},targetWorkspace});
  if(!receipt?.ok||!receipt.id)throw new Error('桌面恢复保护未就绪，未恢复数据。');
  return receipt;
}
