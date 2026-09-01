export function getDesktopRuntime() {
  return typeof window === "object" ? window.shopeersDesktopRuntime ?? null : null;
}

export function isDesktopRuntime(runtime = getDesktopRuntime()) {
  return runtime?.desktop === true;
}

export function getErpAssistantRouteTarget(runtime = getDesktopRuntime()) {
  return isDesktopRuntime(runtime) ? "/profit" : null;
}

export function getRuntimeEnvironmentCopy(runtime = getDesktopRuntime()) {
  if (isDesktopRuntime(runtime)) {
    return {
      application: `v${runtime?.version || "未知"}`,
      environment: "桌面工作站",
      storage: "桌面本机 IndexedDB",
      diagnosticsDescription: "查看桌面工作站的数据状态、内置扩展连接、存储占用、备份记录与近期操作。",
    };
  }
  return {
    application: "浏览器环境",
    environment: "浏览器环境",
    storage: "浏览器 IndexedDB",
    diagnosticsDescription: "查看当前浏览器工作区的数据状态、扩展连接、存储占用、备份记录与近期操作。",
  };
}
