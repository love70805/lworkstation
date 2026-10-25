const { spawn } = require("node:child_process");
const http = require("node:http");
const crypto = require("node:crypto");
const { buildInboxUrl, normalizeInboxRequest } = require('./inbox-ipc.cjs');

const DEFAULT_PORT = 8790;
const MAX_RESTARTS = 3;
// Match the public HTTP service's business-body limit, independently of IPC.
const EXTENSION_MAX_BODY_BYTES = 25 * 1024 * 1024;
const extensionSessions = new WeakSet();

function extensionInboxUrl(url) {
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
    && (url.pathname.startsWith('/erp/v1/') || url.pathname.startsWith('/selection/v1/'));
}

function inboxHttpError(error) {
  return new Response(JSON.stringify({ error: error.code || 'INBOX_REQUEST_FAILED', message: error.message }),
    { status: error.status || 502, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function installExtensionInboxTransport(targetSession, getController) {
  if (extensionSessions.has(targetSession)) return;
  // Install before loading the extension: its service worker may immediately
  // use retained storage. Chromium must never send that bearer to the listener.
  targetSession.protocol.handle('http', async request => {
    if (!extensionInboxUrl(new URL(request.url))) return targetSession.fetch(request, { bypassCustomProtocolHandlers: true });
    try {
      const controller = getController();
      if (!controller) throw Object.assign(new Error('本机收件服务尚未就绪，请稍后重试。'), { code: 'INBOX_SERVICE_UNAVAILABLE', status: 503 });
      return await controller.requestExtensionInbox(request);
    } catch (error) { return inboxHttpError(error); }
  });
  extensionSessions.add(targetSession);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestJson({ port, path = "/erp/v1/status", timeoutMs = 1200, capability = "", method = "GET", body = null, rawBody, extraHeaders = {}, signal, agent = false, onSocket, maxResponseBytes = Infinity }) {
  return new Promise((resolve) => {
    const headers = { ...extraHeaders, ...(capability ? { authorization: `Bearer ${capability}` } : {}),
      ...(body == null ? {} : { "content-type": "application/json" }) };
    const request = http.request({ host: "127.0.0.1", port, path, method, timeout: timeoutMs, headers, signal, agent }, (response) => {
      const chunks = [];
      let receivedBytes = 0;
      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxResponseBytes) {
          resolve({ reachable: false, error: new Error('收件身份响应过大。') });
          response.destroy(); request.destroy(); return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const rawBody = Buffer.concat(chunks);
        let payload = null;
        try { payload = JSON.parse(rawBody.toString("utf8")); } catch { /* identity checked below */ }
        resolve({ reachable: true, statusCode: response.statusCode, payload, rawBody, headers: response.headers });
      });
      response.on('error', error => resolve({ reachable: false, error }));
      response.on('aborted', () => resolve({ reachable: false, error: new Error('收件响应已中断。') }));
    });
    if (onSocket) request.on('socket', socket => {
      try { onSocket(socket); } catch (error) { request.destroy(error); }
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", (error) => resolve({ reachable: false, error }));
    request.end(rawBody ?? (body == null ? undefined : JSON.stringify(body)));
  });
}

function flowFromStatus(payload) {
  const latestError = payload?.latestTransportError;
  if (latestError) {
    return {
      status: "delivery_error",
      tone: "danger",
      label: "回传失败",
      message: latestError.message || "ERP 回传未被收件服务接受，可在 ERP 页面重新投递。",
    };
  }
  const batch = payload?.latestBatch;
  if (batch?.status === "acknowledged") {
    return {
      status: "workspace_received",
      tone: batch.evidenceStatus === "complete" ? "info" : "warning",
      label: batch.evidenceStatus === "complete" ? "已收妥，查看成本结果" : "旧版预览，待成本核对",
      message: batch.evidenceStatus === "complete"
        ? "v2 原始采购证据已由工作站保存；实际结果以当前有效成本与处理状态为准。"
        : "该批次仅具备 legacy_partial 预览证据，不能由桌面标记为正式成本。",
      requestId: batch.requestId,
      batchId: batch.batchId,
      sourceFormatVersion: batch.sourceFormatVersion,
      evidenceStatus: batch.evidenceStatus,
    };
  }
  if (batch?.status === "pending") {
    return {
      status: "batch_received",
      tone: "info",
      label: "批次已接收，正在解析",
      message: "收件服务已保存 ERP 批次，工作站正在读取并解析。",
      requestId: batch.requestId,
      batchId: batch.batchId,
      sourceFormatVersion: batch.sourceFormatVersion,
      evidenceStatus: batch.evidenceStatus,
    };
  }
  const request = payload?.latestRequest;
  if (request?.status === "registered") {
    return {
      status: "request_registered",
      tone: "info",
      label: "请求已投递，等待 ERP",
      message: "平台 SKC 请求已登记，等待内置 ERP 返回原始采购记录。",
      requestId: request.requestId,
    };
  }
  return { status: "idle", tone: "success", label: "ERP 通道正常", message: "收件服务已就绪，等待 ERP 请求。" };
}

function createInboxServiceController({
  executable,
  scriptPath,
  spoolPath,
  port = DEFAULT_PORT,
  runAsNode = false,
  capability = "",
  onState = () => {},
  pollIntervalMs = 1500,
  restartDelayMs = 800,
  maxRestarts = MAX_RESTARTS,
} = {}) {
  let child = null;
  let pollTimer = null;
  let restartTimer = null;
  let stopping = false;
  let restartCount = 0;
  let refreshPromise = null;
  // This capability never enters the renderer or either extension's storage.
  const resetCapability = crypto.randomBytes(32).toString("base64url");
  const intentionalChildren = new WeakSet();
  const activeRequests = new Map();
  let state = {
    status: "stopped",
    ownership: "none",
    port,
    apiVersion: null,
    restartCount: 0,
    message: "ERP 收件服务尚未启动",
    lastChangedAt: null,
    flow: { status: "idle", tone: "muted", label: "等待 ERP 请求", message: "收件服务尚未启动。" },
  };

  function publish(patch) {
    const next = { ...state, ...patch };
    const flowChanged = JSON.stringify(state.flow) !== JSON.stringify(next.flow);
    if (state.status !== next.status || state.message !== next.message || flowChanged) next.lastChangedAt = new Date().toISOString();
    state = next;
    onState({ ...state });
  }

  function unavailable() {
    return Object.assign(new Error('本机收件服务尚未就绪，请稍后重试。'), { code: 'INBOX_SERVICE_UNAVAILABLE', status: 503 });
  }

  function ownsLiveService(owner = child) {
    return Boolean(!stopping && owner && owner === child && owner.exitCode === null
      && owner.signalCode === null && !owner.killed && !intentionalChildren.has(owner)
      && state.ownership === 'managed');
  }

  function abortOwnedRequests(owner) {
    for (const [controller, requestOwner] of activeRequests) {
      if (requestOwner === owner) controller.abort(unavailable());
    }
  }

  async function authenticatedRequest(options, { requireOnline = true } = {}) {
    const owner = child;
    if (!ownsLiveService(owner) || requireOnline && state.status !== 'online') throw unavailable();
    const controller = new AbortController();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
    activeRequests.set(controller, owner);
    try {
      // A live child may still be starting while another process wins the port.
      // Prove the listener knows the capability before sending it or any body.
      const challenge = crypto.randomBytes(32).toString('hex');
      let verifiedSocket;
      const identity = await requestJson({ port, path: `/erp/v1/identity?challenge=${challenge}`,
        timeoutMs: Math.min(options.timeoutMs || 1200, 5000), maxResponseBytes: 1024, agent, signal: controller.signal,
        onSocket: socket => { verifiedSocket = socket; } });
      if (controller.signal.aborted || !ownsLiveService(owner)) throw unavailable();
      if (!identity.reachable) return identity;
      const proof = identity.payload?.proof;
      const expected = crypto.createHmac('sha256', capability).update('lworkstation-inbox-identity@1\0').update(challenge).digest();
      if (identity.statusCode !== 200 || identity.payload?.challenge !== challenge
        || typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)
        || !crypto.timingSafeEqual(Buffer.from(proof, 'hex'), expected)) {
        throw Object.assign(new Error('本机收件服务身份校验失败，请检查端口占用后重试。'), { code: 'INBOX_SERVICE_IDENTITY', status: 503 });
      }
      if (!verifiedSocket || verifiedSocket.destroyed || requireOnline && state.status !== 'online') throw unavailable();
      // The next request must reuse this exact authenticated TCP connection.
      // Never reconnect after proof: a replacement listener must see no token.
      agent.createConnection = (_options, callback) => { callback(unavailable()); };
      const result = await requestJson({ ...options, port, capability, signal: controller.signal, agent,
        onSocket: socket => { if (socket !== verifiedSocket) throw unavailable(); } });
      if (controller.signal.aborted || !ownsLiveService(owner)) throw unavailable();
      if (result.error?.code === 'INBOX_SERVICE_UNAVAILABLE') throw unavailable();
      return result;
    } finally {
      activeRequests.delete(controller);
      agent.destroy();
    }
  }

  async function requestInbox(input) {
    // Keep the route/body allowlist at the final authenticated transport boundary.
    const request = normalizeInboxRequest(input);
    const url = buildInboxUrl(port, request);
    const result = await authenticatedRequest({ path: url.pathname + url.search, method: request.method,
      body: request.body?.value ?? null, timeoutMs: 120_000 });
    if (!result.reachable) throw Object.assign(new Error('本机收件服务连接中断，请稍后重试。'), { code: 'INBOX_REQUEST_FAILED', status: 502 });
    if (result.statusCode < 200 || result.statusCode >= 300) throw Object.assign(
      new Error(result.payload?.message || `ERP 收件服务返回 HTTP ${result.statusCode}`),
      { code: result.payload?.error || result.payload?.code || 'INBOX_REQUEST_FAILED', status: result.statusCode });
    if (!result.payload || typeof result.payload !== 'object') throw Object.assign(
      new Error('本机收件服务返回了无效 JSON。'), { code: 'INVALID_INBOX_RESPONSE', status: 502 });
    return result.payload;
  }

  async function requestExtensionInbox(request) {
    const url = new URL(request.url);
    if (!extensionInboxUrl(url) || Number(url.port || 80) !== Number(port)) throw unavailable();
    // Keep the extension's existing bearer contract; the proxy must not grant
    // authenticated access to ERP pages or other callers lacking the token.
    const supplied = /^Bearer\s+(.+)$/i.exec(String(request.headers.get('authorization') || '').trim())?.[1] || '';
    if (!crypto.timingSafeEqual(crypto.createHash('sha256').update(supplied).digest(),
      crypto.createHash('sha256').update(capability).digest())) {
      throw Object.assign(new Error('本机收件服务鉴权失败。'), { code: 'UNAUTHORIZED', status: 401 });
    }
    if (!ownsLiveService() || state.status !== 'online') throw unavailable();
    if (['/erp/v1/workspace-reset', '/erp/v1/workspace-maintenance'].includes(url.pathname)) {
      throw Object.assign(new Error('仅允许桌面工作站清理本机收件数据。'), { code: 'WORKSPACE_RESET_FORBIDDEN', status: 403 });
    }
    let rawBody;
    if (request.body) {
      const reader = request.body.getReader(), chunks = [];
      let bytes = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > EXTENSION_MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          throw Object.assign(new Error('ERP 收件请求体过大。'), { code: 'ERP_INBOX_ERROR', status: 413 });
        }
        chunks.push(Buffer.from(value));
      }
      rawBody = Buffer.concat(chunks);
    }
    const contentType = request.headers.get('content-type');
    const result = await authenticatedRequest({ path: url.pathname + url.search, method: request.method,
      rawBody, timeoutMs: 120_000, extraHeaders: contentType ? { 'content-type': contentType } : {} });
    if (!result.reachable) throw Object.assign(new Error('本机收件服务连接中断，请稍后重试。'), { code: 'INBOX_REQUEST_FAILED', status: 502 });
    return new Response([204, 205, 304].includes(result.statusCode) ? null : result.rawBody, {
      status: result.statusCode,
      headers: { 'content-type': result.headers['content-type'] || 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  async function probe({ authenticate = false } = {}) {
    let result;
    try {
      result = authenticate ? await authenticatedRequest({}, { requireOnline: false }) : await requestJson({ port });
    } catch (error) { return { kind: error.code === 'INBOX_SERVICE_IDENTITY' ? 'conflict' : 'offline', error }; }
    if (!result.reachable) return { kind: "offline", error: result.error };
    if (result.statusCode === 200
      && result.payload?.application === "shopeers-erp-inbox"
      && Number(result.payload?.apiVersion) >= 2) {
      return { kind: "shopeers", payload: result.payload };
    }
    if (!authenticate && result.statusCode === 401
      && result.payload?.error === "UNAUTHORIZED"
      && result.payload?.message === "本机收件服务鉴权失败。") {
      return { kind: "shopeers-auth-required", statusCode: result.statusCode, payload: result.payload };
    }
    return { kind: "conflict", statusCode: result.statusCode, payload: result.payload };
  }

  async function identifyAndProbe({ authenticate = false } = {}) {
    // An unowned listener receives only an unauthenticated conflict probe.
    // Authenticated startup probes require our current live child process.
    return probe({ authenticate: Boolean(authenticate && ownsLiveService()) });
  }

  function applyHealth(payload) {
    publish({
      status: "online",
      apiVersion: Number(payload.apiVersion) || null,
      message: state.ownership === "managed" ? "ERP 收件服务由桌面应用管理" : "已连接现有 Lworkstation 收件服务",
      lastCheckedAt: new Date().toISOString(),
      latestRequest: payload.latestRequest ?? null,
      latestBatch: payload.latestBatch ?? null,
      pendingBatchCount: Number(payload.pendingBatchCount) || 0,
      activeRequestCount: Number(payload.activeRequestCount) || 0,
      latestTransportError: payload.latestTransportError ?? null,
      latestExtension: payload.latestExtension ?? null,
      flow: flowFromStatus(payload),
    });
  }

  function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = refreshNow().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function refreshNow() {
    const owner = child;
    const result = await identifyAndProbe({ authenticate: Boolean(child) });
    if (stopping || child !== owner) return result;
    if (result.kind === "shopeers" && ownsLiveService(owner)) {
      applyHealth(result.payload);
      return result;
    }
    if (["conflict", "shopeers", "shopeers-auth-required"].includes(result.kind)) {
      publish({
        status: "conflict",
        ownership: "external",
        message: `端口 ${port} 已被其他程序占用，未启动 ERP 收件服务`,
        flow: { status: "service_error", tone: "danger", label: "收件端口被占用", message: `请释放本机端口 ${port} 后重试。` },
      });
      return { ...result, kind: 'conflict' };
    }
    if (!child && !stopping && state.ownership === "managed") scheduleRestart("ERP 收件服务意外停止");
    else if (!stopping) publish({ status: "error", message: "ERP 收件服务暂未响应，正在自动检测恢复", latestExtension: null });
    return result;
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => void refresh(), pollIntervalMs);
    pollTimer.unref?.();
  }

  async function restartService() {
    if (stopping || child || state.ownership !== 'managed') return;
    // A process may occupy the released port between an exit and this retry.
    // Check without either capability before spawning another owned child.
    const result = await identifyAndProbe();
    if (stopping || child || state.ownership !== 'managed') return;
    if (result.kind !== 'offline') {
      publish({ status: 'conflict', ownership: 'external',
        message: `端口 ${port} 已被其他程序占用，未启动 ERP 收件服务`,
        flow: { status: 'service_error', tone: 'danger', label: '收件端口被占用', message: `请释放本机端口 ${port} 后重试。` } });
      return;
    }
    spawnService();
  }

  function spawnService() {
    if (!executable || !scriptPath) throw new Error("缺少 ERP 收件服务运行文件。");
    publish({
      status: restartCount > 0 ? "restarting" : "starting",
      ownership: "managed",
      restartCount,
      message: restartCount > 0 ? `正在恢复 ERP 收件服务（${restartCount}/${maxRestarts}）` : "正在启动 ERP 收件服务",
      flow: { status: "service_starting", tone: "info", label: "收件服务启动中", message: "正在准备本机 ERP 回传通道。" },
    });
    const serviceProcess = spawn(executable, [scriptPath], {
      env: {
        ...process.env,
        ...(runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
        SHOPEERS_ERP_INBOX_PORT: String(port),
        SHOPEERS_ERP_INBOX_FILE: spoolPath,
        SHOPEERS_ERP_INBOX_CAPABILITY: capability,
        SHOPEERS_INBOX_RESET_CAPABILITY: resetCapability,
      },
      stdio: "ignore",
      windowsHide: true,
    });
    child = serviceProcess;
    serviceProcess.once("error", (error) => {
      abortOwnedRequests(serviceProcess);
      if (child === serviceProcess) child = null;
      publish({ status: "error", message: `ERP 收件服务启动失败：${error.message}` });
      scheduleRestart(error.message);
    });
    serviceProcess.once("exit", (code, signal) => {
      abortOwnedRequests(serviceProcess);
      if (child === serviceProcess) child = null;
      if (stopping || intentionalChildren.has(serviceProcess)) return;
      scheduleRestart(`ERP 收件服务退出：${signal || code || "unknown"}`);
    });
  }

  function scheduleRestart(reason) {
    if (stopping || restartTimer) return;
    if (restartCount >= maxRestarts) {
      publish({
        status: "error",
        message: `${reason}；自动恢复已达到上限`,
        flow: { status: "service_error", tone: "danger", label: "收件服务异常", message: "自动恢复已达到上限，请重新启动工作站。" },
      });
      return;
    }
    restartCount += 1;
    publish({ status: "restarting", restartCount, message: `${reason}，准备自动恢复` });
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void restartService();
    }, restartDelayMs);
    restartTimer.unref?.();
  }

  async function start() {
    stopping = false;
    const result = await identifyAndProbe();
    if (result.kind !== "offline") {
      publish({
        status: "conflict",
        ownership: "external",
        message: `端口 ${port} 已被其他程序占用，未启动 ERP 收件服务`,
        flow: { status: "service_error", tone: "danger", label: "收件端口被占用", message: `请释放本机端口 ${port} 后重试。` },
      });
      startPolling();
      return { ok: false, conflict: true };
    }
    restartCount = 0;
    spawnService();
    startPolling();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await delay(125);
      const health = await identifyAndProbe({ authenticate: true });
      if (health.kind === "shopeers") {
        applyHealth(health.payload);
        return { ok: true, reused: false };
      }
      if (health.kind === "conflict") {
        publish({ status: 'conflict', ownership: 'external', message: '本机收件服务身份校验失败，请检查端口占用后重试。' });
        return { ok: false, conflict: true };
      }
    }
    publish({ status: "error", message: "ERP 收件服务启动超时" });
    scheduleRestart("ERP 收件服务启动超时");
    return { ok: false, timeout: true };
  }

  async function retry() {
    const current = child;
    if (current) {
      intentionalChildren.add(current);
      abortOwnedRequests(current);
      current.kill();
      await Promise.race([
        new Promise((resolve) => current.once("exit", resolve)),
        delay(1000),
      ]);
      if (child === current) child = null;
    }
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    restartCount = 0;
    state = { ...state, ownership: "none" };
    return start();
  }

  async function stop({ wait = false, timeoutMs = 2500 } = {}) {
    stopping = true;
    if (pollTimer) clearInterval(pollTimer);
    if (restartTimer) clearTimeout(restartTimer);
    pollTimer = null;
    restartTimer = null;
    const current = child;
    const exited = current
      ? new Promise((resolve) => {
        if (current.exitCode !== null || current.killed) return resolve();
        current.once("exit", resolve);
      })
      : Promise.resolve();
    if (current) intentionalChildren.add(current);
    if (current) abortOwnedRequests(current);
    if (current) current.kill();
    child = null;
    publish({ status: "stopped", ownership: "none", message: "ERP 收件服务已停止" });
    if (wait) await Promise.race([exited, delay(timeoutMs)]);
  }

  async function maintenanceRequest(body) {
    const result=await authenticatedRequest({path:'/erp/v1/workspace-maintenance',method:'POST',body,timeoutMs:120_000,extraHeaders:{'x-shopeers-reset-capability':resetCapability}});
    if(!result.reachable||result.statusCode!==200||result.payload?.ok!==true)throw new Error(result.payload?.message||'桌面收件备份或恢复失败。');
    return result.payload;
  }
  async function clearBusinessData({maintenanceId}={}) {
    const result = await authenticatedRequest({ path: "/erp/v1/workspace-reset", method: "POST", body: {maintenanceId},
      timeoutMs: 60_000, extraHeaders: { "x-shopeers-reset-capability": resetCapability } });
    if (!result.reachable || result.statusCode !== 200 || result.payload?.ok !== true) {
      throw new Error(result.payload?.message || "ERP 历史任务及回传记录清理失败，请重试。");
    }
    await refresh().catch(()=>{});
    return result.payload;
  }

  return {
    start,
    stop,
    retry,
    refresh,
    requestInbox,
    requestExtensionInbox,
    clearBusinessData,
    maintenanceRequest,
    getState: () => ({ ...state }),
    getOwnedPid: () => child?.pid ?? null,
  };
}

module.exports = { createInboxServiceController, installExtensionInboxTransport, flowFromStatus, requestJson };
