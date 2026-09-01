const ALLOWED_ROUTE_PREFIXES = ["/erp/v1/", "/selection/v1/"];

let testTransport = null;

function transportError(message, { code = "INBOX_TRANSPORT_UNAVAILABLE", status = 0 } = {}) {
  return Object.assign(new Error(message), { code, status });
}

function normalizeRequest({ route, method = "GET", query = null, body = null } = {}) {
  const normalizedRoute = String(route ?? "").trim();
  if (!ALLOWED_ROUTE_PREFIXES.some((prefix) => normalizedRoute.startsWith(prefix))) {
    throw transportError("本机收件路由不受支持。", { code: "INVALID_INBOX_ROUTE" });
  }
  const normalizedMethod = String(method ?? "GET").trim().toUpperCase();
  if (!new Set(["GET", "POST"]).has(normalizedMethod)) {
    throw transportError("本机收件方法不受支持。", { code: "INVALID_INBOX_METHOD" });
  }
  return {
    route: normalizedRoute,
    method: normalizedMethod,
    query: query && typeof query === "object" && !Array.isArray(query) ? query : {},
    body: body == null ? null : body,
  };
}

function activeTransport() {
  if (typeof testTransport === "function") return testTransport;
  if (typeof window === "object" && typeof window.shopeersDesktopRuntime?.requestInbox === "function") {
    return (request) => window.shopeersDesktopRuntime.requestInbox(request);
  }
  return null;
}

async function waitForTransport(operation, signal) {
  if (!signal) return operation;
  if (signal.aborted) throw signal.reason ?? new DOMException("请求已取消。", "AbortError");
  return Promise.race([
    operation,
    new Promise((_, reject) => signal.addEventListener(
      "abort",
      () => reject(signal.reason ?? new DOMException("请求已取消。", "AbortError")),
      { once: true },
    )),
  ]);
}

export async function requestInbox(request, { signal } = {}) {
  const transport = activeTransport();
  if (!transport) {
    throw transportError("当前环境未提供受控本机收件接口。请使用 Shopeers 桌面版。", {
      code: "INBOX_TRANSPORT_UNAVAILABLE",
    });
  }
  const result = await waitForTransport(Promise.resolve(transport(normalizeRequest(request))), signal);
  if (!result || typeof result !== "object") {
    throw transportError("本机收件接口返回了无效响应。", { code: "INVALID_INBOX_RESPONSE" });
  }
  const status = Number(result.status);
  if (!Number.isFinite(status)) {
    throw transportError("本机收件接口响应缺少 HTTP 状态。", { code: "INVALID_INBOX_RESPONSE" });
  }
  const payload = Object.hasOwn(result, "body") ? result.body : result.payload;
  if (status < 200 || status >= 300) {
    throw transportError(String(payload?.message ?? payload?.error ?? `本机收件服务返回 HTTP ${status}。`), {
      code: String(payload?.error ?? payload?.code ?? "INBOX_REQUEST_FAILED"),
      status: Number.isFinite(status) ? status : 0,
    });
  }
  return payload;
}

export function setInboxTransportForTests(transport) {
  testTransport = typeof transport === "function" ? transport : null;
}
