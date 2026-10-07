import { createSalesSourceCoverage } from '../domain/selectionSalesLabels';
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, DEFAULT_WORKSPACE_ID, previewSalesImports, saveSalesImports, saveSalesImport, createWorkspaceBackupPayload, restoreWorkspaceBackupPayload, restoreWorkspaceSyncRecoveryPayload } from "./database";
import { validateSalesRows } from "../lib/salesImport";
import { summarizeLedgerRows } from "../domain/ledgerImport";
import { buildSyncRecoveryPayload, replaySyncRecoveryPayload } from "../domain/syncRecovery";
import { createImportStage, appendImportStage, sealImportStage, clearImportStages } from '../lib/salesImportStage';
import { decodeSalesRowsAuditSnapshot, SALES_ROWS_AUDIT_FORMAT, SALES_ROWS_AUDIT_MIN_ROWS } from '../domain/salesRowsAuditSnapshot';

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
function largeFile(storeName, count = SALES_ROWS_AUDIT_MIN_ROWS + 3) {
  const raw = Array.from({ length: count }, (_, index) => ({ SKU: `SKU-${index % 50}`, SKC: '大商品', 数量: '0.123456789123456789', 金额: '12.3456789123456789', 罚款: '0', 业务单号: `00012345678901234567890123456789${index}` }));
  const item = file(storeName, 12.3456789123456789, { raw });
  item.rows.forEach((row, index) => Object.assign(row, {
    orderId: raw[index].业务单号, sourceSheet: '台账变动明细', sourceRow: index + 2,
    rawAddedAt: '2026-08-31 23:59:59', sourceAddedDate: '2026-08-31', sourceAddedAt: '2026-08-31T23:59:59.000+08:00',
    raw: raw[index],
  }));
  return item;
}
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { vi.restoreAllMocks(); db.close(); await db.delete(); });

