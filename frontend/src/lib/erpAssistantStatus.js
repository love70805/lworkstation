export function getErpAssistantStatusRequests() {
  return {
    requests: { route: "/erp/v1/requests", method: "GET", query: { includeHistory: true } },
    extensionStatus: { route: "/erp/v1/extension-status", method: "GET", query: {} },
  };
}
