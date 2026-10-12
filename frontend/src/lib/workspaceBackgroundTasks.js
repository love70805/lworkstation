const pending = new Set();
let resetting = false;
let recoveryError = '';
const recoveryListeners = new Set();
const resumeListeners = new Set();
const notifyResumed = () => { if (!resetting && !recoveryError) for (const listener of resumeListeners) listener(); };
export function subscribeWorkspaceResumed(listener) {
  resumeListeners.add(listener);
  return () => resumeListeners.delete(listener);
}

export const getWorkspaceRecoveryError = () => recoveryError;
export function subscribeWorkspaceRecovery(listener) {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}
export function setWorkspaceRecoveryError(message = '') {
  recoveryError = message;
  for (const listener of recoveryListeners) listener();
  if (!message) notifyResumed();
}

// A confirmed reset must drain deliveries already saving data and prevent new
// polling/recovery cycles until both desktop storage and IndexedDB are cleared.
export function runWorkspaceBackgroundTask(task) {
  if (resetting || recoveryError) return Promise.resolve(null);
  const operation = Promise.resolve().then(task);
  pending.add(operation);
  return operation.finally(() => pending.delete(operation));
}

export async function withWorkspaceReset(reset) {
  if (resetting) throw new Error("本机数据正在恢复或清空，请等待完成。");
  resetting = true;
  try {
    await Promise.allSettled([...pending]);
    return await reset();
  } finally {
    resetting = false;
    notifyResumed();
  }
}
