const ALLOWED_METHODS = new Set(["GET", "POST"]);
const INBOX_ROUTE_METHODS = new Map([
  ["/erp/v1/status", new Set(["GET"])],
  ["/erp/v1/requests", new Set(["GET", "POST"])],
  ["/erp/v1/cost-batches", new Set(["GET", "POST"])],
  ["/erp/v1/cost-results", new Set(["POST"])],
  ["/erp/v1/extension-status", new Set(["GET", "POST"])],
  ["/selection/v1/status", new Set(["GET"])],
  ["/selection/v1/context", new Set(["GET", "POST"])],
  ["/selection/v1/captures", new Set(["GET", "POST"])],
  ["/selection/v1/captures/ack", new Set(["POST"])],
  ["/selection/v1/extension-status", new Set(["GET", "POST"])],
]);
const ALLOWED_ROUTE_PREFIXES = ["/erp/v1/", "/selection/v1/"];
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_QUERY_VALUE_LENGTH = 2048;

function ipcError(message, status = 400, code = "INVALID_INBOX_REQUEST") {
  return Object.assign(new Error(message), { status, code });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function normalizeRoute(route) {
  const value = String(route ?? "").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[?#]/.test(value)
    || /^[a-z][a-z\d+.-]*:/i.test(value) || value.includes("\\")) {
    throw ipcError("本机收件路由必须是相对路径。", 400, "INVALID_INBOX_ROUTE");
  }
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw ipcError("本机收件路由编码无效。", 400, "INVALID_INBOX_ROUTE"); }
  const segments = decoded.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw ipcError("本机收件路由不允许路径穿越。", 400, "INVALID_INBOX_ROUTE");
  }
  if (!ALLOWED_ROUTE_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    throw ipcError("本机收件路由不受支持。", 400, "INVALID_INBOX_ROUTE");
  }
  return value;
}

function normalizeQuery(query) {
  if (query == null) return {};
  if (!isPlainObject(query)) throw ipcError("本机收件查询参数必须是对象。", 400, "INVALID_INBOX_QUERY");
  const normalized = {};
  for (const [key, value] of Object.entries(query)) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) throw ipcError("本机收件查询参数名无效。", 400, "INVALID_INBOX_QUERY");
    if (value == null) continue;
    if (!["string", "number", "boolean"].includes(typeof value)
      || (typeof value === "number" && !Number.isFinite(value))) {
      throw ipcError("本机收件查询参数值无效。", 400, "INVALID_INBOX_QUERY");
    }
    const text = String(value);
    if (text.length > MAX_QUERY_VALUE_LENGTH) throw ipcError("本机收件查询参数过长。", 413, "INBOX_QUERY_TOO_LARGE");
    normalized[key] = text;
  }
  return normalized;
}

function normalizeBody(body, method) {
  if (body == null) return null;
  if (method === "GET") throw ipcError("GET 请求不能携带请求体。", 400, "INVALID_INBOX_BODY");
  let serialized;
  try { serialized = JSON.stringify(body); } catch { throw ipcError("本机收件请求体必须是 JSON。", 400, "INVALID_INBOX_BODY"); }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_BODY_BYTES) {
    throw ipcError("本机收件请求体过大或不是 JSON。", 413, "INBOX_BODY_TOO_LARGE");
  }
  return { value: body, serialized };
}

function normalizeInboxRequest(input = {}) {
  if (!isPlainObject(input)) throw ipcError("本机收件请求格式无效。", 400, "INVALID_INBOX_REQUEST");
  const route = normalizeRoute(input.route);
  const method = String(input.method ?? "GET").trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw ipcError("本机收件方法不受支持。", 405, "INVALID_INBOX_METHOD");
  const query = normalizeQuery(input.query);
  const body = normalizeBody(input.body, method);
  if (!INBOX_ROUTE_METHODS.get(route)?.has(method)) {
    throw ipcError("本机收件路由与方法组合不受支持。", 405, "INVALID_INBOX_OPERATION");
  }
  return { route, method, query, body };
}

function buildInboxUrl(port, request) {
  const normalized = request && Object.hasOwn(request, "body") && request.body && Object.hasOwn(request.body, "serialized")
    ? request
    : normalizeInboxRequest(request);
  const url = new URL(`http://127.0.0.1:${Number(port)}`);
  url.pathname = normalized.route;
  for (const [key, value] of Object.entries(normalized.query || {})) url.searchParams.set(key, value);
  return url;
}

function normalizeWorkspaceContext(body) {
  if (!isPlainObject(body)) throw ipcError("工作区上下文格式无效。", 400, "INVALID_WORKSPACE_CONTEXT");
  const workspaceId = String(body.workspaceId ?? "").trim();
  const memberId = String(body.memberId ?? "").trim();
  const visibility = body.visibility === "private" ? "private" : body.visibility === "workspace" ? "workspace" : "";
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(workspaceId) || !/^[A-Za-z0-9._:-]{1,160}$/.test(memberId) || !visibility) {
    throw ipcError("工作区上下文缺少有效工作区、成员或可见性。", 400, "INVALID_WORKSPACE_CONTEXT");
  }
  return { workspaceId, memberId, visibility };
}

function enforceWorkspaceContext(request, committed) {
  const protectedRoute = request.route.includes("/requests")
    || request.route.includes("/cost-batches")
    || request.route.includes("/cost-results")
    || request.route.includes("/captures");
  if (!protectedRoute) return request;
  if (!committed?.workspaceId || !committed?.memberId) {
    throw ipcError("工作区上下文尚未提交，已拒绝本机收件请求。", 409, "WORKSPACE_CONTEXT_REQUIRED");
  }
  const source = request.method === "GET" ? request.query : request.body?.value;
  const candidates = [source?.workspaceId, source?.batch?.workspaceId, source?.request?.workspaceId, source?.result?.workspaceId]
    .filter((value) => value != null && String(value).trim());
  if (candidates.some((value) => String(value).trim() !== committed.workspaceId)) {
    throw ipcError("请求工作区与桌面已提交上下文不匹配。", 403, "WORKSPACE_CONTEXT_MISMATCH");
  }
  const memberCandidates = [source?.memberId, source?.ownerId, source?.batch?.memberId, source?.request?.memberId]
    .filter((value) => value != null && String(value).trim());
  if (memberCandidates.some((value) => String(value).trim() !== committed.memberId)) {
    throw ipcError("请求成员与桌面已提交上下文不匹配。", 403, "WORKSPACE_MEMBER_MISMATCH");
  }
  if (request.method === "GET") {
    return { ...request, query: { ...request.query, workspaceId: committed.workspaceId, ...(request.route.includes("/captures") ? { memberId: committed.memberId } : {}) } };
  }
  const body = request.body?.value && typeof request.body.value === "object" ? { ...request.body.value } : request.body?.value;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    body.workspaceId = committed.workspaceId;
    body.memberId = committed.memberId;
    body.ownerId = committed.memberId;
    for (const key of ["batch", "request", "result"]) {
      if (body[key] && typeof body[key] === "object") {
        body[key] = { ...body[key], workspaceId: committed.workspaceId, memberId: committed.memberId };
      }
    }
  }
  const serialized = body == null ? null : JSON.stringify(body);
  return { ...request, body: body == null ? request.body : { value: body, serialized } };
}

module.exports = {
  ALLOWED_METHODS,
  ALLOWED_ROUTE_PREFIXES,
  INBOX_ROUTE_METHODS,
  MAX_BODY_BYTES,
  buildInboxUrl,
  enforceWorkspaceContext,
  normalizeInboxRequest,
  normalizeWorkspaceContext,
};
