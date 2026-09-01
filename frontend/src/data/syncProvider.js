import { runtimeConfig } from "../config/runtimeConfig";
import { getCloudSyncActorId, getCloudSyncHeaders } from "./cloudAuth";
import {
  SYNC_ACK_FORMAT,
  SYNC_ACK_VERSION,
  validateSyncAck,
  validateSyncEnvelope,
} from "../domain/syncEnvelope";
import { validateSyncRecoveryPayload } from "../domain/syncRecovery";

export class SyncProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SyncProviderError";
    Object.assign(this, details);
  }
}

function defaultRetryableStatus(status) {
  const code = Number(status);
  return code === 408 || code === 429 || code >= 500;
}

export function createLocalSyncProvider() {
  return {
    kind: "local",
    async resolveActorId() {
      return "local-user";
    },
    async push() {
      return { status: "skipped", reason: "local_only" };
    },
    async health() {
      return { status: "skipped", reason: "local_only", backend: "local" };
    },
  };
}

export function createHttpSyncProvider({ baseUrl, fetchImpl = globalThis.fetch, headers = {}, getHeaders = null, getActorId = null, requireAuth = false } = {}) {
  const normalizedBaseUrl = String(baseUrl ?? "").trim().replace(/\/$/, "");
  if (!normalizedBaseUrl) throw new SyncProviderError("同步 API 地址未配置。", { code: "MISSING_ENDPOINT" });
  if (typeof fetchImpl !== "function") throw new SyncProviderError("当前环境不支持网络同步。", { code: "FETCH_UNAVAILABLE" });

  async function resolveHeaders() {
    const resolved = typeof getHeaders === "function" ? await getHeaders() : {};
    return { ...headers, ...(resolved && typeof resolved === "object" ? resolved : {}) };
  }

  return {
    kind: "http",
    endpoint: `${normalizedBaseUrl}/sync/v1/audit-events`,
    async resolveActorId() {
      return typeof getActorId === "function" ? String(await getActorId()).trim() : "";
    },
    async health({ signal } = {}) {
      let response;
      try {
        const requestHeaders = await resolveHeaders();
        response = await fetchImpl(`${normalizedBaseUrl}/health`, {
          method: "GET",
          headers: requestHeaders,
          signal,
        });
      } catch (error) {
        throw new SyncProviderError(`同步健康检查失败：${error.message}`, { code: "NETWORK_ERROR", cause: error });
      }
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok) {
        throw new SyncProviderError(`同步健康检查返回 HTTP ${response.status}。`, { code: "HTTP_ERROR", status: response.status, payload });
      }
      if (!payload || payload.status !== "ok" || payload.service !== "shopeers-sync") {
        throw new SyncProviderError("同步健康检查返回了无法识别的结果。", { code: "INVALID_HEALTH", payload });
      }
      return payload;
    },
    async push(envelope, { signal } = {}) {
      const inspection = validateSyncEnvelope(envelope);
      let response;
      let requestHeaders;
      try {
        requestHeaders = await resolveHeaders();
      } catch (error) {
        if (error instanceof SyncProviderError) throw error;
        throw new SyncProviderError(`同步请求准备失败：${error.message}`, { code: "NETWORK_ERROR", cause: error });
      }
      if (requireAuth && !String(requestHeaders.authorization ?? "").trim()) {
        throw new SyncProviderError("请先登录云端工作区，再同步本机审计事件。", { code: "AUTH_REQUIRED", retryable: false });
      }
      try {
        response = await fetchImpl(`${normalizedBaseUrl}/sync/v1/audit-events`, {
          method: "POST",
          headers: { "content-type": "application/json", ...requestHeaders },
          body: JSON.stringify(envelope),
          signal,
        });
      } catch (error) {
        throw new SyncProviderError(`同步请求失败：${error.message}`, { code: "NETWORK_ERROR", cause: error });
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const serviceError = payload?.error && typeof payload.error === "object" ? payload.error : {};
        throw new SyncProviderError(
          String(serviceError.message ?? "").trim() || `同步服务返回 HTTP ${response.status}。`,
          {
            code: String(serviceError.code ?? "").trim() || "HTTP_ERROR",
            status: response.status,
            retryable: serviceError.retryable ?? defaultRetryableStatus(response.status),
            eventIds: Array.isArray(serviceError.eventIds) ? serviceError.eventIds.map(String) : [],
            payload,
          },
        );
      }
      if (!payload || payload.format !== SYNC_ACK_FORMAT || Number(payload.formatVersion) !== SYNC_ACK_VERSION) {
        throw new SyncProviderError("同步服务返回了无法识别的回执。", { code: "INVALID_ACK", payload });
      }
      const ack = validateSyncAck(payload, {
        workspaceId: envelope.workspaceId,
        eventIds: envelope.events.map((event) => event.eventId),
      });
      return {
        status: "synced",
        ...ack,
        eventCount: inspection.eventCount,
      };
    },
    async pullRecovery(workspaceId, { signal } = {}) {
      const normalizedWorkspaceId = String(workspaceId ?? "").trim();
      if (!normalizedWorkspaceId) throw new SyncProviderError("恢复工作区不能为空。", { code: "MISSING_WORKSPACE" });
      let response;
      try {
        const requestHeaders = await resolveHeaders();
        response = await fetchImpl(`${normalizedBaseUrl}/sync/v1/workspaces/${encodeURIComponent(normalizedWorkspaceId)}/recovery`, {
          method: "GET",
          headers: requestHeaders,
          signal,
        });
      } catch (error) {
        throw new SyncProviderError(`恢复请求失败：${error.message}`, { code: "NETWORK_ERROR", cause: error });
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw new SyncProviderError(`同步服务返回 HTTP ${response.status}。`, { code: "HTTP_ERROR", status: response.status, payload });
      }
      const inspection = validateSyncRecoveryPayload(payload);
      if (inspection.workspaceId !== normalizedWorkspaceId) {
        throw new SyncProviderError("恢复包工作区不一致。", { code: "WORKSPACE_MISMATCH", payload });
      }
      return payload;
    },
  };
}

export function createSyncProvider(config = runtimeConfig, options = {}) {
  if (config.syncProvider === "local") return createLocalSyncProvider();
  if (config.syncProvider === "api") {
    return createHttpSyncProvider({
      baseUrl: config.syncApiBaseUrl || config.apiBaseUrl,
      ...options,
      getHeaders: options.getHeaders ?? (() => getCloudSyncHeaders(config)),
      getActorId: options.getActorId ?? (() => getCloudSyncActorId(config)),
      requireAuth: options.requireAuth ?? true,
    });
  }
  if (config.syncProvider === "supabase") {
    return createHttpSyncProvider({
      baseUrl: config.syncApiBaseUrl,
      ...options,
      getHeaders: options.getHeaders ?? (() => getCloudSyncHeaders(config)),
      getActorId: options.getActorId ?? (() => getCloudSyncActorId(config)),
      requireAuth: options.requireAuth ?? true,
    });
  }
  throw new SyncProviderError("同步提供方配置无效。", { code: "INVALID_PROVIDER" });
}
