import { describe, expect, it, vi } from "vitest";
import {
  createHttpSyncProvider,
  createLocalSyncProvider,
  createSyncProvider,
  SyncProviderError,
} from "./syncProvider";
import {
  buildSyncEnvelope,
  SYNC_ACK_FORMAT,
  SYNC_ACK_VERSION,
} from "../domain/syncEnvelope";
import { buildSyncRecoveryPayload } from "../domain/syncRecovery";

function makeEnvelope() {
  return buildSyncEnvelope({
    workspaceId: "workspace-default",
    cursor: 12,
    events: [
      {
        id: 12,
        workspaceId: "workspace-default",
        objectType: "product",
        objectId: "P-1",
        action: "product_created",
        createdAt: "2026-08-07T08:00:00.000Z",
      },
      {
        id: 13,
        workspaceId: "workspace-default",
        objectType: "product",
        objectId: "P-2",
        action: "product_updated",
        createdAt: "2026-08-07T08:01:00.000Z",
      },
    ],
  });
}

function makeResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

describe("sync providers", () => {
  it("keeps the local provider offline", async () => {
    const provider = createLocalSyncProvider();
    const result = await provider.push(makeEnvelope());

    expect(provider.kind).toBe("local");
    await expect(provider.resolveActorId()).resolves.toBe("local-user");
    expect(result).toEqual({ status: "skipped", reason: "local_only" });
  });

  it("posts a valid envelope and accepts a complete acknowledgement", async () => {
    const envelope = makeEnvelope();
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe("https://sync.example.test/sync/v1/audit-events");
      expect(options.method).toBe("POST");
      expect(options.headers).toMatchObject({
        "content-type": "application/json",
        authorization: "Bearer test-token",
      });
      expect(JSON.parse(options.body)).toEqual(envelope);
      return makeResponse({
        format: SYNC_ACK_FORMAT,
        formatVersion: SYNC_ACK_VERSION,
        workspaceId: "workspace-default",
        eventIds: ["12", "13"],
        cursor: "13",
        syncVersion: "cloud-42",
      });
    });
    const provider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test/",
      fetchImpl,
      headers: { authorization: "Bearer test-token" },
    });

    await expect(provider.push(envelope)).resolves.toMatchObject({
      status: "synced",
      eventCount: 2,
      cursor: "13",
      syncVersion: "cloud-42",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("checks the sync service health endpoint", async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe("https://sync.example.test/health");
      expect(options.method).toBe("GET");
      return makeResponse({ status: "ok", service: "shopeers-sync", backend: "postgres" });
    });
    const provider = createHttpSyncProvider({ baseUrl: "https://sync.example.test", fetchImpl });
    await expect(provider.health()).resolves.toMatchObject({ status: "ok", backend: "postgres" });
  });

  it("downloads and validates a workspace recovery payload", async () => {
    const recovery = buildSyncRecoveryPayload({ workspaceId: "workspace-default", events: [] });
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe("https://sync.example.test/sync/v1/workspaces/workspace-default/recovery");
      expect(options.method).toBe("GET");
      expect(options.headers).toMatchObject({ authorization: "Bearer test-token" });
      return makeResponse(recovery);
    });
    const provider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test",
      fetchImpl,
      headers: { authorization: "Bearer test-token" },
    });
    await expect(provider.pullRecovery("workspace-default")).resolves.toEqual(recovery);
  });

  it("surfaces HTTP and network failures as retryable provider errors", async () => {
    const envelope = makeEnvelope();
    const httpProvider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test",
      fetchImpl: vi.fn(async () => makeResponse({ error: "unavailable" }, { ok: false, status: 503 })),
    });
    await expect(httpProvider.push(envelope)).rejects.toMatchObject({
      name: "SyncProviderError",
      code: "HTTP_ERROR",
      status: 503,
    });

    const networkProvider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test",
      fetchImpl: vi.fn(async () => {
        throw new Error("连接被拒绝");
      }),
    });
    await expect(networkProvider.push(envelope)).rejects.toMatchObject({
      name: "SyncProviderError",
      code: "NETWORK_ERROR",
    });
  });

  it("exposes the authenticated actor resolver to the sync runner", async () => {
    const provider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test",
      fetchImpl: vi.fn(),
      getActorId: vi.fn(async () => "finance-cloud-2"),
    });
    await expect(provider.resolveActorId()).resolves.toBe("finance-cloud-2");
  });

  it("requires API mode to use the authenticated cloud session for both bearer token and actor", async () => {
    const envelope = makeEnvelope();
    const recovery = buildSyncRecoveryPayload({ workspaceId: "workspace-default", events: [] });
    const fetchImpl = vi.fn(async (url, options) => {
      expect(options.headers.authorization).toBe("Bearer verified-session-token");
      expect(options.headers).not.toHaveProperty("apikey");
      if (url.endsWith("/health")) return makeResponse({ status: "ok", service: "shopeers-sync", backend: "postgres" });
      if (url.includes("/recovery")) return makeResponse(recovery);
      return makeResponse({
        format: SYNC_ACK_FORMAT,
        formatVersion: SYNC_ACK_VERSION,
        workspaceId: "workspace-default",
        eventIds: ["12", "13"],
      });
    });
    const provider = createSyncProvider({
      syncProvider: "api",
      apiBaseUrl: "https://sync.example.test",
      syncApiBaseUrl: "",
    }, {
      fetchImpl,
      getHeaders: vi.fn(async () => ({ authorization: "Bearer verified-session-token" })),
      getActorId: vi.fn(async () => "finance-api-current"),
    });

    await expect(provider.resolveActorId()).resolves.toBe("finance-api-current");
    await expect(provider.health()).resolves.toMatchObject({ status: "ok" });
    await expect(provider.push(envelope)).resolves.toMatchObject({ status: "synced", eventCount: 2 });
    await expect(provider.pullRecovery("workspace-default")).resolves.toEqual(recovery);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("preserves non-retryable server contract errors and affected event IDs", async () => {
    const provider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test",
      fetchImpl: vi.fn(async () => makeResponse({
        error: {
          code: "INVALID_ERP_VOID_REOPEN_PAIR",
          message: "旧生命周期事件无法安全配对",
          retryable: false,
          eventIds: ["12", "13"],
        },
      }, { ok: false, status: 409 })),
    });
    await expect(provider.push(makeEnvelope())).rejects.toMatchObject({
      name: "SyncProviderError",
      code: "INVALID_ERP_VOID_REOPEN_PAIR",
      status: 409,
      retryable: false,
      eventIds: ["12", "13"],
      message: "旧生命周期事件无法安全配对",
    });
  });

  it.each([
    [408, null],
    [429, null],
    [500, null],
    [503, null],
    [409, { error: { code: "PREFLIGHT_STALE", message: "请重试", retryable: true } }],
  ])("classifies HTTP %s as retryable when the status or structured error allows it", async (status, payload) => {
    const provider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test",
      fetchImpl: vi.fn(async () => makeResponse(payload, { ok: false, status })),
    });
    await expect(provider.push(makeEnvelope())).rejects.toMatchObject({
      status,
      retryable: true,
    });
  });

  it("rejects malformed or incomplete acknowledgements", async () => {
    const envelope = makeEnvelope();
    const invalidAckProvider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test",
      fetchImpl: vi.fn(async () => makeResponse({ format: "unknown", formatVersion: 1 })),
    });
    await expect(invalidAckProvider.push(envelope)).rejects.toMatchObject({
      name: "SyncProviderError",
      code: "INVALID_ACK",
    });

    const partialAckProvider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test",
      fetchImpl: vi.fn(async () => makeResponse({
        format: SYNC_ACK_FORMAT,
        formatVersion: SYNC_ACK_VERSION,
        workspaceId: "workspace-default",
        eventIds: ["12"],
      })),
    });
    await expect(partialAckProvider.push(envelope)).rejects.toThrow("未确认全部事件");

    const wrongWorkspaceProvider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test",
      fetchImpl: vi.fn(async () => makeResponse({
        format: SYNC_ACK_FORMAT,
        formatVersion: SYNC_ACK_VERSION,
        workspaceId: "workspace-other",
        eventIds: ["12", "13"],
      })),
    });
    await expect(wrongWorkspaceProvider.push(envelope)).rejects.toThrow("工作区不一致");
  });

  it("requires an endpoint before constructing an HTTP provider", () => {
    expect(() => createHttpSyncProvider({ baseUrl: "" })).toThrowError(SyncProviderError);
    expect(() => createHttpSyncProvider({ baseUrl: "" })).toThrow("同步 API 地址未配置");
  });

  it("blocks Supabase pushes before a bearer session exists", async () => {
    const provider = createHttpSyncProvider({
      baseUrl: "https://sync.example.test",
      requireAuth: true,
      getHeaders: async () => ({ apikey: "anon-key" }),
      fetchImpl: vi.fn(),
    });
    await expect(provider.push(makeEnvelope())).rejects.toMatchObject({ code: "AUTH_REQUIRED", retryable: false });
  });
});
