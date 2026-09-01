import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildCloudSeedPayload,
} from "../frontend/src/domain/cloudSeed.js";
import {
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_BACKUP_VERSION,
} from "../frontend/src/domain/workspaceBackup.js";
import { buildSyncEnvelope } from "../frontend/src/domain/syncEnvelope.js";

const root = dirname(fileURLToPath(import.meta.url));
const workspaceId = "workspace-smoke";
const token = "shopeers-smoke-token";
const port = Number(process.env.SHOPEERS_SYNC_SMOKE_PORT || 8878);
const baseUrl = `http://127.0.0.1:${port}`;
const serverPath = join(root, "sync-dev-server.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { method = "GET", body, auth = token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  return { response, payload };
}

function buildSmokeSeed() {
  return buildCloudSeedPayload({
    format: WORKSPACE_BACKUP_FORMAT,
    formatVersion: WORKSPACE_BACKUP_VERSION,
    applicationVersion: "0.1.0",
    workspaceId,
    databaseVersion: 7,
    currency: "CNY",
    generatedAt: "2026-08-07T00:00:00.000Z",
    tables: {
      workspaces: [{
        id: workspaceId,
        workspaceId,
        name: "同步自检工作区",
        defaultCurrency: "CNY",
      }],
    },
  }, { generatedAt: "2026-08-07T00:00:01.000Z" });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { response, payload } = await request("/health", { auth: null });
      if (response.ok && payload.status === "ok") return payload;
    } catch {
      // The child process may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("同步开发服务在 4 秒内未完成健康检查。");
}

const child = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    SHOPEERS_SYNC_PORT: String(port),
    SHOPEERS_SYNC_TOKEN: token,
    SHOPEERS_SYNC_ROLE: "admin",
    SHOPEERS_SYNC_WORKSPACES: workspaceId,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  const health = await waitForHealth();
  assert(health.eventCount === 0, "自检服务启动时不应包含旧审计事件。");

  const envelope = buildSyncEnvelope({
    workspaceId,
    events: [{
      eventId: "smoke-event-1",
      objectType: "product",
      objectId: "PRODUCT-SMOKE-1",
      action: "product_created",
      actorId: "smoke-test",
      createdAt: "2026-08-07T00:00:02.000Z",
      after: {
        snapshot: {
          product: {
            id: "PRODUCT-SMOKE-1",
            workspaceId,
            name: "同步自检商品",
            status: "active",
            currency: "CNY",
          },
          platformSkus: [],
          supplierOffers: [],
        },
      },
    }],
  });

  const firstSync = await request("/sync/v1/audit-events", { method: "POST", body: envelope });
  assert(firstSync.response.ok, `审计事件首次同步失败：${JSON.stringify(firstSync.payload)}`);
  assert(firstSync.payload.eventIds?.includes("smoke-event-1"), "审计同步回执未确认事件 ID。");

  const repeatedSync = await request("/sync/v1/audit-events", { method: "POST", body: envelope });
  assert(repeatedSync.response.ok, `审计事件重复同步不应失败：${JSON.stringify(repeatedSync.payload)}`);

  const unauthorized = await request("/sync/v1/audit-events", {
    method: "POST",
    body: envelope,
    auth: "wrong-token",
  });
  assert(unauthorized.response.status === 403, "错误令牌必须被拒绝。");

  const recovery = await request(`/sync/v1/workspaces/${workspaceId}/recovery`);
  assert(recovery.response.ok, `同步恢复包下载失败：${JSON.stringify(recovery.payload)}`);
  assert(recovery.payload.format === "shopeers-sync-recovery", "同步恢复包格式无效。");
  assert(recovery.payload.events?.[0]?.eventId === "smoke-event-1", "同步恢复包缺少已上传事件。");

  const unauthorizedRecovery = await request(`/sync/v1/workspaces/${workspaceId}/recovery`, { auth: "wrong-token" });
  assert(unauthorizedRecovery.response.status === 403, "错误令牌必须不能下载恢复包。");

  const seed = buildSmokeSeed();
  const preflight = await request("/sync/v1/cloud-seeds/preflight", { method: "POST", body: seed });
  assert(preflight.response.ok && preflight.payload.canImport, `种子包预检失败：${JSON.stringify(preflight.payload)}`);
  assert(preflight.payload.insertCount === 1, "种子包预检应识别 1 条工作区记录。");

  const committed = await request("/sync/v1/cloud-seeds/import", {
    method: "POST",
    body: { seed, preflightId: preflight.payload.preflightId },
  });
  assert(committed.response.ok && committed.payload.insertedCount === 1, `种子包导入失败：${JSON.stringify(committed.payload)}`);

  const repeatedCommit = await request("/sync/v1/cloud-seeds/import", {
    method: "POST",
    body: { seed, preflightId: preflight.payload.preflightId },
  });
  assert(repeatedCommit.response.ok && repeatedCommit.payload.idempotent === true, "重复导入应返回幂等回执。");

  const seededRecovery = await request(`/sync/v1/workspaces/${workspaceId}/recovery`);
  assert(seededRecovery.response.ok, `带种子基线的恢复包下载失败：${JSON.stringify(seededRecovery.payload)}`);
  assert(seededRecovery.payload.baseline?.tables?.workspaces?.[0]?.id === workspaceId, "恢复包缺少已导入的云端种子基线。");

  console.log(JSON.stringify({
    status: "ok",
    checks: ["health", "audit_sync", "audit_idempotency", "authorization", "recovery_download", "recovery_authorization", "seed_preflight", "seed_import", "seed_idempotency", "seeded_recovery"],
    eventCount: 1,
    insertedSeedCount: committed.payload.insertedCount,
  }, null, 2));
} catch (error) {
  console.error(error.message);
  if (output.trim()) console.error(output.trim());
  process.exitCode = 1;
} finally {
  child.kill();
}
