import { describe, expect, it, vi } from "vitest";
import { buildSyncEnvelope } from "./syncEnvelope";
import { createMemorySyncRuntime, createPostgresSyncRuntime, executeSyncServiceRequest } from "./syncServiceRuntime";
import { postgresRecoveryRepository } from "./syncPostgresRecovery";
import { postgresSeedRepository } from "./syncPostgresSeed";

const workspaceId = "workspace-runtime";
const createdAt = "2026-08-08T00:00:00.000Z";

function envelope() {
  return buildSyncEnvelope({
    workspaceId,
    events: [{
      eventId: "runtime-event-1",
      objectType: "product",
      objectId: "P-RUNTIME",
      action: "product_created",
      actorId: "runtime-test",
      createdAt,
      after: {
        snapshot: {
          product: { id: "P-RUNTIME", workspaceId, name: "运行时商品", status: "active", currency: "CNY", createdAt, updatedAt: createdAt },
          platformSkus: [],
          supplierOffers: [],
        },
      },
    }],
  });
}

function fakePostgresClient({ fail = false } = {}) {
  const hashes = new Map();
  const client = {
    release: vi.fn(),
    query: vi.fn(async (text, values) => {
      if (fail && text.startsWith("insert into public.products")) throw new Error("write failed");
      if (text.startsWith("select current_database")) return { rows: [{ database_name: "test", checked_at: createdAt }] };
      if (text === "begin" || text === "commit" || text === "rollback") return { rows: [] };
      if (text.startsWith("select id from public.workspaces")) return { rowCount: 1, rows: [{ id: values[0] }] };
      if (text.startsWith("select event_id, content_hash")) return { rows: [...hashes].map(([event_id, content_hash]) => ({ event_id, content_hash })) };
      if (text.startsWith("insert into public.audit_events")) {
        for (const row of JSON.parse(values[1])) hashes.set(row.event_id, row.content_hash);
      }
      return { rowCount: 1, rows: [] };
    }),
  };
  return client;
}

describe("sync service runtime", () => {
  it("keeps the memory runtime compatible with the HTTP contract", async () => {
    const runtime = createMemorySyncRuntime({ authorize: () => true });
    await expect(executeSyncServiceRequest(runtime, { method: "GET", path: "/health" })).resolves.toMatchObject({ status: 200, payload: { backend: "memory" } });
    const pushed = await executeSyncServiceRequest(runtime, { method: "POST", path: "/sync/v1/audit-events", body: envelope() });
    expect(pushed).toMatchObject({ status: 200, payload: { eventIds: ["runtime-event-1"] } });
    const recovery = await executeSyncServiceRequest(runtime, { method: "GET", path: `/sync/v1/workspaces/${workspaceId}/recovery` });
    expect(recovery).toMatchObject({ status: 200, payload: { workspaceId, events: [{ eventId: "runtime-event-1" }] } });
    await expect(executeSyncServiceRequest(runtime, { method: "GET", path: "/unknown" })).resolves.toMatchObject({ status: 404, payload: { error: { code: "NOT_FOUND" } } });
  });

  it("uses one checked-out PostgreSQL client for the entire transaction and releases it", async () => {
    const client = fakePostgresClient();
    const pool = { connect: vi.fn(async () => client) };
    const runtime = createPostgresSyncRuntime({ pool, authorize: () => true, now: () => createdAt });
    await expect(runtime.health()).resolves.toMatchObject({ backend: "postgres", database: "test" });
    const pushed = await runtime.acceptAudit(envelope(), { token: "token" });
    expect(pushed).toMatchObject({ transaction: "committed", insertedEventCount: 1 });
    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls.some(([text]) => text === "commit")).toBe(true);
  });

  it("releases the client even when a PostgreSQL transaction rolls back", async () => {
    const client = fakePostgresClient({ fail: true });
    const pool = { connect: vi.fn(async () => client) };
    const runtime = createPostgresSyncRuntime({ pool, authorize: () => true });
    await expect(runtime.acceptAudit(envelope())).rejects.toThrow("write failed");
    expect(client.query.mock.calls.at(-1)[0]).toBe("rollback");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("does not pretend PostgreSQL recovery or seed import exists without an adapter", async () => {
    const runtime = createPostgresSyncRuntime({ pool: { connect: vi.fn() }, authorize: () => true });
    await expect(executeSyncServiceRequest(runtime, { method: "GET", path: `/sync/v1/workspaces/${workspaceId}/recovery` })).resolves.toMatchObject({ status: 503, payload: { error: { code: "SERVICE_NOT_CONFIGURED" } } });
    await expect(executeSyncServiceRequest(runtime, { method: "POST", path: "/sync/v1/cloud-seeds/preflight", body: {} })).resolves.toMatchObject({ status: 503, payload: { error: { code: "SERVICE_NOT_CONFIGURED" } } });
  });

  it("accepts a real PostgreSQL recovery repository as a runtime adapter", async () => {
    const client = fakePostgresClient();
    client.query.mockImplementation(async (text, values) => {
      if (text.startsWith("select current_database")) return { rows: [{ database_name: "test", checked_at: createdAt }] };
      if (text.startsWith("begin")) return { rows: [] };
      if (text === "commit" || text === "rollback") return { rows: [] };
      if (text.includes("from public.workspaces")) return { rows: [{ id: workspaceId, name: "恢复工作区", default_currency: "CNY", timezone: "Asia/Shanghai", created_at: new Date(createdAt), updated_at: new Date(createdAt) }] };
      if (text.includes("from public.audit_events")) return { rows: [] };
      return { rows: [] };
    });
    const runtime = createPostgresSyncRuntime({ pool: { connect: vi.fn(async () => client) }, authorize: () => true, recoveryRepository: postgresRecoveryRepository });
    const result = await runtime.recovery(workspaceId);
    expect(result).toMatchObject({ format: "shopeers-sync-recovery", workspaceId, currency: "CNY" });
  });

  it("accepts a PostgreSQL seed repository as a runtime adapter", async () => {
    const runtime = createPostgresSyncRuntime({ pool: { connect: vi.fn() }, authorize: () => true, seedRepository: postgresSeedRepository });
    expect(runtime.seedPreflight).toEqual(expect.any(Function));
    expect(runtime.seedCommit).toEqual(expect.any(Function));
  });

  it("supports asynchronous JWT/member authorization before opening the database transaction", async () => {
    const client = fakePostgresClient();
    const authorize = vi.fn(async ({ token, actor }) => token === "jwt" && actor === "user-1");
    const runtime = createPostgresSyncRuntime({ pool: { connect: vi.fn(async () => client) }, authorize, now: () => createdAt });
    const result = await runtime.acceptAudit(envelope(), { token: "jwt", actor: "user-1" });
    expect(result).toMatchObject({ transaction: "committed" });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ token: "jwt", actor: "user-1" }));
  });
});
