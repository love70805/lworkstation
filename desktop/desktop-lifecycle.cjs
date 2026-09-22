const { loadCloseBehavior, saveCloseBehavior } = require('./desktop-preferences.cjs');

function createDesktopLifecycle({ app, window, Tray, Menu, icon, userDataPath, onHide = () => {}, onError = () => {}, onChanged = () => {} }) {
  let tray;
  let quitting = false;
  let notified = false;
  let closeBehavior = loadCloseBehavior({ userDataPath });
  const restore = () => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  };
  const beginQuit = () => { quitting = true; };
  const quit = () => { beginQuit(); app.quit(); };
  function updateTray() {
    tray?.setToolTip(closeBehavior === 'tray' ? 'Lworkstation · 关闭窗口后继续后台收件' : 'Lworkstation · 关闭窗口时退出应用');
    tray?.setContextMenu(menu());
  }
  function setCloseBehavior(value) {
    if (!['tray', 'quit'].includes(value)) throw Error('关闭行为无效。');
    closeBehavior = saveCloseBehavior({ userDataPath, behavior: value });
    updateTray();
    onChanged({ closeBehavior, trayAvailable: Boolean(tray && !tray.isDestroyed()) });
  }
  function menu() {
    return Menu.buildFromTemplate([
      { label: '打开 Lworkstation', click: restore },
      { type: 'separator' },
      { label: '关闭窗口时', submenu: ['tray', 'quit'].map(value => ({
        label: value === 'tray' ? '隐藏到托盘（继续后台收件）' : '退出应用', type: 'radio', checked: closeBehavior === value,
        click: () => {
          try { setCloseBehavior(value); }
          catch (error) { onError(`关闭偏好未保存：${error.message}`); }
        },
      })) },
      { type: 'separator' },
      { label: '退出 Lworkstation', click: quit },
    ]);
  }
  try {
    tray = new Tray(icon);
    updateTray();
    tray.on('click', restore);
    tray.on('double-click', restore);
  } catch (error) {
    tray?.destroy(); tray = null;
    onError(`系统托盘不可用，关闭窗口将退出应用：${error.message}`);
  }
  window.on('close', event => {
    if (quitting || closeBehavior === 'quit' || !tray || tray.isDestroyed()) { beginQuit(); return; }
    event.preventDefault();
    onHide(); window.hide();
    if (!notified) {
      notified = true;
      try { tray.displayBalloon({ title: 'Lworkstation 仍在后台运行', content: '点击托盘图标恢复窗口；右键菜单可退出或修改关闭行为。', noSound: true }); } catch {}
    }
  });
  window.on('query-session-end', beginQuit);
  window.on('session-end', quit);
  app.on('before-quit', beginQuit);
  return {
    restore, beginQuit, quit, setCloseBehavior,
    getState: () => ({ quitting, closeBehavior, trayAvailable: Boolean(tray && !tray.isDestroyed()) }),
    dispose: () => { beginQuit(); if (tray && !tray.isDestroyed()) tray.destroy(); tray = null; },
  };
}

function createStartupState({ changed, timeoutMs = 30000 }) {
  let timer;
  let state = { status: 'loading', message: '正在启动工作站…' };
  const update = next => { state = next; changed(state); };
  const fail = message => { clearTimeout(timer); update({ status: 'error', message }); };
  const start = () => {
    clearTimeout(timer); update({ status: 'loading', message: '正在启动工作站…' });
    timer = setTimeout(() => fail('工作站启动超时，请重试或退出。'), timeoutMs);
  };
  return { start, fail, ready: () => { clearTimeout(timer); update({ status: 'ready', message: '' }); }, getState: () => state, dispose: () => clearTimeout(timer) };
}
module.exports = { createDesktopLifecycle, createStartupState };
