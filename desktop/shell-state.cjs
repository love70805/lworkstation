(function exposeShellState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LworkstationShellState = api;
})(typeof globalThis === "undefined" ? this : globalThis, () => {
  function errorMessage(inbox = {}, flow = {}) {
    return flow.message || inbox.latestTransportError?.message || inbox.message || "未知错误";
  }

  function classifyErpState(inbox = {}, flow = {}) {
    const failure = ["stopped", "conflict", "error"].includes(inbox.status)
      || flow.status === "service_error";
    if (failure) {
      return { tone: "danger", label: "ERP 异常", aria: `ERP 通道异常：${errorMessage(inbox, flow)}` };
    }

    if (inbox.extensionLoadState === 'deferred' && inbox.pageStatus === 'idle') return { tone: 'muted', label: 'ERP 待使用', aria: 'ERP 尚未打开，首次进入时加载助手' };

    if (['error', 'failed'].includes(inbox.extensionLoadState) || inbox.pageStatus === 'error') return { tone: 'danger', label: '助手异常', aria: 'ERP 助手不可用，请重新加载助手' };
    if (inbox.status !== 'online' || ['loading', 'starting', 'restarting'].includes(inbox.extensionLoadState) || inbox.pageStatus === 'loading') return { tone: 'warning', label: '等待连接', aria: 'ERP 助手等待初始化与通信' };
    const extension = inbox.latestExtension;
    if (!extension || extension.context !== 'extension-isolated' || extension.handshakeVersion !== 1
      || (inbox.workspaceId && extension.workspaceId !== inbox.workspaceId)) return { tone: 'warning', label: '等待握手', aria: 'ERP 助手等待真实通信确认' };
    const age = Date.now() - Date.parse(extension.lastSeenAt || '');
    if (Number(inbox.navigationStartedAt) > Date.parse(extension.lastSeenAt || '')) return { tone: 'warning', label: '等待握手', aria: 'ERP 页面已切换，等待助手重新确认通信' };
    if (!Number.isFinite(age) || age < -5000 || age > 45000 || extension.ready !== true) return { tone: 'danger', label: '连接失效', aria: 'ERP 助手通信已失效，正在等待恢复' };
    if (extension.sessionState === 'login_required' || extension.pageState === 'login_required') return { tone: 'warning', label: '需要登录', aria: 'ERP 助手已连接，请先登录 ERP' };
    if (extension.sessionState !== 'authenticated') return { tone: 'warning', label: '登录待确认', aria: 'ERP 助手已连接，登录状态待确认' };
    return { tone: 'success', label: '助手就绪', aria: extension.queryAvailable ? 'ERP 助手通信就绪，采购查询可用' : 'ERP 助手通信就绪，采集前请在采购管理查询' };
  }

  function getAddressPresentation(activeTab, activeTabState = {}) {
    return {
      readOnly: true,
      value: activeTab === "workspace" ? "内部工作站" : (activeTabState.url || ""),
    };
  }

  function getSurfacePresentation(state = {}) {
    if (!state.activeTab || state.activeTab === 'workspace') return { title: 'Lworkstation', retryLabel: '重新加载工作站', ...state.startup };
    const tab = state.tabs?.[state.activeTab] || {};
    const status = tab.status === 'ready' ? 'ready' : tab.status === 'error' ? 'error' : 'loading';
    return { title: tab.title || state.activeTab, retryLabel: '重新加载页面', status,
      message: status === 'error' ? (tab.error || '页面无法打开，请重试。') : `正在加载 ${tab.title || state.activeTab} 页面与助手…` };
  }

  return {
    classifyErpState,
    getAddressPresentation,
    getSurfacePresentation,
  };
});
