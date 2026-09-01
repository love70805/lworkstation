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
      || ["delivery_error", "service_error"].includes(flow.status)
      || flow.tone === "danger";
    if (failure) {
      return { tone: "danger", label: "ERP 异常", aria: `ERP 通道异常：${errorMessage(inbox, flow)}` };
    }

    const hasRequest = flow.status === "request_registered";
    const active = ["starting", "restarting"].includes(inbox.status)
      || ["request_registered", "batch_received", "workspace_received", "service_starting"].includes(flow.status)
      || ["warning", "info"].includes(flow.tone)
      || flow.evidenceStatus === "legacy_partial"
      || inbox.latestBatch?.evidenceStatus === "legacy_partial"
      || Number(inbox.activeRequestCount || 0) > 0
      || Number(inbox.pendingBatchCount || 0) > 0;
    if (active) {
      const label = hasRequest ? "有请求" : "处理中";
      return { tone: "warning", label, aria: `ERP 通道${label}` };
    }

    const healthy = inbox.status === "online"
      && flow.status === "idle"
      && flow.tone === "success";
    if (healthy) return { tone: "success", label: "", aria: "ERP 通道正常" };

    return { tone: "warning", label: "处理中", aria: "ERP 通道处理中" };
  }

  function getAddressPresentation(activeTab, activeTabState = {}) {
    return {
      readOnly: true,
      value: activeTab === "workspace" ? "内部工作站" : (activeTabState.url || ""),
    };
  }

  function getPopoverPresentation(inbox = {}, flow = {}) {
    const state = classifyErpState(inbox, flow);
    const error = state.tone === "danger" ? errorMessage(inbox, flow) : "";
    return {
      status: error ? "" : (state.label || "通道正常"),
      error,
      showStatus: !error,
      showError: Boolean(error),
    };
  }

  function shouldReturnFocusOnPopoverClose(reason) {
    return ["button", "outside", "escape"].includes(reason);
  }

  return {
    classifyErpState,
    getAddressPresentation,
    getPopoverPresentation,
    shouldReturnFocusOnPopoverClose,
  };
});
