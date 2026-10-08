// Keep opened pages alive for drafts and background collection; defer only
// pages the user has never opened. One promise owns each initialization.
function createRemoteViewLoader({ getView, build, discard, canCreate }) {
  const pending = new Map();
  let stopped = false;
  function ensure(tabId) {
    if (stopped || !canCreate()) return Promise.reject(new Error('工作站正在退出，无法打开页面。'));
    if (pending.has(tabId)) return pending.get(tabId);
    const existing = getView(tabId);
    if (existing && !existing.webContents.isDestroyed()) return Promise.resolve(existing);
    const task = Promise.resolve().then(() => {
      if (stopped || !canCreate()) throw new Error('工作站正在退出，无法打开页面。');
      return build(tabId);
    }).then(view => {
      if (stopped || !canCreate()) {
        throw new Error('工作站正在退出，无法打开页面。');
      }
      return view;
    }).catch(error => {
      discard(tabId);
      throw error;
    }).finally(() => pending.delete(tabId));
    pending.set(tabId, task);
    return task;
  }
  return { ensure, isPending: tabId => pending.has(tabId), stop: () => { stopped = true; } };
}
module.exports = { createRemoteViewLoader };
