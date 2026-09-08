import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, DEFAULT_WORKSPACE_ID, previewSalesImports, saveSalesImports, saveSalesImport, createWorkspaceBackupPayload, restoreWorkspaceBackupPayload } from "./database";
import { validateSalesRows } from "../lib/salesImport";
import { summarizeLedgerRows } from "../domain/ledgerImport";
import { buildSyncRecoveryPayload, replaySyncRecoveryPayload } from "../domain/syncRecovery";

const period = "2026-08";
const mapping = { platformSku: "SKU", platformSkc: "SKC", quantity: "数量", amount: "金额", directPenalty: "罚款" };
function file(storeName, amount = 10, options = {}) {
  const raw = options.raw ?? [{ SKU: "000123", SKC: "父商品", 数量: "2", 金额: String(amount), 罚款: "1.239" }];
  const validated = validateSalesRows(raw, mapping, { defaultStore: storeName });
  return { itemId: storeName, fileName: `${storeName}.csv`, fileHash: `${storeName}-${amount}`, storeName, mapping,
    rows: validated.rows, summary: { sourceRowCount: raw.length, errorCount: validated.errors.length, ignoredCount: validated.ignored.length }, ...options };
}
async function commit(items, overrides = {}) {
  const input = { period, items, ...overrides };
  const preview = await previewSalesImports(input);
  return saveSalesImports({ ...input, preview, overwriteSignature: preview.targetSignature });
}
async function facts() {
  return { ledgers: await db.ledgers.toArray(), batches: await db.importBatches.toArray(), rows: await db.salesRows.toArray(), audits: await db.auditEvents.toArray() };
}
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { vi.restoreAllMocks(); db.close(); await db.delete(); });

