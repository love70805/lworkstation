const pending = new Set();
let resetting = false;

// A confirmed reset must drain deliveries already saving data and prevent new
// polling/recovery cycles until both desktop storage and IndexedDB are cleared.
export function runWorkspaceBackgroundTask(task) {
  if (resetting) return Promise.resolve(null);
  const operation = Promise.resolve().then(task);
  pending.add(operation);
  return operation.finally(() => pending.delete(operation));
}

export async function withWorkspaceReset(reset) {
  if (resetting) throw new Error("本机数据正在清空，请等待完成。");
  resetting = true;
  try {
    await Promise.allSettled([...pending]);
    return await reset();
  } finally {
    resetting = false;
  }
}
