const { isAllowedWorkspaceUrl } = require('./workspace-navigation.cjs');
const { createBackupSaver } = require('./workspace-backup.cjs');
const { createWorkspaceSafety } = require('./workspace-safety.cjs');

function isTrustedWorkspaceSender(event, contents, devUrl) {
  return Boolean(contents && !contents.isDestroyed() && event.sender === contents
    && event.senderFrame === contents.mainFrame
    && isAllowedWorkspaceUrl(event.senderFrame?.url, devUrl));
}

function registerWorkspaceSystemIpc({ ipcMain, getContents, getWindow, getLifecycle, dialog, devUrl, operations, backupDirectory, getInboxService }) {
  let activeEvent;
  const trusted = event => isTrustedWorkspaceSender(event, getContents(), devUrl);
  let safetyEvent;
  const safety=backupDirectory&&getInboxService?createWorkspaceSafety({directory:backupDirectory,getInboxService,operations,isTrusted:()=>trusted(safetyEvent||{})}):null;
  async function runSafety(event,method,input) {
    if(!trusted(event))return {ok:false,status:'failed',error:'无效的工作站请求。'};
    if(safetyEvent)return {ok:false,status:'failed',error:'已有本机备份或恢复正在进行。'};
    safetyEvent=event;
    try {
      if(!safety)throw new Error('完整备份接口尚未就绪，请升级并重启工作站。');
      const result=await safety[method](input);
      if(!trusted(event))throw Object.assign(new Error('工作站已离开当前页面，请重新打开并检查操作结果。'),{clearStarted:method==='clear'});
      return result;
    }catch(e){return {ok:false,status:'failed',error:e.message,clearStarted:e.clearStarted===true};}
    finally{safetyEvent=null;}
  }
  ipcMain.handle('workspace:clear-inbox-data', async (event,input) => {
    if (!trusted(event)) return { ok: false, error: '无效的工作站请求。' };
    return runSafety(event,'clear',input);
  });
  for(const [channel,method] of Object.entries({'prepare-inbox-restore':'prepareRestore','recover-inbox-restore':'recoverRestore','finish-inbox-restore':'finishRestore'})) {
    ipcMain.handle(`workspace:${channel}`,async(event,input)=>{
      return runSafety(event,method,input);
    });
  }
  const save = createBackupSaver({
    showSaveDialog: options => dialog.showSaveDialog(getWindow(), options),
    isTrusted: () => trusted(activeEvent || {}), operations,
  });
  ipcMain.handle('workspace:save-backup', async (event, input) => {
    if (!trusted(event)) return { status: 'failed', error: '无效的工作站请求。' };
    // A single sender can have only one active native save dialog.
    if (activeEvent) return { status: 'failed', error: '已有备份正在保存，请完成后再试。' };
    activeEvent = event;
    try { return await save(input); } finally { activeEvent = null; }
  });
  ipcMain.handle('workspace:get-close-behavior', event => {
    if (!trusted(event)) return { ok: false, error: '无效的工作站请求。' };
    const state = getLifecycle()?.getState();
    return state ? { ok: true, closeBehavior: state.closeBehavior, trayAvailable: state.trayAvailable } : { ok: false, error: '桌面设置尚未就绪。' };
  });
  ipcMain.handle('workspace:set-close-behavior', (event, behavior) => {
    if (!trusted(event)) return { ok: false, error: '无效的工作站请求。' };
    try {
      const lifecycle = getLifecycle();
      if (!lifecycle) throw Error('桌面设置尚未就绪。');
      lifecycle.setCloseBehavior(behavior);
      const state = lifecycle.getState();
      return { ok: true, closeBehavior: state.closeBehavior, trayAvailable: state.trayAvailable };
    } catch (error) { return { ok: false, error: error.message }; }
  });
}

module.exports = { isTrustedWorkspaceSender, registerWorkspaceSystemIpc };
