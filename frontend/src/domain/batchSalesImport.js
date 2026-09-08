import { createLedgerGroupKey, createLedgerSkuKey, summarizeLedgerRows } from "./ledgerImport";
import { validateSalesMapping } from "../lib/salesImport";

export const canonicalStore = (value) => String(value ?? "").normalize("NFKC").trim().toUpperCase();

// Exact canonical serialization avoids collision-based overwrite approvals. These signatures
// are ephemeral preview values, never new persisted or sync contract fields.
export function importSignature(value) {
  if (Array.isArray(value)) return `[${value.map(importSignature).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${importSignature(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function effectiveImportOptions(item) {
  const filters = item.filterOptions ?? {};
  return {
    mapping: Object.fromEntries(Object.entries(item.mapping ?? {}).filter(([, value]) => Boolean(value))),
    filterOptions: {
      deriveAmountFromUnitPrice: Boolean(filters.deriveAmountFromUnitPrice),
      ...Object.fromEntries(["movementTypes", "supplierNumbers"].filter((key) => Array.isArray(filters[key])).map((key) => [key, [...new Set(filters[key].map((v) => String(v).normalize("NFKC").trim()))].sort()])),
    },
  };
}

export function sourceSalesRow(row) {
  const { id, workspaceId, ledgerId, batchId, importedAt, ...source } = row;
  return source;
}

function effectiveRowsSignature(rows) {
  return importSignature(rows.map((row) => ({ ...sourceSalesRow(row), store: canonicalStore(row.store) })));
}

export function prepareSalesImportItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error("请至少选择一个台账文件。");
  const stores = new Set();
  const hashes = new Set();
  const ids = new Set();
  return items.map((item) => {
    const fail = (message) => { throw new Error(`${item.fileName || "台账文件"}：${message}`); };
    const storeName = String(item.storeName ?? "").normalize("NFKC").trim();
    const store = canonicalStore(storeName);
    if (!item.itemId || ids.has(item.itemId)) fail("文件标识缺失或重复，请重新选择文件。");
    if (!store) fail("请确认店铺。");
    if (stores.has(store)) fail("整批不能有两个文件属于同一店铺。");
    if (!item.fileHash) fail("缺少来源文件哈希，请重新解析。");
    if (hashes.has(item.fileHash)) fail("整批存在相同文件内容，请移除重复文件并核对店铺。");
    const mappingIssues = validateSalesMapping(item.mapping ?? {}, { defaultStore: storeName });
    const columns = Object.values(item.mapping ?? {}).filter(Boolean);
    if (mappingIssues.length || new Set(columns).size !== columns.length) fail("必需映射缺失或来源列重复映射。");
    if (!item.summary || item.summary.errorCount > 0 || item.summary.errors?.length) fail("存在错误行，请修正文件后重试。");
    if (!item.rows?.length) fail("没有有效数据行。");
    const rows = item.rows.map((raw) => {
      if (canonicalStore(raw.store) !== store) fail(`第 ${raw.sourceRow ?? "?"} 行店铺与确认店铺不一致。`);
      if (!String(raw.platformSku ?? "").trim() || ![raw.quantity, raw.amount].every(Number.isFinite)) fail("存在未经有效校验的数据行。");
      const row = { ...sourceSalesRow(raw), store: storeName };
      row.groupKey = createLedgerGroupKey(row);
      row.skuKey = createLedgerSkuKey(row);
      return row;
    });
    stores.add(store); hashes.add(item.fileHash); ids.add(item.itemId);
    return { ...item, storeName, rows };
  });
}

export function planSalesImports({ ledger, existingRows, batches, items, ledgerId }) {
  if (ledger && ["finalized", "locked"].includes(ledger.status)) throw new Error("已定稿或已锁定的月度账本不能直接导入新数据。");
  const rowsByGroup = new Map();
  const rowsByBatch = new Map();
  for (const row of existingRows) {
    if (!rowsByGroup.has(row.groupKey)) rowsByGroup.set(row.groupKey, []);
    if (!rowsByBatch.has(row.batchId)) rowsByBatch.set(row.batchId, []);
    rowsByGroup.get(row.groupKey).push(row);
    rowsByBatch.get(row.batchId).push(row);
  }
  const results = items.map((item) => {
    const candidates = batches.filter((batch) => batch.fileHash === item.fileHash);
    if (candidates.some((batch) => canonicalStore(batch.store) !== canonicalStore(item.storeName))) {
      throw new Error(`${item.fileName}：相同文件内容曾分配到不同店铺，请核对来源文件。`);
    }
    const rowSignature = effectiveRowsSignature(item.rows);
    const duplicate = candidates.find((batch) => batch.status === "completed"
      && importSignature(effectiveImportOptions(batch)) === importSignature(effectiveImportOptions(item))
      && batch.validRowCount === item.rows.length
      && effectiveRowsSignature(rowsByBatch.get(batch.id) ?? []) === rowSignature);
    const incomingGroups = new Map();
    for (const row of item.rows) {
      if (!incomingGroups.has(row.groupKey)) incomingGroups.set(row.groupKey, []);
      incomingGroups.get(row.groupKey).push(row);
    }
    const keys = new Set(incomingGroups.keys());
    const overlaps = duplicate ? [] : [...keys].flatMap((groupKey) => {
      const oldRows = rowsByGroup.get(groupKey) ?? [];
      if (!oldRows.length) return [];
      const newRows = incomingGroups.get(groupKey);
      return [{ groupKey, store: item.storeName, platformSkc: newRows[0].platformSkc, supplierNumber: newRows[0].supplierNumber,
        before: { ...summarizeLedgerRows(oldRows), rowCount: oldRows.length },
        after: { ...summarizeLedgerRows(newRows), rowCount: newRows.length } }];
    });
    return { itemId: item.itemId, fileName: item.fileName, storeName: item.storeName,
      status: duplicate ? "skipped_duplicate" : "ready", batchId: duplicate?.id ?? null,
      validRowCount: item.rows.length, ignoredRowCount: item.summary.ignoredCount ?? 0, errorCount: 0,
      summary: summarizeLedgerRows(item.rows), overlaps,
      addedGroupCount: duplicate ? 0 : keys.size - overlaps.length, replacedGroupCount: overlaps.length };
  });
  const pending = items.filter((item, index) => results[index].status !== "skipped_duplicate");
  const keys = new Set(pending.flatMap((item) => item.rows.map((row) => row.groupKey)));
  return { ledgerId, items: results,
    inputSignature: importSignature(items),
    targetSignature: importSignature({ ledger: ledger ?? null, existingRows, batches }),
    summary: summarizeLedgerRows(pending.flatMap((item) => item.rows)),
    finalSummary: summarizeLedgerRows([...existingRows.filter((row) => !keys.has(row.groupKey)), ...pending.flatMap((item) => item.rows)]),
    requiresOverwrite: results.some((item) => item.overlaps.length > 0) };
}
