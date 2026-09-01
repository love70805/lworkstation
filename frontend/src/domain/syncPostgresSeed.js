import {
  CLOUD_SEED_IMPORT_ACK_FORMAT,
  CLOUD_SEED_IMPORT_VERSION,
  CLOUD_SEED_PREFLIGHT_FORMAT,
  inspectCloudSeedRelations,
} from "./cloudSeedImportContract.js";
import { buildCloudSeedPostgresPlan } from "./cloudSeedPostgresPlan.js";

const TEXT_ID_TABLES = Object.freeze([
  ["products", "products"],
  ["platformSkus", "platform_skus"],
  ["supplierOffers", "supplier_offers"],
  ["catalogManualCosts", "catalog_manual_costs"],
  ["captures", "captures"],
  ["ledgers", "ledgers"],
  ["importBatches", "import_batches"],
  ["erpCostRequests", "erp_cost_requests"],
  ["erpCostBatches", "erp_cost_batches"],
  ["costApprovals", "cost_approvals"],
]);

const IDENTITY_SEED_TABLES = new Set(["salesRows", "erpCostRows", "profitLines"]);

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function seedRows(seed, tableName) {
  return seed.tables?.[tableName] ?? [];
}

function identity(row, tableName) {
  return String(tableName === "auditEvents" ? row.eventId ?? row.id : row.id ?? "").trim();
}

async function workspaceVersion(client, workspaceId) {
  const result = await client.query("select max(created_at) as latest_created_at, count(*)::text as event_count from public.audit_events where workspace_id = $1", [workspaceId]);
  const row = result?.rows?.[0] ?? {};
  const latest = row.latest_created_at instanceof Date ? row.latest_created_at.toISOString() : String(row.latest_created_at ?? "");
  return `${latest}:${row.event_count ?? "0"}`;
}

async function existingConflicts(client, seed, workspaceId) {
  const conflicts = [];
  for (const [seedName, tableName] of TEXT_ID_TABLES) {
    const ids = seedRows(seed, seedName).map((row) => identity(row, seedName)).filter(Boolean);
    if (ids.length === 0) continue;
    const result = await client.query(`select id::text as id from public.${tableName} where workspace_id = $1 and id::text = any($2::text[])`, [workspaceId, ids]);
    for (const row of result?.rows ?? []) conflicts.push({ table: seedName, identity: String(row.id), kind: "PRIMARY_KEY_CONFLICT" });
  }
  const auditIds = seedRows(seed, "auditEvents").map((row) => identity(row, "auditEvents")).filter(Boolean);
  if (auditIds.length > 0) {
    const result = await client.query("select event_id from public.audit_events where workspace_id = $1 and event_id = any($2::text[])", [workspaceId, auditIds]);
    for (const row of result?.rows ?? []) conflicts.push({ table: "auditEvents", identity: String(row.event_id), kind: "PRIMARY_KEY_CONFLICT" });
  }
  const platformSkus = seedRows(seed, "platformSkus").map((row) => ({ id: identity(row, "platformSkus"), value: String(row.canonicalPlatformSku ?? row.platformSku ?? "").trim() })).filter((row) => row.value);
  if (platformSkus.length > 0) {
    const result = await client.query("select id::text as id, canonical_platform_sku from public.platform_skus where workspace_id = $1 and canonical_platform_sku = any($2::text[])", [workspaceId, platformSkus.map((row) => row.value)]);
    const byValue = new Map(platformSkus.map((row) => [row.value, row.id]));
    for (const row of result?.rows ?? []) if (byValue.get(String(row.canonical_platform_sku)) !== String(row.id)) conflicts.push({ table: "platformSkus", identity: byValue.get(String(row.canonical_platform_sku)), kind: "PLATFORM_SKU_CONFLICT", existingIdentity: String(row.id) });
  }
  const ledgers = seedRows(seed, "ledgers").map((row) => ({ id: identity(row, "ledgers"), period: row.period, type: row.type ?? "monthly_profit" }));
  if (ledgers.length > 0) {
    const result = await client.query("select id::text as id, period, type from public.ledgers where workspace_id = $1", [workspaceId]);
    const byPeriod = new Map(ledgers.map((row) => [`${row.period}\u001f${row.type}`, row.id]));
    for (const row of result?.rows ?? []) if (byPeriod.has(`${row.period}\u001f${row.type ?? "monthly_profit"}`) && byPeriod.get(`${row.period}\u001f${row.type ?? "monthly_profit"}`) !== String(row.id)) conflicts.push({ table: "ledgers", identity: byPeriod.get(`${row.period}\u001f${row.type ?? "monthly_profit"}`), kind: "LEDGER_PERIOD_CONFLICT", existingIdentity: String(row.id) });
  }
  return conflicts;
}

async function importedSeed(client, workspaceId, fingerprint) {
  const result = await client.query("select seed_fingerprint, import_version, inserted_count, unchanged_count, table_counts from public.cloud_seed_imports where workspace_id = $1 and seed_fingerprint = $2", [workspaceId, fingerprint]);
  return result?.rows?.[0] ?? null;
}

