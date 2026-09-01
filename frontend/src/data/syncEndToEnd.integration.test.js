import "fake-indexeddb/auto";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSyncEventStore } from "../domain/syncServerContract";
import { DEFAULT_WORKSPACE_ID, createManualCaptureRecord, db } from "./database";
import { createHttpSyncProvider } from "./syncProvider";
import {
  getSyncStatusSnapshot,
} from "./syncOutbox";
import { runSyncOnce } from "./syncRunner";

let server;
let baseUrl;

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startServer() {
  const store = createSyncEventStore({
    authorize: ({ workspaceId, token }) => workspaceId === DEFAULT_WORKSPACE_ID && token === "e2e-token",
  });
  server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/sync/v1/audit-events") {
      json(res, 404, { error: { message: "不存在" } });
      return;
    }
    try {
      const payload = await readJson(req);
      const authorization = String(req.headers.authorization ?? "");
      const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
      json(res, 200, store.accept(payload, { token }));
    } catch (error) {
      json(res, Number(error.status) || 400, {
        error: { code: error.code ?? "INVALID_ENVELOPE", message: error.message },
      });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  return store;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  baseUrl = null;
  db.close();
  await db.delete();
});

describe("本地审计 outbox 到 HTTP 同步服务", () => {
  it("syncs successfully, preserves idempotency, and retries failed events", async () => {
    const store = await startServer();
    await createManualCaptureRecord({
      name: "同步测试商品",
      sourceUrl: "https://detail.1688.com/offer/sync-test",
    });

    await expect(getSyncStatusSnapshot()).resolves.toMatchObject({
      pendingCount: 1,
      retryableCount: 1,
    });

    const provider = createHttpSyncProvider({
      baseUrl,
      headers: { authorization: "Bearer e2e-token" },
    });
    await expect(runSyncOnce({
      workspaceId: DEFAULT_WORKSPACE_ID,
      provider,
      now: "2026-08-07T09:00:00.000Z",
    })).resolves.toMatchObject({ status: "synced", eventCount: 1 });

    await expect(getSyncStatusSnapshot()).resolves.toMatchObject({
      pendingCount: 0,
      syncedCount: 1,
      retryableCount: 0,
    });
    expect(store.snapshot()).toMatchObject({ eventCount: 1, entityCount: 1 });

    await createManualCaptureRecord({
      name: "重试测试商品",
      sourceUrl: "https://detail.1688.com/offer/retry-test",
    });
    const invalidProvider = createHttpSyncProvider({
      baseUrl,
      headers: { authorization: "Bearer wrong-token" },
    });
    await expect(runSyncOnce({
      workspaceId: DEFAULT_WORKSPACE_ID,
      provider: invalidProvider,
      now: "2026-08-07T09:01:00.000Z",
    })).resolves.toMatchObject({ status: "blocked", eventCount: 1, code: "WORKSPACE_FORBIDDEN" });
    await expect(getSyncStatusSnapshot()).resolves.toMatchObject({
      pendingCount: 1,
      failedCount: 0,
      terminalFailedCount: 0,
      retryableCount: 1,
    });

    await expect(runSyncOnce({
      workspaceId: DEFAULT_WORKSPACE_ID,
      provider,
      now: "2026-08-07T09:02:00.000Z",
    })).resolves.toMatchObject({ status: "synced", eventCount: 1 });
    await expect(getSyncStatusSnapshot()).resolves.toMatchObject({
      syncedCount: 2,
      failedCount: 0,
      retryableCount: 0,
    });
    expect(store.snapshot()).toMatchObject({ eventCount: 2, entityCount: 2 });
  });
});
