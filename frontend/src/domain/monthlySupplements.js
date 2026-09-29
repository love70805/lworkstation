import { exact, exactSum, canonicalJson } from "./profitReports";
import { decimalSource } from "./salesAnalytics";

export const SUPPLEMENT_PARSER_VERSION = "monthly-supplement@4";
export const supplementFields = {
  owner: ["登记人", "姓名", "名字", "名字+店铺", "负责人", "采购人", "跟单人"],
  date: ["日期", "登记日期"],
  store: ["店铺", "店铺名称"],
  platformSkc: ["SKC", "skc", "平台SKC"],
  supplierNumber: ["供方货号", "货号"],
  businessId: ["订单号", "补扣款单号", "扣款单号", "单号"],
  order1688: ["1688订单号", "1688单号"],
  quantity: ["sku数量", "件数", "数量", "采购数量", "发货数量"],
  amount: ["分摊后运费", "分摊金额", "扣款金额", "运费金额", "金额"],
};
const normalized = value => String(value ?? "").normalize("NFKC").trim();
const headerKey = value => normalized(value).replace(/\s/g, "").toLowerCase();
export function suggestSupplementStore(sourceName, stores=[]) {
  const name=normalized(sourceName).toUpperCase();
  const exactMatches=stores.filter(store=>normalized(store).toUpperCase()===name);
  if(exactMatches.length)return exactMatches.length===1?exactMatches[0]:'';
  if(!/^\d+(?:店)?$/.test(name))return '';
  const matches=stores.filter(store=>/^\d+(?:店)?$/.test(normalized(store))&&normalized(store).replace(/店$/,'')===name.replace(/店$/,''));
  return matches.length===1?matches[0]:'';
}
export function suggestSupplementMapping(headers) {
  return Object.fromEntries(Object.entries(supplementFields).map(([field, aliases]) => [field, String(aliases.map(alias=>headers.findIndex(header=>headerKey(header)===headerKey(alias))).find(index=>index>=0)??-1)]));
}
export function supplementMarkers(source, kind) {
  const mapping=source.mapping??suggestSupplementMapping(supplementHeaders(source,source.headerRow));
  const column=Number(mapping[kind==='dispatch'?'owner':'supplierNumber']);
  const start=source.sourceRows?source.sourceRows.indexOf(source.headerRow):source.headerRow-1;
  return [...new Set(source.cells.slice(start+1).map(row=>normalized(row[column])).filter(value=>value&&!['登记人','姓名','供方货号','货号','无'].includes(value)))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
}
export function supplementHeaders(source,headerRow){const index=source.sourceRows?source.sourceRows.indexOf(Number(headerRow)):Number(headerRow)-1;return source.cells[index]??[];}
export const supplementRowIdentity = row => canonicalJson([row.fileHash,row.sourceSheet,row.sourceRow,row.manual?row.store:null]);
export function supplementRowLabel(row) {
  const csv=row.sourceFormat==='csv'||(!row.sourceFormat&&row.sourceSheet==='CSV');
  const position=row.recordRow?`表格第 ${row.recordRow} 行${csv?`（CSV 物理第 ${row.sourceRow} 行）`:''}`:`${csv?'CSV 物理':'工作表'}第 ${row.sourceRow} 行`;
  return `${position}${row.businessId?` · 单号 ${row.businessId}`:''}`;
}
export function inspectSupplementSource(source, { kind, headerRow = 1, mapping, ownerMarker = "", ownerField = kind==='deduction'?'supplierNumber':'owner', matchMode = 'exact', store = "", stores = [], includeAll = false } = {}) {
  const cells = source.cells ?? [];
  const headerIndex=source.sourceRows?source.sourceRows.indexOf(Number(headerRow)):Number(headerRow)-1;
  if(headerIndex<0||headerIndex>=cells.length)throw new Error("表头行不在来源记录中。");
  const headers = cells[headerIndex] ?? [];
  const fields = mapping ?? suggestSupplementMapping(headers);
  const marker = normalized(ownerMarker);
  if (!includeAll && !marker) throw new Error(kind==='dispatch'?"请选择登记人或全部登记人。":"请选择供方货号或全部记录。");
  if (!includeAll && !(Number(fields[ownerField]) >= 0)) throw new Error(kind==='dispatch'?"未识别登记人列，请在高级设置中映射。":"未识别供方货号列，请在高级设置中映射。");
  if (!(Number(fields[kind === "dispatch" ? "quantity" : "amount"]) >= 0)) throw new Error(kind==='dispatch'?"未识别数量列，请在高级设置中映射。":"未识别扣款金额列，请在高级设置中映射。");
  const rows = [], errors = [], ignored = [];
  let group=null;
  for (let index = headerIndex+1; index < cells.length; index++) {
    const values = cells[index];
    if (!values.some(value => normalized(value))) {group=null;continue;}
    const sourceRow = source.sourceRows?.[index] ?? index + 1;
    const position={sourceRow,recordRow:source.recordRows?.[index]??index+1,sourceFormat:source.sourceFormat??(source.sheetName==='CSV'?'csv':'xlsx'),businessId:normalized(values[Number(fields.businessId)]),sourceSheet:source.sheetName};
    const missingQuantity=kind==='dispatch'&&!normalized(values[Number(fields.quantity)]);
    const mergedFrom={};
    const get = field => {
      const column=Number(fields[field]), value=values[column]??'';
      if(normalized(value)||!['owner','date','store','platformSkc','order1688'].includes(field))return value;
      const merge=source.merges?.find(range=>range.s.c===column&&range.e.c===column&&range.s.r<index&&range.e.r>=index);
      if(!merge)return value;
      mergedFrom[field]=merge.s.r+1;
      return cells[merge.s.r]?.[column]??'';
    };
    if (!normalized(get('businessId')) && values.some(value => /^(合计|总计|小计|总合计|汇总)([:：\s]|$)/.test(normalized(value)))) {group=null;ignored.push({ ...position, reason:"total" }); continue; }
    if (headerKey(get(kind === "dispatch" ? "quantity" : "amount")) === headerKey(headers[Number(fields[kind === "dispatch" ? "quantity" : "amount"])])) {group=null;ignored.push({ ...position, reason:"header" }); continue; }
    if(kind==='deduction'&&!['businessId','platformSkc','supplierNumber','amount'].some(field=>normalized(get(field)))){ignored.push({...position,reason:'separator'});continue;}
    let owner=normalized(get(kind==='dispatch'?'owner':'supplierNumber')), sourceStore=normalized(get('store')), inheritedFrom=null;
    let platformSkc=normalized(get('platformSkc')), order1688=normalized(get('order1688'));
    const inheritedIdentifiers={};
    if(kind==='dispatch'){
      // A damaged first header may still contain recognisable dates. Never infer a name from it.
      const date=normalized(get('date')) || (/^(?:\d{4}[-/.年])?\d{1,2}[-/.月]\d{1,2}(?:日)?$/.test(normalized(values[0]))?normalized(values[0]):'');
      if (date&&date!==group?.date) group=null;
      // A registrant can span stores; changing stores resets product/order identity only.
      if (group&&sourceStore&&sourceStore!==group.store) group={owner:group.owner,date:group.date,sourceRow:group.sourceRow,store:sourceStore};
      const hasOrder=normalized(get('businessId'))||(owner&&normalized(get('quantity')));
      if(!hasOrder){group=owner?{owner,store:sourceStore,date,sourceRow,platformSkc,skcRow:sourceRow,order1688,order1688Row:sourceRow}:null;ignored.push({...position,reason:'separator'});continue;}
      if(owner){
        if(group?.owner!==owner)group=null;
        sourceStore=sourceStore||group?.store||'';
        group={...group,owner,store:sourceStore,date:date||group?.date||'',sourceRow};
      }else if(group){owner=group.owner;sourceStore=sourceStore||group.store;inheritedFrom=group.sourceRow;}
      else {
        if(missingQuantity)ignored.push({...position,reason:'missing_quantity',ownerMarker:'',inheritedFrom:null});
        else errors.push({...position,message:'连续记录的登记人归属不确定，请核对日期/分组并补齐来源登记人。'});
        continue;
      }
      if(platformSkc){group.platformSkc=platformSkc;group.skcRow=sourceRow;}
      else if(group.platformSkc){platformSkc=group.platformSkc;inheritedIdentifiers.platformSkc=group.skcRow;}
      // CSV loses merge metadata: one purchase order can cover multiple SKCs.
      // XLSX blanks are filled only by the explicit vertical merge in get().
      if(order1688){group.order1688=order1688;group.order1688Row=mergedFrom.order1688??sourceRow;}
      else if(position.sourceFormat==='csv'&&group.order1688){order1688=group.order1688;inheritedIdentifiers.order1688=group.order1688Row;}
    }
    if (!includeAll && !(kind==='deduction'&&matchMode==='contains'?owner.includes(marker):owner===marker)) { ignored.push({ ...position, reason:"owner_excluded" }); continue; }
    if(missingQuantity){ignored.push({...position,reason:'missing_quantity',ownerMarker:owner,inheritedFrom,inheritedIdentifiers,mergedFrom});continue;}
    const amount = decimalSource(get(kind === "dispatch" ? "quantity" : "amount"), null);
    if (amount === null || (kind === "dispatch" && !/^\d+$/.test(exact(amount)))) { errors.push({ ...position, message:kind==='dispatch'?"数量须为非负整数，请核对源数量列。":"扣款金额须为有效数值，空金额不能按零计入。" }); continue; }
    const identifiers = ["businessId", "order1688", "platformSkc", "supplierNumber"];
    if (identifiers.some(field => typeof get(field) === "number" && (!Number.isSafeInteger(get(field)) || Math.abs(get(field)) >= 1e15))) { errors.push({ ...position, message:"源表数字标识符可能已丢失精度，请使用原始文本单号。" }); continue; }
    const targetStore = sourceStore ? suggestSupplementStore(sourceStore,stores)||sourceStore : normalized(store);
    if (kind === "deduction" && !targetStore) { errors.push({ ...position, message:"请按实际源列或工作表映射店铺。" }); continue; }
    const mapped=new Set(Object.values(fields).map(Number).filter(value=>value>=0));
    const remarks=values.flatMap((value,col)=>!mapped.has(col)&&normalized(value)?[{column:col+1,header:normalized(headers[col]),value:normalized(value)}]:[]);
    rows.push({ ...position, ...Object.fromEntries(identifiers.map(field => [field, normalized(get(field))])), platformSkc, order1688, kind, ownerMarker:owner, inheritedFrom, inheritedIdentifiers, mergedFrom, remarks, amountHeader:kind==='deduction'?normalized(headers[Number(fields.amount)]):null, originalStore: sourceStore || source.sheetName, store: targetStore, fileHash: source.fileHash, sourceSheet: source.sheetName, sourceName: source.fileName, selected: true, ...(kind === "dispatch" ? { quantityExact: exact(amount,{nonnegative:true}) } : { signedAmountExact: exact(amount) }) });
  }
  return { rows, errors, ignored, source: { fileHash:source.fileHash, fileName:source.fileName, sheetName:source.sheetName, sourceFormat:source.sourceFormat, headerRow, mapping:fields, selection:{ownerMarker:marker,ownerField,matchMode,includeAll,store}, ignored, parserVersion:SUPPLEMENT_PARSER_VERSION } };
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
  const identities = new Set(), businessIds = new Map(), conflicts=[];
  for (const row of rows) {
    const key = supplementRowIdentity(row);
    if (identities.has(key)) throw new Error("候选包含重复源行，请移除重复来源后重新采用。");
    identities.add(key);
    if (row.businessId) {
      const business = canonicalJson([row.store,row.businessId,row.platformSkc,row.supplierNumber]);
      const previous=businessIds.get(business);
      if (previous && previous.fileHash!==row.fileHash) conflicts.push({businessId:row.businessId,platformSkc:row.platformSkc,...Object.fromEntries(['fileHash','sourceName','sourceSheet','sourceRow','recordRow','sourceFormat'].map(field=>[field,row[field]])),previousSourceName:previous.sourceName,previousSourceSheet:previous.sourceSheet,previousSourceRow:previous.sourceRow,previousRecordRow:previous.recordRow,previousSourceFormat:previous.sourceFormat,previousFileHash:previous.fileHash});
      if (!previous) businessIds.set(business,row);
    }
  }
  const quantityExact = input.kind === "dispatch" ? exact(input.mode === "manual" ? input.adoptedQuantityExact : exactSum(rows,"quantityExact"),{nonnegative:true}) : null;
  if(input.kind==='dispatch'&&(!/^\d+$/.test(quantityExact)||rows.some(row=>!/^\d+$/.test(row.quantityExact))))throw new Error('代发数量必须为非负整数。');
  if (input.kind === "dispatch" && !rows.length && input.mode !== "manual") throw new Error("没有有效代发记录，请检查来源和本人筛选。");
  if (input.kind === "deduction" && !rows.length) throw new Error("扣款尚未取得；真实零扣款请明确录入零值。");
  const coveredStores = [...new Set(rows.map(row => row.store).filter(Boolean))];
  return { kind:input.kind, period:ledger.period, mode:input.mode ?? "files", sources:input.sources ?? [], rows, conflicts, reviewedCrossFileConflicts:Boolean(input.reviewedCrossFileConflicts), adoptedQuantityExact:quantityExact, signedAmountExact:input.kind === "deduction" ? exactSum(rows,"signedAmountExact") : null, coveredStores, missingStores:input.kind === "deduction" ? stores.filter(store=>!coveredStores.includes(store)) : [], parserVersion:SUPPLEMENT_PARSER_VERSION };
}
