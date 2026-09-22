export function serializeWorkspaceBackup(payload) {
  const json = JSON.stringify(payload, null, 2);
  return {
    json,
    sizeBytes: new Blob([json]).size,
  };
}

export async function downloadWorkspaceBackup(payload, { prefix = "shopeers-backup" } = {}) {
  const { json, sizeBytes } = serializeWorkspaceBackup(payload);
  const generatedAt = new Date(payload.generatedAt ?? Date.now());
  const date = [
    generatedAt.getFullYear(),
    String(generatedAt.getMonth() + 1).padStart(2, "0"),
    String(generatedAt.getDate()).padStart(2, "0"),
  ].join("-");
  const fileName = `${prefix}-${date}.json`;
  const runtime = typeof window !== 'undefined' ? window.shopeersDesktopRuntime : null;
  if (runtime?.desktop) {
    if (!runtime.saveBackup) return { status: 'failed', error: '当前桌面尚不支持保存确认，请更新并重启后重试。' };
    try {
      const receipt = await runtime.saveBackup({ fileName, json });
      if (!['saved', 'canceled', 'failed'].includes(receipt?.status)) return { status: 'failed', error: '未取得有效的文件保存结果。' };
      return receipt;
    } catch (error) { return { status: 'failed', error: error.message || '备份保存失败。' }; }
  }
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { status: 'requested', fileName, sizeBytes };
}

export function requireSavedWorkspaceBackup(receipt) {
  if (receipt?.status === 'saved') return receipt;
  if (receipt?.status === 'canceled') throw new Error('已取消保存回滚备份，未执行恢复。');
  if (receipt?.status === 'requested') throw new Error('浏览器无法确认回滚备份已保存，未执行恢复。请在桌面工作站恢复，或确认已有独立备份后关闭回滚保护。');
  throw new Error(receipt?.error || '回滚备份未保存，未执行恢复。');
}

export function backupSaveMessage(receipt) {
  if (receipt?.status === 'canceled') return '已取消保存备份。';
  if (receipt?.status === 'requested') return `已请求下载 ${receipt.fileName}，请确认文件保存完成；本次未登记为已保存备份。`;
  if (receipt?.status === 'failed') throw new Error(receipt.error || '备份保存失败。');
  return null;
}