function response({ inspection, fingerprint, preflightId, workspaceVersionValue, conflicts, idempotent, insertedCount, unchangedCount = 0 }) {
  return {
    format: CLOUD_SEED_PREFLIGHT_FORMAT,
    formatVersion: CLOUD_SEED_IMPORT_VERSION,
    workspaceId: inspection.workspaceId,
    seedFingerprint: fingerprint,
    preflightId,
    workspaceVersion: workspaceVersionValue,
    canImport: conflicts.length === 0,
    idempotent,
    recordCount: inspection.recordCount,
    insertCount: insertedCount,
    unchangedCount,
    conflictCount: conflicts.length,
    conflicts: conflicts.slice(0, 100),
  };
}

async function inspect(client, seed) {
  const inspection = inspectCloudSeedRelations(seed);
  const workspaceId = requiredText(inspection.workspaceId, "种子包工作区");
  const existing = await importedSeed(client, workspaceId, inspection.fingerprint);
  const version = await workspaceVersion(client, workspaceId);
  const conflicts = existing ? [] : await existingConflicts(client, seed, workspaceId);
  const insertedCount = existing ? 0 : Math.max(0, inspection.recordCount - conflicts.length);
  return { inspection, workspaceId, existing, version, conflicts, insertedCount };
}

export async function postgresSeedPreflight(seed, { client, context = {}, authorize = () => true } = {}) {
  const inspection = inspectCloudSeedRelations(seed);
  if (!(await authorize({ workspaceId: inspection.workspaceId, actor: context.actor, token: context.token, operation: "preflight" }))) {
    const error = new Error("当前用户无权迁移该工作区。");
    error.code = "WORKSPACE_FORBIDDEN";
    error.status = 403;
    throw error;
  }
  await client.query("begin isolation level repeatable read read only");
  try {
    const report = await inspect(client, seed);
    const preflightId = `seed-${report.inspection.fingerprint}-v${report.version}`;
    await client.query("commit");
    return response({ inspection: report.inspection, fingerprint: report.inspection.fingerprint, preflightId, workspaceVersionValue: report.version, conflicts: report.conflicts, idempotent: Boolean(report.existing), insertedCount: report.insertedCount, unchangedCount: report.existing ? report.existing.unchanged_count ?? report.inspection.recordCount : 0 });
  } catch (error) {
    try { await client.query("rollback"); } catch { /* preserve original failure */ }
    throw error;
  }
}

export async function postgresSeedCommit(seed, { client, context = {}, authorize = () => true } = {}) {
  const inspection = inspectCloudSeedRelations(seed);
  if (!(await authorize({ workspaceId: inspection.workspaceId, actor: context.actor, token: context.token, operation: "import" }))) {
    const error = new Error("当前用户无权迁移该工作区。");
    error.code = "WORKSPACE_FORBIDDEN";
    error.status = 403;
    throw error;
  }
  const actor = requiredText(context.actor, "迁移管理员 userId");
  await client.query("begin");
  try {
    const report = await inspect(client, seed);
    if (report.existing) {
      await client.query("commit");
      return {
        format: CLOUD_SEED_IMPORT_ACK_FORMAT,
        formatVersion: CLOUD_SEED_IMPORT_VERSION,
        workspaceId: inspection.workspaceId,
        seedFingerprint: inspection.fingerprint,
        importVersion: report.existing.import_version,
        insertedCount: Number(report.existing.inserted_count ?? 0),
        unchangedCount: Number(report.existing.unchanged_count ?? 0),
        tableCounts: report.existing.table_counts ?? {},
        idempotent: true,
      };
    }
    const expectedPreflightId = `seed-${inspection.fingerprint}-v${report.version}`;
    if (String(context.preflightId ?? "") !== expectedPreflightId) {
      const error = new Error("导入前必须完成与当前种子包一致的预检，或预检已经过期。");
      error.code = "PREFLIGHT_STALE";
      error.status = 409;
      error.retryable = true;
      throw error;
    }
    if (report.conflicts.length > 0) {
      const error = new Error("种子包与云端数据存在冲突，未执行任何写入。");
      error.code = "SEED_CONFLICT";
      error.status = 409;
      error.conflicts = report.conflicts.slice(0, 100);
      throw error;
    }
    const plan = await buildCloudSeedPostgresPlan(seed, { workspaceMember: { userId: actor, role: "admin" } });
    for (const operation of plan.operations) await client.query(operation.text, operation.values);
    const importVersion = `seed-${Date.now()}`;
    const tableCounts = Object.fromEntries(Object.entries(seed.tables).map(([name, rows]) => [name, rows.length]));
    await client.query("insert into public.cloud_seed_imports (workspace_id, seed_fingerprint, import_version, inserted_count, unchanged_count, table_counts, created_at) values ($1, $2, $3, $4, $5, $6::jsonb, $7)", [inspection.workspaceId, inspection.fingerprint, importVersion, report.insertedCount, 0, JSON.stringify(tableCounts), new Date().toISOString()]);
    await client.query("commit");
    return { format: CLOUD_SEED_IMPORT_ACK_FORMAT, formatVersion: CLOUD_SEED_IMPORT_VERSION, workspaceId: inspection.workspaceId, seedFingerprint: inspection.fingerprint, importVersion, insertedCount: report.insertedCount, unchangedCount: 0, tableCounts, idempotent: false };
  } catch (error) {
    try { await client.query("rollback"); } catch { /* preserve original failure */ }
    throw error;
  }
}

export const postgresSeedRepository = Object.freeze({ preflight: postgresSeedPreflight, commit: postgresSeedCommit });