describe("同月多店铺原子台账导入", () => {
  it("keeps a global SKU distinct across stores and records each source with final monthly totals", async () => {
    const result = await commit([file("甲店", 10.129), file("乙店", 20.129)]);
    expect(result.items.map((item) => item.status)).toEqual(["imported", "imported"]);
    expect(result.finalSummary).toMatchObject({ groupCount: 2, skuLineCount: 2, quantity: 4, revenue: 30.24, penalty: 2.46 });
    const state = await facts();
    expect(state.rows.map((row) => row.platformSku)).toEqual(["000123", "000123"]);
    expect(new Set(state.rows.map((row) => row.groupKey)).size).toBe(2);
    expect(state.batches).toHaveLength(2);
    expect(state.rows.every((row) => row.batchId && row.sourceRow === 2)).toBe(true);
    const events = state.audits.filter((event) => event.action === "imported");
    expect(events).toHaveLength(2);
    events.forEach((event) => expect(event.after.snapshot.ledger.summary).toEqual(result.finalSummary));
    expect(state.batches.find((batch) => batch.store === "甲店")).toMatchObject({ fileHash: "甲店-10.129", mapping, period, store: "甲店" });
  });

  it("makes concurrent clicks, successful retries and fresh duplicate previews no-ops", async () => {
    const input = { period, items: [file("甲店"), file("乙店", 20)] };
    const preview = await previewSalesImports(input);
    const results = await Promise.all([saveSalesImports({ ...input, preview }), saveSalesImports({ ...input, preview })]);
    expect(results.flatMap((result) => result.items).filter((item) => item.status === "imported")).toHaveLength(2);
    const before = await facts();
    expect((await saveSalesImports({ ...input, preview })).items.every((item) => item.status === "skipped_duplicate")).toBe(true);
    expect((await previewSalesImports(input)).summary.revenue).toBe(0);
    expect(await facts()).toEqual(before);
  });

  it("rejects same-store assignment, same bytes across stores, missing mapping, error and zero rows", async () => {
    const cases = [
      [file("甲店"), file(" 甲店 ", 20)],
      [file("甲店"), file("乙店", 20, { fileHash: "甲店-10" })],
      [file("甲店", 10, { mapping: {} })],
      [file("甲店", 10, { summary: { errorCount: 1 } })],
      [file("甲店", 10, { rows: [] })],
      [file("甲店", 10, { rows: file("乙店").rows })],
    ];
    for (const items of cases) await expect(previewSalesImports({ period, items })).rejects.toThrow();
    expect(await db.ledgers.count()).toBe(0);
    await commit([file("甲店")]);
    await expect(previewSalesImports({ period, items: [file("乙店", 10, { fileHash: "甲店-10" })] })).rejects.toThrow("不同店铺");
  });

  it("only replaces explicitly previewed overlapping groups, retaining unrelated groups and stores", async () => {
    const old = file("甲店", 10, { raw: [{ SKU: "000123", SKC: "父商品", 数量: 2, 金额: 10 }, { SKU: "000456", SKC: "保留商品", 数量: 1, 金额: 7 }] });
    await commit([old, file("乙店", 20)]);
    const input = { period, items: [file("甲店", 30)] };
    const preview = await previewSalesImports(input);
    expect(preview.items[0].overlaps[0]).toMatchObject({ before: { rowCount: 1, revenue: 10 }, after: { rowCount: 1, revenue: 30 } });
    const before = await facts();
    await expect(saveSalesImports({ ...input, preview })).rejects.toThrow("覆盖范围");
    expect(await facts()).toEqual(before);
    await saveSalesImports({ ...input, preview, overwriteSignature: preview.targetSignature });
    expect(summarizeLedgerRows(await db.salesRows.toArray()).revenue).toBe(57);
    expect((await previewSalesImports({ period, items: [old] })).items[0].status).toBe("ready");
  });

  it("does not mistake changed filters or mappings for a duplicate", async () => {
    const item = file("甲店"); await commit([item]);
    for (const change of [{ filterOptions: { supplierNumbers: [] } }, { mapping: { ...mapping, orderId: "订单" } }]) {
      expect((await previewSalesImports({ period, items: [{ ...item, ...change }] })).items[0].status).toBe("ready");
    }
  });

  it("binds approval to input and target snapshots and rejects finalization after preview", async () => {
    await commit([file("甲店")]);
    const input = { period, items: [file("甲店", 30)] };
    const preview = await previewSalesImports(input);
    await expect(saveSalesImports({ ...input, items: [file("甲店", 40)], preview, overwriteSignature: preview.targetSignature })).rejects.toThrow("配置已变化");
    await commit([file("乙店", 20)]);
    const before = await facts();
    await expect(saveSalesImports({ ...input, preview, overwriteSignature: preview.targetSignature })).rejects.toThrow("预览已过期");
    expect(await facts()).toEqual(before);
    const fresh = await previewSalesImports(input);
    await db.ledgers.update(fresh.ledgerId, { status: "finalized" });
    await expect(saveSalesImports({ ...input, preview: fresh, overwriteSignature: fresh.targetSignature })).rejects.toThrow("定稿");
  });

  it.each([false, true])("rolls back every row, batch, ledger and audit when the second file fails (existing=%s)", async (existing) => {
    if (existing) await commit([file("甲店")]);
    const input = { period, items: [file("甲店", 30), file("乙店", 20)] };
    const preview = await previewSalesImports(input);
    const before = await facts();
    const realAdd = db.auditEvents.add.bind(db.auditEvents);
    let imported = 0;
    vi.spyOn(db.auditEvents, "add").mockImplementation((event) => {
      if (event.action === "imported" && ++imported === 2) throw new Error("synthetic failure");
      return realAdd(event);
    });
    await expect(saveSalesImports({ ...input, preview, overwriteSignature: preview.targetSignature })).rejects.toThrow("synthetic failure");
    expect(await facts()).toEqual(before);
  });

  it("replays existing imported envelopes and restores backups without schema changes", async () => {
    await commit([file("甲店"), file("乙店", 20)]);
    const result = await commit([file("甲店", 30), file("丙店", 40)]);
    const state = await facts();
    const events = state.audits.filter((event) => event.action === "imported");
    const replay = replaySyncRecoveryPayload(buildSyncRecoveryPayload({ workspaceId: DEFAULT_WORKSPACE_ID, events }));
    expect(summarizeLedgerRows(replay.tables.salesRows)).toEqual(result.finalSummary);
    expect(replay.tables.ledgers[0].summary).toEqual(result.finalSummary);
    const backup = await createWorkspaceBackupPayload();
    await restoreWorkspaceBackupPayload(backup);
    expect(await db.salesRows.toArray()).toEqual(state.rows);
    expect((await previewSalesImports({ period, items: [file("甲店", 30)] })).items[0].status).toBe("skipped_duplicate");
  });

  it("retains the legacy single-file API and return shape", async () => {
    const result = await saveSalesImport({ ...file("甲店"), period });
    expect(result).toMatchObject({ batchId: expect.any(String), ledgerId: expect.any(String), addedGroupCount: 1, replacedGroupCount: 0 });
    expect((await previewSalesImports({ period, items: [file("甲店")] })).items[0].status).toBe("skipped_duplicate");
  });
});
