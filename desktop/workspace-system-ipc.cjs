const { isAllowedWorkspaceUrl } = require('./workspace-navigation.cjs');
const { createBackupSaver } = require('./workspace-backup.cjs');

function isTrustedWorkspaceSender(event, contents, devUrl) {
  return Boolean(contents && !contents.isDestroyed() && event.sender === contents
    && event.senderFrame === contents.mainFrame
    && isAllowedWorkspaceUrl(event.senderFrame?.url, devUrl));
}

function registerWorkspaceSystemIpc({ ipcMain, getContents, getWindow, getLifecycle, dialog, devUrl, operations }) {
  let activeEvent;
  const trusted = event => isTrustedWorkspaceSender(event, getContents(), devUrl);
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
