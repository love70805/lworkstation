import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getSelectionReferenceSnapshot, setActiveMemberContext, saveSalesImport, DEFAULT_WORKSPACE_ID } from "./database";
import { buildSelectionReferenceRows, groupSelectionReferenceRows } from "../lib/selectionReferences";
import { validateSalesRows } from "../lib/salesImport";

beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(async () => { db.close(); await db.delete(); });

describe("selection reference trusted ledger snapshot", () => {
  it("projects SKC and attributes through the real ledger import path before any report finalization", async () => {
    const mapping = { platformSkc: "SKC", platformSku: "平台SKU", attribute: "属性集", quantity: "数量", unitPrice: "单价" };
    const validated = validateSalesRows([
      { SKC: "SKC-TEST", 平台SKU: "SKU-TEST-RED", 属性集: "多色-红色", 数量: 2, 单价: 10 },
      { SKC: "SKC-TEST", 平台SKU: "SKU-TEST-BLUE", 属性集: "多色-蓝色", 数量: 3, 单价: 10 },
    ], mapping, { defaultStore: "680店" });
    expect(validated.errors).toEqual([]);
    await saveSalesImport({ fileName: "synthetic-ledger.xlsx", mapping, period: "2026-08", storeName: "680店", rows: validated.rows,
      summary: { sourceRowCount: validated.sourceRowCount, errorCount: 0, ignoredCount: 0 } });
    await db.erpCostRows.bulkAdd(validated.rows.map(row => ({ workspaceId: DEFAULT_WORKSPACE_ID, platformSku: row.platformSku, unitCost: 4.59 })));
    const references = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
    expect(references.map(row => row.attribute).sort()).toEqual(["多色-红色", "多色-蓝色"]);
    expect(groupSelectionReferenceRows(references)).toMatchObject([{ platformSkc: "SKC-TEST", skuCount: 2 }]);
    expect(await db.profitLines.count()).toBe(0);
    expect(await db.platformSkus.count()).toBe(0);
  });

  it("joins persisted ledger identities read-only and rejects cross-workspace, orphan and incomplete imports", async () => {
    await setActiveMemberContext({ workspaceId: "workspace-a" });
    await db.ledgers.bulkPut([{ id: "la", workspaceId: "workspace-a", period: "2026-08" }, { id: "lb", workspaceId: "workspace-b", period: "2026-08" }]);
    await db.importBatches.bulkPut([
      { id: "ba", workspaceId: "workspace-a", ledgerId: "la", status: "completed" },
      { id: "bb", workspaceId: "workspace-b", ledgerId: "lb", status: "completed" },
      { id: "bad", workspaceId: "workspace-a", ledgerId: "la", status: "failed" },
    ]);
    const base = { workspaceId: "workspace-a", ledgerId: "la", batchId: "ba", platformSku: "SKU-A", platformSkc: "SKC-1", attribute: "红色", store: "680店", sourceSheet: "台账变动明细", sourceRow: 2 };
    await db.salesRows.bulkAdd([
      base, { ...base, platformSku: "SKU-B", attribute: "蓝色", sourceRow: 3 },
      { ...base, workspaceId: "workspace-b", ledgerId: "lb", batchId: "bb", platformSkc: "OTHER" },
      { ...base, ledgerId: "missing", platformSkc: "ORPHAN" },
      { ...base, batchId: "bad", platformSkc: "FAILED" },
      { ...base, batchId: "bb", platformSkc: "WRONG-PARENT" },
    ]);
    await db.erpCostRows.bulkAdd(["SKU-A", "SKU-B"].map(platformSku => ({ workspaceId: "workspace-a", platformSku, unitCost: 4.59, publishedAt: "2026-08-01" })));
    const before = await Promise.all(db.tables.map(table => table.toArray()));
    const snapshot = await getSelectionReferenceSnapshot();
    expect(snapshot.ledgerIdentityRows).toHaveLength(2);
    const references = buildSelectionReferenceRows(snapshot);
    expect(references[0]).toMatchObject({ platformSkc: "SKC-1", attribute: "红色", platformSkcSource: "ledger", platformSkcConflict: false });
    expect(groupSelectionReferenceRows(references)).toMatchObject([{ skuCount: 2, platformSkc: "SKC-1" }]);
    expect(await Promise.all(db.tables.map(table => table.toArray()))).toEqual(before);
    await setActiveMemberContext({ workspaceId: "workspace-b" });
    expect((await getSelectionReferenceSnapshot()).ledgerIdentityRows).toHaveLength(1);
    expect(buildSelectionReferenceRows(await getSelectionReferenceSnapshot())).toMatchObject([
      { platformSku: "SKU-A", platformSkc: "OTHER", referenceUnitCost: null, productId: null },
    ]);
    expect(buildSelectionReferenceRows(await getSelectionReferenceSnapshot())).toHaveLength(1);
  });

  it("never associates unscoped legacy default-workspace references with a different active workspace", async () => {
    await db.erpCostRows.add({ platformSku: "LEGACY", unitCost: 2 });
    await setActiveMemberContext({ workspaceId: "other" });
    expect((await getSelectionReferenceSnapshot()).erpCosts).toHaveLength(0);
    await setActiveMemberContext({ workspaceId: DEFAULT_WORKSPACE_ID });
    expect((await getSelectionReferenceSnapshot()).erpCosts).toHaveLength(1);
  });
});
