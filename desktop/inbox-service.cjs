const { spawn } = require("node:child_process");
const http = require("node:http");

const DEFAULT_PORT = 8790;
const MAX_RESTARTS = 3;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestJson({ port, path = "/erp/v1/status", timeoutMs = 1200, capability = "" }) {
  return new Promise((resolve) => {
    const headers = capability ? { authorization: `Bearer ${capability}` } : undefined;
    const request = http.get({ host: "127.0.0.1", port, path, timeout: timeoutMs, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        let payload = null;
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* identity checked below */ }
        resolve({ reachable: true, statusCode: response.statusCode, payload });
      });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", (error) => resolve({ reachable: false, error }));
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
      tone: batch.evidenceStatus === "complete" ? "success" : "warning",
      label: batch.evidenceStatus === "complete" ? "已接收，待成本核对" : "旧版预览，待成本核对",
      message: batch.evidenceStatus === "complete"
        ? "v2 原始采购证据已由工作站读取，等待 CostMatching 处理。"
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
  const intentionalChildren = new WeakSet();
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

  async function probe({ authenticate = false } = {}) {
    const result = await requestJson({ port, capability: authenticate ? capability : "" });
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
    // Never send the capability to an unauthenticated listener. Only a child
    // spawned by this controller is trusted to receive the bearer.
    return probe({ authenticate: Boolean(authenticate && child && child.exitCode === null) });
  }

  function applyHealth(payload) {
    publish({
      status: "online",
      apiVersion: Number(payload.apiVersion) || null,
      message: state.ownership === "managed" ? "ERP 收件服务由桌面应用管理" : "已连接现有 Shopeers 收件服务",
      lastCheckedAt: new Date().toISOString(),
      latestRequest: payload.latestRequest ?? null,
      latestBatch: payload.latestBatch ?? null,
      pendingBatchCount: Number(payload.pendingBatchCount) || 0,
      activeRequestCount: Number(payload.activeRequestCount) || 0,
      latestTransportError: payload.latestTransportError ?? null,
      flow: flowFromStatus(payload),
    });
  }

  async function refresh() {
    const result = await identifyAndProbe({ authenticate: Boolean(child) });
    if (result.kind === "shopeers") {
      applyHealth(result.payload);
      return result;
    }
    if (result.kind === "conflict") {
      publish({
        status: "conflict",
        ownership: "external",
        message: `端口 ${port} 已被其他程序占用，未启动 ERP 收件服务`,
        flow: { status: "service_error", tone: "danger", label: "收件端口被占用", message: `请释放本机端口 ${port} 后重试。` },
      });
      return result;
    }
    if (!child && !stopping && state.ownership === "managed") scheduleRestart("ERP 收件服务意外停止");
    return result;
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => void refresh(), pollIntervalMs);
    pollTimer.unref?.();
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
      },
      stdio: "ignore",
      windowsHide: true,
    });
    child = serviceProcess;
    serviceProcess.once("error", (error) => {
      if (child === serviceProcess) child = null;
      publish({ status: "error", message: `ERP 收件服务启动失败：${error.message}` });
      scheduleRestart(error.message);
    });
    serviceProcess.once("exit", (code, signal) => {
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
      if (!stopping) spawnService();
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
      if (health.kind === "conflict") return { ok: false, conflict: true };
    }
    publish({ status: "error", message: "ERP 收件服务启动超时" });
    scheduleRestart("ERP 收件服务启动超时");
    return { ok: false, timeout: true };
  }

  async function retry() {
    const current = child;
    if (current) {
      intentionalChildren.add(current);
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
    if (current) current.kill();
    child = null;
    publish({ status: "stopped", ownership: "none", message: "ERP 收件服务已停止" });
    if (wait) await Promise.race([exited, delay(timeoutMs)]);
  }

  return {
    start,
    stop,
    retry,
    refresh,
    getState: () => ({ ...state }),
    getOwnedPid: () => child?.pid ?? null,
  };
}

module.exports = { createInboxServiceController, flowFromStatus, requestJson };
