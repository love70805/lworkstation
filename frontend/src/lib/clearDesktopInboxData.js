import { getDesktopRuntime, isDesktopRuntime } from './desktopRuntime';

export async function clearDesktopInboxData(runtime = getDesktopRuntime()) {
  if (!isDesktopRuntime(runtime)) return;
  if (typeof runtime.clearInboxData !== 'function') {
    throw new Error('桌面收件清理接口尚未就绪，请升级并重启工作站后重试。');
  }
  const result = await runtime.clearInboxData();
  if (result?.ok !== true) {
    throw new Error(result?.error || 'ERP 历史任务及回传记录未清空，请重试。');
  }
  return result;
}
