// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createClaimsAuthorizer, createPostgresMembershipResolver } from "./cloudJwtAuthorization.js";
import { buildSyncEnvelope } from "./syncEnvelope.js";
import { applySyncEnvelopeWithPostgresClient } from "./syncPostgresPlan.js";
import { loadPostgresRecovery } from "./syncPostgresRecovery.js";

const actors = Object.fromEntries(["admin", "selection", "other", "viewer", "operations", "finance", "invited"]
  .map((role, i) => [role, `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`]));
const createdAt = "2026-09-07T00:00:00.000Z";
let db;
let client;
let authorize;
let eventSequence = 0;

function product(id, { workspaceId = "w1", visibility = "workspace", ownerId = actors.selection } = {}) {
  return { product: { id, workspaceId, name: `商品-${id}`, ownerId, visibility, currency: "CNY", createdAt },
    platformSkus: [], supplierOffers: [] };
}

function event(action, objectId, snapshot, actor = "selection", objectType = "product") {
  return { eventId: `E-${++eventSequence}`, workspaceId: "w1", actorId: actors[actor], objectType,
    objectId, action, createdAt, after: snapshot == null ? null : { snapshot } };
}

function submit(events, actor = "selection") {
  return applySyncEnvelopeWithPostgresClient(buildSyncEnvelope({ workspaceId: "w1", events, generatedAt: createdAt }), {
    client, authorize, context: { actor: actors[actor], token: actors[actor] }, now: () => createdAt,
  });
}

async function asAuthenticated(actor, fn) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actors[actor]]);
  await db.exec("set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); }
}

async function seedAudit(id, { action = "product_updated", objectType = "product", objectId = "private",
  before = null, after = null } = {}) {
  await db.query(`insert into public.audit_events
    (workspace_id,event_id,object_type,object_id,action,actor_id,before_snapshot,after_snapshot,content_hash,created_at)
    values ('w1',$1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`,
  [id, objectType, objectId, action, actors.other, JSON.stringify(before), JSON.stringify(after), `hash-${id}`, createdAt]);
}

