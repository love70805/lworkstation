import { exact, exactSum, canonicalJson } from "./profitReports";
import { decimalSource } from "./salesAnalytics";

export const SUPPLEMENT_PARSER_VERSION = "monthly-supplement@1";
export const supplementFields = {
  owner: ["姓名", "名字", "名字+店铺", "负责人", "采购人", "跟单人", "登记人"],
  store: ["店铺", "店铺名称"],
  platformSkc: ["SKC", "skc", "平台SKC"],
  supplierNumber: ["供方货号", "货号"],
  businessId: ["订单号", "补扣款单号", "扣款单号", "单号"],
  order1688: ["1688订单号", "1688单号"],
  quantity: ["件数", "数量", "采购数量", "sku数量", "发货数量"],
  amount: ["扣款金额", "金额"],
};
const normalized = value => String(value ?? "").normalize("NFKC").trim();
const headerKey = value => normalized(value).replace(/\s/g, "").toLowerCase();
export function suggestSupplementMapping(headers) {
  return Object.fromEntries(Object.entries(supplementFields).map(([field, aliases]) => [field, String(headers.findIndex(header => aliases.some(alias => headerKey(header) === headerKey(alias))))]));
}
export function supplementHeaders(source,headerRow){const index=source.sourceRows?source.sourceRows.indexOf(Number(headerRow)):Number(headerRow)-1;return source.cells[index]??[];}
export function inspectSupplementSource(source, { kind, headerRow = 1, mapping, ownerMarker = "", ownerField = "owner", store = "", includeAll = false } = {}) {
  const cells = source.cells ?? [];
  const headerIndex=source.sourceRows?source.sourceRows.indexOf(Number(headerRow)):Number(headerRow)-1;
  if(headerIndex<0||headerIndex>=cells.length)throw new Error("表头行不在来源记录中。");
  const headers = cells[headerIndex] ?? [];
  const fields = mapping ?? suggestSupplementMapping(headers);
  const marker = normalized(ownerMarker);
  if (!includeAll && !marker) throw new Error("请选择本人标记或明确采用该来源全部记录。");
  if (!includeAll && !(Number(fields[ownerField]) >= 0)) throw new Error("请映射本人姓名或供方货号列。");
  if (!(Number(fields[kind === "dispatch" ? "quantity" : "amount"]) >= 0)) throw new Error("请映射数量或扣款金额列。");
  const rows = [], errors = [], ignored = [];
  for (let index = headerIndex+1; index < cells.length; index++) {
    const values = cells[index];
    if (!values.some(value => normalized(value))) continue;
    const sourceRow = source.sourceRows?.[index] ?? index + 1;
    const get = field => values[Number(fields[field])] ?? "";
    if (values.some(value => /^(合计|总计|小计|总合计|汇总)([:：\s]|$)/.test(normalized(value)))) { ignored.push({ sourceRow, reason:"total" }); continue; }
    if (headerKey(get(kind === "dispatch" ? "quantity" : "amount")) === headerKey(headers[Number(fields[kind === "dispatch" ? "quantity" : "amount"])])) { ignored.push({ sourceRow, reason:"header" }); continue; }
    if (!includeAll && !normalized(get(ownerField)).includes(marker)) { ignored.push({ sourceRow, reason:"owner_excluded" }); continue; }
    const amount = decimalSource(get(kind === "dispatch" ? "quantity" : "amount"), null);
    if (amount === null || (kind === "dispatch" && Number(amount) < 0)) { errors.push({ sourceRow, message:"数量或金额无效，请核对源行/映射。" }); continue; }
    const identifiers = ["businessId", "order1688", "platformSkc", "supplierNumber"];
    if (identifiers.some(field => typeof get(field) === "number" && (!Number.isSafeInteger(get(field)) || Math.abs(get(field)) >= 1e15))) { errors.push({ sourceRow, message:"源表数字标识符可能已丢失精度，请使用原始文本单号。" }); continue; }
    const sourceStore = normalized(get("store"));
    const targetStore = sourceStore || normalized(store);
    if (kind === "deduction" && !targetStore) { errors.push({ sourceRow, message:"请按实际源列或工作表映射店铺。" }); continue; }
    rows.push({ ...Object.fromEntries(identifiers.map(field => [field, normalized(get(field))])), kind, ownerMarker: normalized(get(ownerField)), originalStore: sourceStore || source.sheetName, store: targetStore, fileHash: source.fileHash, sourceSheet: source.sheetName, sourceRow, sourceName: source.fileName, selected: true, ...(kind === "dispatch" ? { quantityExact: exact(amount,{nonnegative:true}) } : { signedAmountExact: exact(amount) }) });
  }
  return { rows, errors, ignored, source: { fileHash:source.fileHash, fileName:source.fileName, sheetName:source.sheetName, headerRow, mapping:fields, selection:{ownerMarker:marker,ownerField,includeAll,store}, parserVersion:SUPPLEMENT_PARSER_VERSION } };
}

export function normalizeSupplementCandidate(input, { ledger, stores }) {
  if (!["dispatch","deduction"].includes(input.kind) || input.period !== ledger.period || input.ledgerId !== ledger.id || input.workspaceId !== ledger.workspaceId) throw new Error("补充数据与目标工作区或账本月份不一致。");
  const rows = (input.rows ?? []).map(raw => {
    const { id, batchId, workspaceId, ledgerId, ...row } = raw;
    if (row.kind !== input.kind) throw new Error("补充数据类型不一致。");
    if (input.kind === "deduction" && !stores.includes(row.store)) throw new Error(`扣款店铺 ${row.store || "未映射"} 不在账本基础中。`);
    if (!row.manual && (!row.fileHash || !row.sourceSheet || !(Number(row.sourceRow) >= 1))) throw new Error("源行缺少可追溯位置。");
    return { ...row, ...(input.kind === "dispatch" ? {quantityExact:exact(row.quantityExact,{nonnegative:true})} : {signedAmountExact:exact(row.signedAmountExact)}) };
  });
  const identities = new Set(), businessIds = new Set();
  for (const row of rows) {
    const key = canonicalJson([row.fileHash,row.sourceSheet,row.sourceRow,row.manual ? row.store : null]);
    if (identities.has(key)) throw new Error("候选包含重复源行，请移除重复来源后重新采用。");
    identities.add(key);
    if (row.businessId) {
      const business = canonicalJson([row.store,row.businessId,row.platformSkc,row.supplierNumber]);
      if (businessIds.has(business)) throw new Error("候选包含相同业务单号的冲突记录，请核对并保留正确来源；不会按金额自动去重。");
      businessIds.add(business);
    }
  }
  const quantityExact = input.kind === "dispatch" ? exact(input.mode === "manual" ? input.adoptedQuantityExact : input.adoptedQuantityExact ?? exactSum(rows,"quantityExact"),{nonnegative:true}) : null;
  if (input.kind === "dispatch" && !rows.length && input.mode !== "manual") throw new Error("没有有效代发记录，请检查来源和本人筛选。");
  if (input.kind === "deduction" && !rows.length) throw new Error("扣款尚未取得；真实零扣款请明确录入零值。");
  const coveredStores = [...new Set(rows.map(row => row.store).filter(Boolean))];
  return { kind:input.kind, period:ledger.period, mode:input.mode ?? "files", sources:input.sources ?? [], rows, adoptedQuantityExact:quantityExact, signedAmountExact:input.kind === "deduction" ? exactSum(rows,"signedAmountExact") : null, coveredStores, missingStores:input.kind === "deduction" ? stores.filter(store=>!coveredStores.includes(store)) : [], parserVersion:SUPPLEMENT_PARSER_VERSION };
}
