const { randomUUID } = require('node:crypto');

// Probe only on foreground entry. Never reload a healthy page or discard a form
// because a window was hidden/minimized. A late reply can recover the same page.
function createWorkspaceRecovery({ getContents, isForeground, onFailure, onRecovered = () => {}, timeoutMs = 8000,
  schedule = setTimeout, cancel = clearTimeout }) {
  let pending = null;
  let failed = false;
  function fail(message) { failed = true; onFailure(message); }
  function pause() {
    if (pending) cancel(pending.timer);
    pending = null;
  }
  function check() {
    if (!isForeground()) { pause(); return; }
    const contents = getContents();
    if (!contents || contents.isDestroyed() || contents.isCrashed()) {
      pause(); fail('工作站进程已退出，请重试恢复页面。'); return;
    }
    if (pending?.contents === contents) return;
    pause();
    const probe = { contents, token: randomUUID(), timedOut: false };
    pending = probe;
    probe.timer = schedule(() => {
      if (pending !== probe) return;
      if (!isForeground() || getContents() !== contents) { pause(); return; }
      probe.timedOut = true;
      fail('工作站暂未响应。可等待恢复，或点击重试重新加载；重试可能丢失尚未保存的输入。');
    }, timeoutMs);
    probe.timer?.unref?.();
    try {
      contents.invalidate();
      contents.send('workspace:probe', probe.token);
    } catch {
      pause(); fail('工作站恢复失败，请重试恢复页面。');
    }
  }
  function acknowledge(sender, payload) {
    const { token, ready } = payload || {};
    const probe = pending;
    if (!probe || sender !== probe.contents || sender !== getContents() || token !== probe.token) return false;
    pause();
    if (!isForeground()) return false;
    if (ready !== true) fail('工作站页面显示异常，请重试恢复页面；重试可能丢失尚未保存的输入。');
    else {
      if (!sender.isDestroyed()) sender.invalidate();
      if (failed) { failed = false; onRecovered(); }
    }
    return true;
  }
  function reset() { pause(); failed = false; }
  return { check, acknowledge, pause, reset, needsRecovery: () => failed, dispose: reset };
}
module.exports = { createWorkspaceRecovery };
