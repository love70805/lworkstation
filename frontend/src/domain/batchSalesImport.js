import { createLedgerGroupKey, createLedgerSkuKey, summarizeLedgerRows } from "./ledgerImport";
import { validateSalesMapping } from "../lib/salesImport";
import { normalizeSalesSourceCoverage } from "./selectionSalesLabels";

export const canonicalStore = (value) => String(value ?? "").normalize("NFKC").trim().toUpperCase();

// Canonical serialization is used only for bounded chunks. SHA-256 binds every
// chunk, its position and metadata without retaining a second full ledger string.
export function importSignature(value) {
  if (Array.isArray(value)) return `[${value.map(importSignature).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${importSignature(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function effectiveImportOptions(item) {
  const filters = item.filterOptions ?? {};
  return {
    importMode: item.importMode ?? "append",
    sourceCoverage: item.sourceCoverage ?? null,
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

async function digest(value) {
  const bytes = new TextEncoder().encode(importSignature(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function rowsSignature(rows, normalize = false) {
  const chunks = [];
  for (let start = 0; start < rows.length; start += 128) {
    const chunk = rows.slice(start, start + 128);
    chunks.push(await digest(normalize ? chunk.map(row => ({ ...sourceSalesRow(row), store: canonicalStore(row.store) })) : chunk));
  }
  return digest({ algorithm: "sales-import-sha256-chunks-v1", length: rows.length, chunks });
}
const effectiveRowsSignature = rows => rowsSignature(rows, true);
async function inputSignature(items) {
  const metadata = [];
  for (const { rows, ...item } of items) metadata.push({ ...item, rowsDigest: await rowsSignature(rows) });
  return digest(metadata);
}

export function prepareSalesImportItems(items, { period } = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error("请至少选择一个台账文件。");
  const stores = new Set();
  const hashes = new Set();
  const ids = new Set();
  return items.map((item) => {
    const fail = (message) => { throw new Error(`${item.fileName || "台账文件"}：${message}`); };
    const storeName = String(item.storeName ?? "").normalize("NFKC").trim();
    const store = canonicalStore(storeName);
    const sourceCoverage = normalizeSalesSourceCoverage(item.sourceCoverage, { period, storeName });
    const importMode = item.importMode ?? "append";
    if (!["append", "replace_store_month"].includes(importMode)) fail("导入方式无效。");
    if (importMode === "replace_store_month" && sourceCoverage?.scope !== "full_month") fail("完整替换本店本月需要声明完整月台账。");
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
      if (period && raw.sourceAddedDate && !raw.sourceAddedDate.startsWith(`${period}-`)) fail(`第 ${raw.sourceRow ?? "?"} 行来源月份与账本 ${period} 不一致，请按月处理。`);
      const row = { ...structuredClone(sourceSalesRow(raw)), store: storeName };
      row.groupKey = createLedgerGroupKey(row);
      row.skuKey = createLedgerSkuKey(row);
      return row;
    });
    stores.add(store); hashes.add(item.fileHash); ids.add(item.itemId);
    const { rows: originalRows, ...metadata } = item;
    return { ...structuredClone(metadata), storeName, sourceCoverage, importMode, rows };
  });
}

// Caller passes one ledger's current rows. Whole-store deletion is authorized
// only by the explicit mode; a completeness declaration alone keeps group scope.
export function getSalesImportReplacementRows(existingRows, pendingItems) {
  const keys = new Set(pendingItems.flatMap(item => item.rows.map(row => row.groupKey)));
  const stores = new Set(pendingItems.filter(item => item.importMode === "replace_store_month" && item.sourceCoverage?.scope === "full_month").map(item => canonicalStore(item.storeName)));
  return existingRows.filter(row => keys.has(row.groupKey) || stores.has(canonicalStore(row.store)));
}

export async function planSalesImports({ ledger, existingRows, batches, items, ledgerId }) {
  if (ledger && ["finalized", "locked"].includes(ledger.status)) throw new Error("已定稿或已锁定的月度账本不能直接导入新数据。");
  const rowsByGroup = new Map();
  const rowsByBatch = new Map();
  for (const row of existingRows) {
    if (!rowsByGroup.has(row.groupKey)) rowsByGroup.set(row.groupKey, []);
    if (!rowsByBatch.has(row.batchId)) rowsByBatch.set(row.batchId, []);
    rowsByGroup.get(row.groupKey).push(row);
    rowsByBatch.get(row.batchId).push(row);
  }
  const results = [];
  for (const item of items) {
    const candidates = batches.filter((batch) => batch.fileHash === item.fileHash);
    if (candidates.some((batch) => canonicalStore(batch.store) !== canonicalStore(item.storeName))) {
      throw new Error(`${item.fileName}：相同文件内容曾分配到不同店铺，请核对来源文件。`);
    }
    let duplicate = null;
    if (candidates.length) {
      const rowSignature = await effectiveRowsSignature(item.rows);
      for (const batch of candidates) {
        if (batch.status === "completed"
          && importSignature(effectiveImportOptions(batch)) === importSignature(effectiveImportOptions(item))
          && batch.validRowCount === item.rows.length
          && await effectiveRowsSignature(rowsByBatch.get(batch.id) ?? []) === rowSignature
          && (item.importMode !== "replace_store_month" || await effectiveRowsSignature(existingRows.filter(row => canonicalStore(row.store) === canonicalStore(item.storeName))) === rowSignature)) {
          duplicate = batch; break;
        }
      }
    }
    const incomingGroups = new Map();
    for (const row of item.rows) {
      if (!incomingGroups.has(row.groupKey)) incomingGroups.set(row.groupKey, []);
      incomingGroups.get(row.groupKey).push(row);
    }
    const keys = new Set(incomingGroups.keys());
    const replaceStore = item.importMode === "replace_store_month";
    const replacementKeys = replaceStore ? new Set([...keys, ...existingRows.filter(row => canonicalStore(row.store) === canonicalStore(item.storeName)).map(row => row.groupKey)]) : keys;
    const overlaps = duplicate ? [] : [...replacementKeys].flatMap((groupKey) => {
      const oldRows = rowsByGroup.get(groupKey) ?? [];
      if (!oldRows.length) return [];
      const newRows = incomingGroups.get(groupKey) ?? [];
      const identity = newRows[0] ?? oldRows[0];
      return [{ groupKey, store: item.storeName, platformSkc: identity.platformSkc, supplierNumber: identity.supplierNumber, removed: !newRows.length,
        before: { ...summarizeLedgerRows(oldRows), rowCount: oldRows.length },
        after: { ...summarizeLedgerRows(newRows), rowCount: newRows.length } }];
    });
    results.push({ itemId: item.itemId, fileName: item.fileName, storeName: item.storeName,
      status: duplicate ? "skipped_duplicate" : "ready", batchId: duplicate?.id ?? null,
      validRowCount: item.rows.length, ignoredRowCount: item.summary.ignoredCount ?? 0, errorCount: 0,
      summary: summarizeLedgerRows(item.rows), overlaps, replacementScope: replaceStore ? "store_month" : "groups",
      sourceCoverage: item.sourceCoverage ?? null, importMode: item.importMode ?? "append",
      removedGroupCount: overlaps.filter(group => group.removed).length,
      addedGroupCount: duplicate ? 0 : keys.size - overlaps.filter(group => !group.removed).length, replacedGroupCount: overlaps.filter(group => !group.removed).length });
  }
  const pending = items.filter((item, index) => results[index].status !== "skipped_duplicate");
  const replacementRows = new Set(getSalesImportReplacementRows(existingRows, pending));
  return { ledgerId, items: results,
    inputSignature: await inputSignature(items),
    targetSignature: await digest({ ledger: ledger ?? null, rowsDigest: await rowsSignature(existingRows), batches }),
    summary: summarizeLedgerRows(pending.flatMap((item) => item.rows)),
    finalSummary: summarizeLedgerRows([...existingRows.filter(row => !replacementRows.has(row)), ...pending.flatMap((item) => item.rows)]),
    requiresOverwrite: results.some((item) => item.overlaps.length > 0) };
}