describe("同月多店铺原子台账导入", () => {
  it('stores one compact audit per large source and roundtrips JSON backups and sync recovery without schema changes', async () => {
    const item = largeFile('大店');
    const result = await commit([item, file('小店')]);
    const state = await facts();
    const events = state.audits.filter(event => event.action === 'imported');
    expect(events).toHaveLength(2);
    const largeAudit = events.find(event => event.after.fileName === item.fileName);
    expect(largeAudit.after.snapshot.salesRows).toMatchObject({ format: SALES_ROWS_AUDIT_FORMAT, version: 1, rowCount: item.rows.length });
    const stored = state.rows.filter(row => row.batchId === largeAudit.objectId);
    expect(decodeSalesRowsAuditSnapshot(largeAudit.after.snapshot.salesRows)).toEqual(stored);
    expect(stored.at(-1)).toMatchObject(item.rows.at(-1));
    expect(Array.isArray(events.find(event => event !== largeAudit).after.snapshot.salesRows)).toBe(true);
    const backup = JSON.parse(JSON.stringify(await createWorkspaceBackupPayload()));
    await restoreWorkspaceBackupPayload(backup);
    expect(await db.salesRows.toArray()).toEqual(state.rows);
    expect(decodeSalesRowsAuditSnapshot((await db.auditEvents.toArray()).find(event => event.id === largeAudit.id).after.snapshot.salesRows)).toEqual(stored);
    const payload = JSON.parse(JSON.stringify(buildSyncRecoveryPayload({ workspaceId: DEFAULT_WORKSPACE_ID, events })));
    await restoreWorkspaceSyncRecoveryPayload(payload);
    expect(await db.salesRows.toArray()).toEqual(state.rows);
    expect((await db.ledgers.toArray())[0].summary).toEqual(result.finalSummary);
    expect((await previewSalesImports({ period, items: [item] })).items[0].status).toBe('skipped_duplicate');
  }, 30000);

  it('rejects corrupted compact backups and sync recovery before touching existing facts', async () => {
    await commit([largeFile('大店')]);
    const before = await facts();
    const backup = JSON.parse(JSON.stringify(await createWorkspaceBackupPayload()));
    backup.tables.auditEvents.find(event => event.action === 'imported').after.snapshot.salesRows.strings[0] += 'damaged';
    await expect(restoreWorkspaceBackupPayload(backup)).rejects.toThrow('完整性校验失败');
    expect(await facts()).toEqual(before);
    const payload = buildSyncRecoveryPayload({ workspaceId: DEFAULT_WORKSPACE_ID, events: structuredClone(before.audits.filter(event => event.action === 'imported')) });
    payload.events[0].after.snapshot.salesRows.rowCount += 1;
    await expect(restoreWorkspaceSyncRecoveryPayload(payload)).rejects.toThrow('行数不一致');
    expect(await facts()).toEqual(before);
  }, 30000);

  it.each([false, true])('rolls back the complete multi-store transaction if a compact audit fails after two files (existing=%s)', async existing => {
    if (existing) await commit([file('大甲店'), file('保留店')]);
    const input = { period, items: [largeFile('大甲店'), largeFile('大乙店'), largeFile('大丙店')] };
    const preview = await previewSalesImports(input);
    const before = await facts();
    const realAdd = db.auditEvents.add.bind(db.auditEvents);
    const imported = [];
    vi.spyOn(db.auditEvents, 'add').mockImplementation(event => {
      if (event.action === 'imported') {
        imported.push(event);
        if (imported.length === 3) throw new Error('synthetic audit size failure');
      }
      return realAdd(event);
    });
    await expect(saveSalesImports({ ...input, preview, overwriteSignature: preview.targetSignature })).rejects.toThrow('synthetic audit size failure');
    expect(imported).toHaveLength(3);
    expect(imported.every(event => event.after.snapshot.salesRows.format === SALES_ROWS_AUDIT_FORMAT)).toBe(true);
    expect(await facts()).toEqual(before);
  }, 30000);

  it.each(['during chunks', 'after audit'])('keeps cancellation atomic with a compact snapshot %s', async when => {
    await commit([file('保留店')]);
    const input = { period, items: [file('小店'), largeFile('大店', 4101)] };
    const preview = await previewSalesImports(input);
    const before = await facts();
    const controller = new AbortController();
    if (when === 'after audit') {
      const realAdd = db.auditEvents.add.bind(db.auditEvents);
      vi.spyOn(db.auditEvents, 'add').mockImplementation(event => realAdd(event).then(key => {
        if (event.action === 'imported' && event.after.snapshot.salesRows.format === SALES_ROWS_AUDIT_FORMAT) controller.abort();
        return key;
      }));
    }
    await expect(saveSalesImports({ ...input, preview, signal: controller.signal, onProgress: value => {
      if (when === 'during chunks' && value.completed === 4001) controller.abort();
    } })).rejects.toThrow('整批写入已回滚');
    expect(await facts()).toEqual(before);
  }, 30000);

  it('also compacts the legacy single-file API while retaining its return shape', async () => {
    const item = largeFile('大店');
    const result = await saveSalesImport({ ...item, period });
    expect(result).toMatchObject({ batchId: expect.any(String), ledgerId: expect.any(String), addedGroupCount: 1, replacedGroupCount: 0 });
    const audit = (await db.auditEvents.toArray()).find(event => event.action === 'imported');
    expect(audit.after.snapshot.salesRows.format).toBe(SALES_ROWS_AUDIT_FORMAT);
    expect(decodeSalesRowsAuditSnapshot(audit.after.snapshot.salesRows)).toEqual(await db.salesRows.toArray());
  }, 30000);

  async function staged(item, owner = 'stage-test') {
    const id = await createImportStage(owner);
    // Include an empty excluded block, as a genuine workbook can contain one.
    await appendImportStage(id, 0, []);
    await appendImportStage(id, 1, item.rows);
    const rowSource = await sealImportStage(id, item.rows.length, 2);
    const { rows, ...metadata } = item;
    return { ...metadata, rowSource };
  }
  it('consumes immutable staged blocks with the same precision, source fields, audit recovery and idempotence', async () => {
    const item = file('甲店', 10.129);
    Object.assign(item.rows[0], { rawAddedAt: '2026-08-31 23:59:59', sourceAddedDate: '2026-08-31', sourceAddedAt: '2026-08-31T23:59:59.000+08:00', sourceSheet: '台账变动明细', sourceRow: 9007, orderId: '00012345678901234567890123456789' });
    const input = await staged(item);
    await expect(appendImportStage(input.rowSource.id, 2, item.rows)).rejects.toThrow('封存');
    await expect(sealImportStage(input.rowSource.id, 999, 3)).rejects.toThrow('封存');
    const result = await commit([input]);
    const stored = await db.salesRows.toArray();
    expect(stored[0]).toMatchObject(item.rows[0]);
    expect(result.finalSummary.revenue).toBe(10.12);
    expect((await db.auditEvents.toArray()).find(e => e.action === 'imported').after.snapshot.salesRows).toEqual(stored);
    expect((await commit([input])).items[0].status).toBe('skipped_duplicate');
    await clearImportStages('stage-test');
    await expect(commit([input])).rejects.toThrow('临时数据已失效');
  });
  it('rejects staged cross-month rows and rolls back a staged replacement cancelled after the first block', async () => {
    await commit([file('甲店')]);
    const before = await facts();
    const invalid = file('乙店'); invalid.rows[0].sourceAddedDate = '2026-09-01';
    await expect(commit([await staged(invalid)])).rejects.toThrow('来源月份');
    const input = { period, items: [await staged(file('甲店', 30))] };
    const preview = await previewSalesImports(input);
    const controller = new AbortController();
    await expect(saveSalesImports({ ...input, preview, overwriteSignature: preview.targetSignature, signal: controller.signal, onProgress: () => controller.abort() })).rejects.toThrow('已取消');
    expect(await facts()).toEqual(before);
    await clearImportStages('stage-test');
  });
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

it('cancels between write chunks and atomically restores all previous rows and audit events', async () => {
  await commit([file('保留店')]);
  const raw = Array.from({length:4101},(_,index)=>({SKU:`SKU-${index}`,SKC:'大商品',数量:1,金额:2}));
  const items = [file('大店',2,{raw})];
  const input = {period,items};
  const preview = await previewSalesImports(input);
  const before = await facts();
  const controller = new AbortController();
  const progress = [];
  await expect(saveSalesImports({...input,preview,signal:controller.signal,onProgress:value=>{progress.push(value);controller.abort();}})).rejects.toThrow('已回滚');
  expect(progress).toEqual([{completed:2000,total:4101}]);
  expect(await facts()).toEqual(before);
});
it('rejects a known different source month even if the caller bypasses the UI', async () => {
  const item = file('甲店');
  item.rows[0].sourceAddedDate = '2026-07-31';
  await expect(previewSalesImports({period,items:[item]})).rejects.toThrow('来源月份与账本');
  expect(await db.salesRows.count()).toBe(0);
});

function selectedFile(storeName, selected, scope = 'full_month') {
  const scopedMapping = { ...mapping, supplierNumber: '货号', sourceAddedAt: '日期' };
  const raw = ['A','B','C','D'].map((number,index)=>({SKU:storeName+'-'+number,SKC:storeName+'-SKC-'+number,货号:number,数量:1,金额:index+1,日期:'2026-08-30'}));
  const filterOptions = { supplierNumbers:selected };
  const validated = validateSalesRows(raw,scopedMapping,{defaultStore:storeName,...filterOptions});
  return {itemId:storeName,fileName:storeName+'.csv',fileHash:storeName+'-same-content',storeName,mapping:scopedMapping,filterOptions,
    sourceCoverage:createSalesSourceCoverage({period,storeName,scope,supplierNumbers:selected}),importMode:scope==='full_month'?'replace_store_month':'append',
    rows:validated.rows,summary:{errorCount:validated.errors.length,ignoredCount:validated.ignored.length}};
}
it('reimports the same complete file with changed numbers and removes only that store/month old scope', async()=>{
  await commit([selectedFile('甲',['A','B','C']),selectedFile('乙',['A'])]);
  const items=[selectedFile('甲',['B','D'])], preview=await previewSalesImports({period,items});
  expect(preview.items[0]).toMatchObject({replacementScope:'store_month',removedGroupCount:2,status:'ready',additions:[expect.objectContaining({supplierNumber:'D',added:true})]});
  await saveSalesImports({period,items,preview,overwriteSignature:preview.targetSignature});
  expect((await db.salesRows.toArray()).filter(row=>row.store==='甲').map(row=>row.supplierNumber).sort()).toEqual(['B','D']);
  expect((await db.salesRows.toArray()).filter(row=>row.store==='乙')).toHaveLength(1);
  expect((await previewSalesImports({period,items})).items[0].status).toBe('skipped_duplicate');
});
it('partial source preserves prior numbers and cannot claim a complete store replacement', async()=>{
  await commit([selectedFile('甲',['A','B'])]);
  await commit([selectedFile('甲',['C'],'partial')]);
  expect((await db.salesRows.toArray()).map(row=>row.supplierNumber).sort()).toEqual(['A','B','C']);
  await expect(previewSalesImports({period,items:[{...selectedFile('甲',['D'],'partial'),importMode:'replace_store_month'}]})).rejects.toThrow('完整替换本店本月');
});
it('rejects mismatched selection metadata and rolls back scoped replacements on cancellation',async()=>{
  await commit([selectedFile('甲',['A','B'])]);
  const before=await facts();
  const forged=selectedFile('甲',['C']); forged.rows[0].supplierNumber='UNSELECTED';
  await expect(previewSalesImports({period,items:[forged]})).rejects.toThrow('未选择货号');
  const items=[selectedFile('甲',['C'])],preview=await previewSalesImports({period,items}),controller=new AbortController();
  await expect(saveSalesImports({period,items,preview,overwriteSignature:preview.targetSignature,signal:controller.signal,onProgress:()=>controller.abort()})).rejects.toThrow('已回滚');
  expect(await facts()).toEqual(before);
});