describe("security against a real PostgreSQL engine", () => {
  beforeAll(async () => {
    db = await PGlite.create();
    // Supabase supplies these roles and auth.uid in production. All application
    // tables, policies, functions and triggers are the unmodified real migrations.
    await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      grant usage on schema public, auth to authenticated;`);
    const migrations = new URL("../../supabase/migrations/", import.meta.url);
    for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(filename, migrations), "utf8"));
    }
    // Model Supabase's normal table grants without undoing the audit insert revoke.
    await db.exec("grant select, update, delete on all tables in schema public to authenticated");
    await db.exec("grant insert on public.products to authenticated");
    client = { query: async (sql, params) => {
      const result = await db.query(sql, params);
      return { ...result, rowCount: result.affectedRows || result.rows.length };
    } };
    authorize = createClaimsAuthorizer({
      verifyToken: async (token) => ({ sub: token, user_metadata: { workspaceRole: "admin" } }),
      resolveMembership: createPostgresMembershipResolver(client),
    });
  }, 30_000);

  afterAll(async () => { await db?.close(); });

  beforeEach(async () => {
    await db.exec("truncate public.workspaces cascade; insert into public.workspaces(id,name) values ('w1','安全测试'),('w2','其他工作区')");
    for (const [label, actor] of Object.entries(actors)) {
      await db.query("insert into public.workspace_members(workspace_id,user_id,role,status) values ('w1',$1,$2,$3)",
        [actor, label === "other" ? "selection" : label === "invited" ? "admin" : label, label === "invited" ? "invited" : "active"]);
    }
    await db.query(`insert into public.products(id,workspace_id,name,visibility,owner_id) values
      ('shared','w1','共享商品','workspace',$1),('private','w1','别人的私有商品','private',$2),
      ('owned','w1','我的私有商品','private',$1),('cross','w2','跨工作区商品','workspace',$1)`,
    [actors.selection, actors.other]);
  });

  it("rejects the reproduced viewer deletion and all missing authorization mappings without writes", async () => {
    const attempts = [
      event("product_deleted", "shared", null, "viewer"),
      event("product_merged", "shared", product("shared"), "viewer"),
      event("catalog_manual_cost_confirmed", "cost", { catalogManualCost: { id: "cost" } }, "viewer", "catalog_manual_cost"),
      event("catalog_manual_cost_relinked", "cost", { catalogManualCost: { id: "cost" } }, "viewer", "catalog_manual_cost"),
      event("capture_product_relinked", "cap", { id: "cap" }, "viewer", "capture"),
      event("selection_status_definitions_updated", "w1", { id: "w1", createdAt }, "viewer", "workspace"),
    ];
    for (const attempt of attempts) await expect(submit([attempt], "viewer")).rejects.toMatchObject({ status: 403 });
    expect((await db.query("select count(*)::int as n from public.products")).rows[0].n).toBe(4);
    expect((await db.query("select count(*)::int as n from public.audit_events")).rows[0].n).toBe(0);
  });

  it("denies unknown actions, actor forgery, invited membership, and client-controlled admin claims", async () => {
    await expect(submit([event("unknown_business_action", "shared", null, "admin")], "admin")).rejects.toMatchObject({ status: 403 });
    await expect(submit([event("product_deleted", "shared", null, "admin")], "viewer")).rejects.toMatchObject({ status: 403 });
    await expect(submit([event("product_deleted", "shared", null, "invited")], "invited")).rejects.toMatchObject({ status: 403 });
  });

  it("blocks other-owner and cross-workspace objects even through the RLS-bypassing sync connection", async () => {
    for (const id of ["private", "cross"]) {
      await expect(submit([event("product_deleted", id)])).rejects.toMatchObject({ status: 403 });
      await expect(submit([event("product_updated", id, product(id))])).rejects.toMatchObject({ status: 403 });
    }
    const safe = event("product_updated", "shared", product("shared"));
    await expect(submit([safe, event("product_deleted", "private")])).rejects.toMatchObject({ status: 403 });
    expect((await db.query("select name from public.products where id='shared'")).rows[0].name).toBe("共享商品");
    expect((await db.query("select count(*)::int as n from public.audit_events")).rows[0].n).toBe(0);
  });

  it("preserves authorized selection merges, deletes, admin writes and replay hashes", async () => {
    const events = [event("product_deleted", "owned"), event("product_merged", "shared", product("shared"))];
    expect(await submit(events)).toMatchObject({ insertedEventCount: 2, transaction: "committed" });
    expect(await submit(events)).toMatchObject({ insertedEventCount: 0, replayedEventCount: 2 });
    expect((await db.query("select id from public.products where id='owned'")).rows).toHaveLength(0);
    await expect(submit([event("product_updated", "private", product("private", { visibility: "private", ownerId: actors.other }), "admin")], "admin"))
      .resolves.toMatchObject({ insertedEventCount: 1 });
  });

  it("allows admin workspace settings and owner captures, denying forged private destinations", async () => {
    const settings = { id: "w1", name: "安全测试", selectionStatusDefinitions: [], createdAt };
    await expect(submit([event("selection_status_definitions_updated", "w1", settings, "selection", "workspace")])).rejects.toMatchObject({ status: 403 });
    await expect(submit([event("selection_status_definitions_updated", "w1", settings, "admin", "workspace")], "admin")).resolves.toMatchObject({ insertedEventCount: 1 });
    const capture = { id: "cap", requestId: "request", status: "draft", capturedAt: createdAt,
      draft: { ownerId: actors.selection, visibility: "private" } };
    await expect(submit([event("capture_created", "cap", capture, "selection", "capture")])).resolves.toMatchObject({ insertedEventCount: 1 });
    await expect(submit([event("capture_draft_saved", "cap", { ...capture, draft: { ...capture.draft, ownerId: actors.other } }, "selection", "capture")])).rejects.toMatchObject({ status: 403 });
    await expect(submit([event("capture_product_relinked", "cap", { ...capture, confirmedProductId: "private" }, "selection", "capture")])).rejects.toMatchObject({ status: 403 });
  });

  it("checks manual-cost parent ownership and SKU parent identity, preserving valid reference costs", async () => {
    await db.exec(`insert into public.platform_skus(id,workspace_id,product_id,platform_sku,canonical_platform_sku)
      values ('own-sku','w1','owned','OWN-SKU','OWN-SKU'),('private-sku','w1','private','PRIVATE-SKU','PRIVATE-SKU')`);
    const cost = { id: "cost", productId: "owned", platformSkuId: "own-sku", platformSku: "OWN-SKU",
      canonicalPlatformSku: "OWN-SKU", amount: 12.34, confirmedAt: createdAt, confirmedBy: actors.selection };
    await expect(submit([event("catalog_manual_cost_confirmed", "cost", { catalogManualCost: cost }, "selection", "catalog_manual_cost")])).resolves.toMatchObject({ insertedEventCount: 1 });
    for (const change of [
      { productId: "private", platformSkuId: "private-sku", canonicalPlatformSku: "PRIVATE-SKU" },
      { platformSkuId: "private-sku", canonicalPlatformSku: "PRIVATE-SKU" },
    ]) await expect(submit([event("catalog_manual_cost_relinked", "cost", { catalogManualCost: { ...cost, ...change } }, "selection", "catalog_manual_cost")])).rejects.toMatchObject({ status: 403 });
    expect((await db.query("select product_id,amount from public.catalog_manual_costs")).rows).toEqual([{ product_id: "owned", amount: "12.340000" }]);
  });

  it("filters private history, deleted private snapshots, ownership transitions, and nested references on recovery AND direct RLS reads", async () => {
    const hidden = ["private-current", "deleted-private", "private-before", "nested-refs", "bulk-refs"];
    await seedAudit(hidden[0], { after: { snapshot: { product: { id: "private", name: "历史共享名称", visibility: "workspace" } } } });
    await seedAudit(hidden[1], { action: "product_deleted", objectId: "gone", before: { snapshot: { id: "gone", name: "已删除私有内容", visibility: "private", ownerId: actors.other } } });
    await seedAudit(hidden[2], { objectId: "shared", before: { snapshot: { product: product("gone", { visibility: "private", ownerId: actors.other }).product } } });
    await seedAudit(hidden[3], { action: "catalog_manual_cost_confirmed", objectId: "old-cost", objectType: "catalog_manual_cost", after: { snapshot: { catalogManualCost: { productId: "private", amount: 888 } } } });
    await seedAudit(hidden[4], { objectType: "products", objectId: "bulk", action: "product_sales_status_bulk_updated", after: { productIds: ["shared", "private"] } });
    await seedAudit("shared-safe", { objectId: "shared", after: { snapshot: product("shared") } });
    await seedAudit("finance-fact", { objectType: "monthly_ledger", objectId: "ledger", action: "finalized", after: { profit: 18 } });
    for (const role of ["selection", "viewer", "other", "admin", "operations", "finance"]) {
      const recovery = await loadPostgresRecovery("w1", { client, context: { actor: actors[role], role: role === "other" ? "selection" : role } });
      const ids = recovery.baseline.tables.auditEvents.map((row) => row.eventId).sort();
      const direct = await asAuthenticated(role, () => db.query("select event_id from public.audit_events order by event_id"));
      expect(ids).toEqual(direct.rows.map((row) => row.event_id));
      if (["selection", "viewer"].includes(role)) {
        expect(ids).toEqual(["finance-fact", "shared-safe"]);
        expect(JSON.stringify(recovery)).not.toContain("已删除私有内容");
        expect(JSON.stringify(recovery)).not.toContain("别人的私有商品");
      } else expect(ids).toHaveLength(7);
    }
    expect((await db.query("select content_hash from public.audit_events where event_id='deleted-private'")).rows[0].content_hash).toBe("hash-deleted-private");
  });

  it("does not let direct clients forge audits or invoke arbitrary-actor security helpers", async () => {
    await asAuthenticated("viewer", async () => {
      await expect(db.query(`insert into public.audit_events(workspace_id,event_id,object_type,object_id,action,actor_id)
        values ('w1','forged','product','shared','product_deleted',$1)`, [actors.admin])).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("select public.audit_event_visible_to('w1','product_updated','product','private',null,null,$1)", [actors.admin])).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("select public.assert_catalog_sync_access('w1','product_deleted','private','{}',$1)", [actors.admin])).rejects.toMatchObject({ code: "42501" });
      expect((await db.query("delete from public.products where id='shared' returning id")).rows).toHaveLength(0);
    });
    await asAuthenticated("selection", async () => {
      expect((await db.query("delete from public.products where id='private' returning id")).rows).toHaveLength(0);
      expect((await db.query("delete from public.products where id='owned' returning id")).rows).toHaveLength(1);
    });
  });

  it("preserves deletion-time privacy and the owner's history when product and SKU rows no longer exist", async () => {
    const snapshot = product("historical", { ownerId: actors.other });
    const created = event("product_created", "historical", snapshot, "other");
    created.createdAt = "2090-01-01T00:00:00.000Z"; // An old device clock must not outrank the deletion state.
    await submit([created], "other");
    const privateSnapshot = { ...snapshot, product: { ...snapshot.product, visibility: "private" },
      platformSkus: [{ id: "hist-sku", productId: "historical", platformSku: "HIST-SKU", canonicalPlatformSku: "HIST-SKU", createdAt, updatedAt: createdAt }] };
    const privatized = event("product_updated", "historical", privateSnapshot, "other");
    await submit([privatized], "other");
    const deleted = event("product_deleted", "historical", null, "other");
    deleted.before = { snapshot: privateSnapshot.product };
    await submit([deleted], "other");
    for (const role of ["viewer", "selection", "other"]) {
      const direct = await asAuthenticated(role, () => db.query("select event_id from public.audit_events order by id"));
      const recovery = await loadPostgresRecovery("w1", { client, context: { actor: actors[role], role: role === "other" ? "selection" : role } });
      const expected = role === "other" ? [created.eventId, privatized.eventId, deleted.eventId] : [];
      expect(direct.rows.map((row) => row.event_id)).toEqual(expected);
      expect(recovery.baseline.tables.auditEvents.map((row) => row.eventId).sort()).toEqual([...expected].sort());
    }
    expect((await db.query("select count(*)::int as n from public.audit_events")).rows[0].n).toBe(3);
  });

  it("denies private references with missing historical owner metadata instead of treating SQL NULL as permission", async () => {
    await db.exec("insert into public.products(id,workspace_id,name,visibility) values ('ownerless','w1','旧私有记录','private')");
    await seedAudit("ownerless-created", { action: "product_created", objectId: "ownerless",
      after: { snapshot: { product: { id: "ownerless", visibility: "private" } } } });
    await seedAudit("ownerless-bulk", { action: "product_sales_status_bulk_updated", objectType: "products", objectId: "bulk",
      after: { productIds: ["ownerless"] } });
    for (const deleted of [false, true]) {
      if (deleted) await db.exec("delete from public.products where id='ownerless'");
      const result = await asAuthenticated("viewer", () => db.query("select event_id from public.audit_events"));
      expect(result.rows).toEqual([]);
    }
  });

  it("rejects forged empty deletions and deleted-ID reuse, deriving deletion access from the locked database row", async () => {
    const privateSnapshot = product("sealed", { visibility: "private", ownerId: actors.other });
    privateSnapshot.platformSkus = [{ id: "sealed-sku", productId: "sealed", platformSku: "SEALED-SKU", canonicalPlatformSku: "SEALED-SKU", createdAt, updatedAt: createdAt }];
    await submit([event("product_created", "sealed", privateSnapshot, "other")], "other");
    const cost = { id: "sealed-cost", productId: "sealed", platformSkuId: "sealed-sku", platformSku: "SEALED-SKU",
      canonicalPlatformSku: "SEALED-SKU", amount: 777.66, confirmedAt: createdAt, confirmedBy: actors.other };
    await submit([event("catalog_manual_cost_confirmed", cost.id, { catalogManualCost: cost }, "other", "catalog_manual_cost")], "other");
    const deleted = event("product_deleted", "sealed", null, "other");
    deleted.before = { snapshot: { id: "sealed", visibility: "workspace", ownerId: actors.selection } };
    await submit([deleted], "other");
    const forged = event("product_deleted", "sealed");
    forged.before = deleted.before;
    for (const attempt of [forged, event("product_created", "sealed", product("sealed")), event("product_updated", "sealed", product("sealed"))]) {
      await expect(submit([attempt])).rejects.toMatchObject({ status: 403 });
    }
    expect((await db.query("select owner_id, visibility from public.catalog_access_tombstones where entity_id='sealed'")).rows)
      .toEqual([{ owner_id: actors.other, visibility: "private" }]);
    for (const role of ["viewer", "selection", "other"]) {
      const direct = await asAuthenticated(role, () => db.query("select event_id from public.audit_events"));
      const recovery = await loadPostgresRecovery("w1", { client, context: { actor: actors[role], role: role === "other" ? "selection" : role } });
      expect(direct.rows).toHaveLength(role === "other" ? 3 : 0);
      expect(recovery.baseline.tables.auditEvents).toHaveLength(role === "other" ? 3 : 0);
    }
    await asAuthenticated("selection", async () => {
      await expect(db.query("insert into public.products(id,workspace_id,name,visibility) values ('sealed','w1','复用旧标识','workspace')"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(db.query("update public.products set id='sealed' where id='shared'"))
        .rejects.toMatchObject({ code: "42501" });
    });
  });

  it("records authoritative deletion permissions even for direct RLS writes without audit snapshots", async () => {
    await asAuthenticated("selection", async () => {
      await db.query("insert into public.products(id,workspace_id,name,visibility,owner_id) values ('direct','w1','私有记录','private',$1)", [actors.selection]);
      expect((await db.query("delete from public.products where id='direct' returning id")).rows).toHaveLength(1);
      await expect(db.query("insert into public.products(id,workspace_id,name,visibility) values ('direct','w1','复用旧标识','workspace')"))
        .rejects.toMatchObject({ code: "42501" });
      expect((await db.query("select entity_id from public.catalog_access_tombstones")).rows).toEqual([]);
    });
    expect((await db.query("select owner_id,visibility from public.catalog_access_tombstones where entity_id='direct'")).rows)
      .toEqual([{ owner_id: actors.selection, visibility: "private" }]);
  });
});
