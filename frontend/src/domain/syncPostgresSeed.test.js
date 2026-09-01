import { describe, expect, it, vi } from "vitest";
import { buildCloudSeedPayload } from "./cloudSeed";
import { postgresSeedCommit, postgresSeedPreflight } from "./syncPostgresSeed";

const workspaceId = "workspace-seed";
const createdAt = "2026-08-08T00:00:00.000Z";

function seed() {
  return buildCloudSeedPayload({
    format: "shopeers-local-backup", formatVersion: 1, workspaceId, databaseVersion: 7,
    tables: {
      workspaces: [{ id: workspaceId, name: "种子工作区", defaultCurrency: "CNY", createdAt, updatedAt: createdAt }],
      products: [], platformSkus: [], supplierOffers: [], captures: [], ledgers: [], importBatches: [], salesRows: [],
      erpCostRequests: [], erpCostBatches: [], erpCostRows: [], costApprovals: [], profitLines: [], auditEvents: [], settings: [],
    },
  });
}

function client({ imported = false, stale = false } = {}) {
  const calls = [];
  const query = vi.fn(async (text, values) => {
    calls.push({ text, values });
    if (text.startsWith("begin") || text === "commit" || text === "rollback") return { rows: [] };
    if (text.startsWith("select seed_fingerprint")) return { rows: imported ? [{ seed_fingerprint: values[1], import_version: "seed-1", inserted_count: 1, unchanged_count: 0, table_counts: {} }] : [] };
    if (text.startsWith("select max(created_at)")) return { rows: [{ latest_created_at: stale ? "2026-08-08T00:00:02.000Z" : null, event_count: stale ? "1" : "0" }] };
    if (text.startsWith("select id::text")) return { rows: [] };
    if (text.startsWith("select event_id")) return { rows: [] };
    if (text.startsWith("select id::text as id, canonical")) return { rows: [] };
    if (text.startsWith("select id::text as id, period")) return { rows: [] };
    return { rows: [] };
  });
  return { query, calls };
}

describe("postgres seed repository", () => {
  it("creates a repeatable-read preflight with a deterministic version", async () => {
    const db = client();
    const result = await postgresSeedPreflight(seed(), { client: db, authorize: () => true });
    expect(result).toMatchObject({ format: "shopeers-cloud-seed-preflight", workspaceId, canImport: true, insertCount: 1 });
    expect(result.preflightId).toContain(result.seedFingerprint);
    expect(db.calls[0].text).toContain("repeatable read");
    expect(db.calls.at(-1).text).toBe("commit");
  });

  it("returns the prior import without writing on an identical retry", async () => {
    const db = client({ imported: true });
    const result = await postgresSeedCommit(seed(), { client: db, context: { actor: "user-1", preflightId: "ignored" }, authorize: () => true });
    expect(result).toMatchObject({ idempotent: true, importVersion: "seed-1" });
    expect(db.calls.some(({ text }) => text.startsWith("insert into public.workspaces"))).toBe(false);
    expect(db.calls.at(-1).text).toBe("commit");
  });

  it("requires an administrator actor and rolls back stale preflight", async () => {
    const db = client({ stale: true });
    await expect(postgresSeedCommit(seed(), { client: db, context: { actor: "user-1", preflightId: "wrong" }, authorize: () => true })).rejects.toMatchObject({ code: "PREFLIGHT_STALE", status: 409 });
    expect(db.calls.at(-1).text).toBe("rollback");
  });
});
