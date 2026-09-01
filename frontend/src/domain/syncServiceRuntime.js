import { createCloudSeedImportStore } from "./cloudSeedImportContract.js";
import { createSyncEventStore } from "./syncServerContract.js";
import { applySyncEnvelopeWithPostgresClient } from "./syncPostgresPlan.js";

export class SyncServiceError extends Error {
  constructor(message, { code = "INTERNAL_ERROR", status = 500, retryable = false } = {}) {
    super(message);
    this.name = "SyncServiceError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function requireMethod(target, method, label) {
  if (!target || typeof target[method] !== "function") {
    throw new SyncServiceError(`${label}未配置。`, { code: "SERVICE_NOT_CONFIGURED", status: 503, retryable: true });
  }
}

async function withPoolClient(pool, callback) {
  if (!pool || typeof pool.connect !== "function") {
    throw new SyncServiceError("PostgreSQL 连接池必须提供 connect 方法。", { code: "DATABASE_NOT_CONFIGURED", status: 503, retryable: true });
  }
  const client = await pool.connect();
  if (!client || typeof client.query !== "function") {
    client?.release?.();
    throw new SyncServiceError("PostgreSQL 连接池返回了无效客户端。", { code: "DATABASE_UNAVAILABLE", status: 503, retryable: true });
  }
  try {
    return await callback(client);
  } finally {
    client.release?.();
  }
}

export function createMemorySyncRuntime({ authorize = () => true } = {}) {
  const seedStore = createCloudSeedImportStore({ authorize });
  const eventStore = createSyncEventStore({
    authorize,
    resolveBaseline: (workspaceId) => seedStore.exportSeed(workspaceId),
  });
  return {
    kind: "memory",
    async health() {
      const seedSnapshot = seedStore.snapshot();
      return {
        status: "ok",
        service: "shopeers-sync",
        backend: "memory",
        eventCount: eventStore.snapshot().eventCount,
        seedWorkspaceCount: seedSnapshot.workspaceCount,
        importedSeedCount: seedSnapshot.importedSeedCount,
      };
    },
    async acceptAudit(payload, context = {}) {
      return eventStore.accept(payload, context);
    },
    async recovery(workspaceId, context = {}) {
      return eventStore.recovery(workspaceId, context);
    },
    async seedPreflight(seed, context = {}) {
      return seedStore.preflight(seed, context);
    },
    async seedCommit(seed, context = {}) {
      return seedStore.commit(seed, context);
    },
  };
}

export function createPostgresSyncRuntime({
  pool,
  authorize = () => true,
  recoveryRepository = null,
  seedRepository = null,
  now = () => new Date().toISOString(),
} = {}) {
  return {
    kind: "postgres",
    async health() {
      return withPoolClient(pool, async (client) => {
        const result = await client.query("select current_database() as database_name, now() as checked_at");
        return {
          status: "ok",
          service: "shopeers-sync",
          backend: "postgres",
          database: result?.rows?.[0]?.database_name ?? null,
          checkedAt: result?.rows?.[0]?.checked_at ?? now(),
        };
      });
    },
    async acceptAudit(payload, context = {}) {
      return withPoolClient(pool, (client) => applySyncEnvelopeWithPostgresClient(payload, {
        client,
        authorize,
        context,
        now,
      }));
    },
    async recovery(workspaceId, context = {}) {
      requireMethod(recoveryRepository, "load", "PostgreSQL 恢复仓库");
      if (!(await authorize({ workspaceId, actor: context.actor, token: context.token, operation: "recovery", events: [] }))) {
        throw new SyncServiceError("当前身份无权读取该工作区。", { code: "WORKSPACE_FORBIDDEN", status: 403 });
      }
      return withPoolClient(pool, (client) => recoveryRepository.load(workspaceId, { client, context, now }));
    },
    async seedPreflight(seed, context = {}) {
      requireMethod(seedRepository, "preflight", "PostgreSQL 种子仓库");
      return withPoolClient(pool, (client) => seedRepository.preflight(seed, { client, context, authorize, now }));
    },
    async seedCommit(seed, context = {}) {
      requireMethod(seedRepository, "commit", "PostgreSQL 种子仓库");
      return withPoolClient(pool, (client) => seedRepository.commit(seed, { client, context, authorize, now }));
    },
  };
}

function errorPayload(error) {
  const status = Number(error?.status) || 500;
  return {
    status,
    payload: {
      error: {
        code: error?.code || (status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST"),
        message: error?.message || "同步服务处理失败。",
        retryable: error?.retryable ?? status >= 500,
        eventIds: error?.eventIds || [],
        conflicts: error?.conflicts || [],
      },
    },
  };
}

export async function executeSyncServiceRequest(runtime, {
  method,
  path,
  token = "",
  body = null,
  actor = null,
  role = null,
  requestId = null,
} = {}) {
  try {
    if (method === "GET" && path === "/health") {
      return { status: 200, payload: await runtime.health() };
    }
    const recoveryMatch = method === "GET" ? /^\/sync\/v1\/workspaces\/([^/]+)\/recovery$/.exec(path || "") : null;
    if (recoveryMatch) {
      return {
        status: 200,
        payload: await runtime.recovery(decodeURIComponent(recoveryMatch[1]), { token, actor, role, requestId }),
      };
    }
    if (method === "POST" && path === "/sync/v1/audit-events") {
      return { status: 200, payload: await runtime.acceptAudit(body, { token, actor, role, requestId }) };
    }
    if (method === "POST" && path === "/sync/v1/cloud-seeds/preflight") {
      return { status: 200, payload: await runtime.seedPreflight(body, { token, actor, role, requestId }) };
    }
    if (method === "POST" && path === "/sync/v1/cloud-seeds/import") {
      return {
        status: 200,
        payload: await runtime.seedCommit(body?.seed, { token, actor, role, requestId, preflightId: body?.preflightId }),
      };
    }
    return {
      status: 404,
      payload: { error: { code: "NOT_FOUND", message: "接口不存在。", retryable: false, eventIds: [], conflicts: [] } },
    };
  } catch (error) {
    return errorPayload(error);
  }
}

export { errorPayload as syncServiceErrorPayload, withPoolClient as withPostgresPoolClient };
