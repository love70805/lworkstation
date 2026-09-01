import { runtimeConfig } from "../config/runtimeConfig";
import {
  CLOUD_SEED_IMPORT_ACK_FORMAT,
  CLOUD_SEED_IMPORT_VERSION,
  CLOUD_SEED_PREFLIGHT_FORMAT,
} from "../domain/cloudSeedImportContract";
import { validateCloudSeedPayload } from "../domain/cloudSeed";

export class CloudSeedProviderError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CloudSeedProviderError";
    Object.assign(this, details);
  }
}

async function readResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function validateServicePayload(payload, expectedFormat) {
  if (!payload || payload.format !== expectedFormat || Number(payload.formatVersion) !== CLOUD_SEED_IMPORT_VERSION) {
    throw new CloudSeedProviderError("云端迁移服务返回了无法识别的结果。", { code: "INVALID_RESPONSE", payload });
  }
  return payload;
}

export function createHttpCloudSeedProvider({ baseUrl, fetchImpl = globalThis.fetch, headers = {} } = {}) {
  const normalizedBaseUrl = String(baseUrl ?? "").trim().replace(/\/$/, "");
  if (!normalizedBaseUrl) throw new CloudSeedProviderError("云端迁移 API 地址未配置。", { code: "MISSING_ENDPOINT" });
  if (typeof fetchImpl !== "function") throw new CloudSeedProviderError("当前环境不支持云端迁移请求。", { code: "FETCH_UNAVAILABLE" });

  async function post(path, body, signal) {
    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw new CloudSeedProviderError(`云端迁移请求失败：${error.message}`, { code: "NETWORK_ERROR", cause: error });
    }
    const payload = await readResponse(response);
    if (!response.ok) {
      throw new CloudSeedProviderError(payload?.error?.message ?? `云端迁移服务返回 HTTP ${response.status}。`, {
        code: payload?.error?.code ?? "HTTP_ERROR",
        status: response.status,
        retryable: Boolean(payload?.error?.retryable),
        conflicts: payload?.error?.conflicts ?? [],
        payload,
      });
    }
    return payload;
  }

  return {
    kind: "http",
    async preflight(seed, { signal } = {}) {
      const inspection = validateCloudSeedPayload(seed);
      const payload = validateServicePayload(
        await post("/sync/v1/cloud-seeds/preflight", seed, signal),
        CLOUD_SEED_PREFLIGHT_FORMAT,
      );
      if (payload.workspaceId !== inspection.workspaceId) throw new CloudSeedProviderError("预检结果工作区不一致。", { code: "WORKSPACE_MISMATCH" });
      return payload;
    },
    async commit(seed, preflightId, { signal } = {}) {
      const inspection = validateCloudSeedPayload(seed);
      const payload = validateServicePayload(
        await post("/sync/v1/cloud-seeds/import", { seed, preflightId }, signal),
        CLOUD_SEED_IMPORT_ACK_FORMAT,
      );
      if (payload.workspaceId !== inspection.workspaceId) throw new CloudSeedProviderError("导入回执工作区不一致。", { code: "WORKSPACE_MISMATCH" });
      return payload;
    },
  };
}

export function createCloudSeedProvider(config = runtimeConfig, options = {}) {
  if (!config.cloudConfigured) throw new CloudSeedProviderError("当前仍是本机模式，尚未配置云端迁移 API。", { code: "CLOUD_NOT_CONFIGURED" });
  const baseUrl = config.syncApiBaseUrl || config.apiBaseUrl;
  return createHttpCloudSeedProvider({ baseUrl, ...options });
}
