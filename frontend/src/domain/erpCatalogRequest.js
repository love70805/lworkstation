import { normalizeErpCatalogFields, normalizeErpCatalogMappings, normalizeErpCatalogCoverage, normalizeErpCatalogUrl } from './erpCatalogFields.js';
import { canonicalPlatformSkc, canonicalPlatformSku, canonicalWarehouseSku, normalizePlatformSkc, normalizePlatformSku, normalizeWarehouseSku, normalizeWorkspaceId } from './identifiers.js';

export const ERP_CATALOG_REQUEST_KIND = 'catalog';
export const ERP_CATALOG_MESSAGE_TYPE = 'shopeers.erp.catalog.batch';
export const ERP_CATALOG_INBOX_FORMAT = 'shopeers-erp-catalog-inbox';
export const ERP_CATALOG_BATCH_FORMAT = 'shopeers-erp-catalog-batch';
export const ERP_CATALOG_VERSION = 1;
export const ERP_CATALOG_GROUPS = Object.freeze(['directory', 'mappings', 'images', 'suppliers', 'purchaseEvidence']);

const required = (value, label) => { const text = String(value ?? '').trim(); if (!text) throw new Error(`${label}不能为空。`); return text; };
const optional = value => String(value ?? '').trim() || null;
const timestamp = (value, label) => { const text = required(value, label); if (!Number.isFinite(Date.parse(text))) throw new Error(`${label}不是有效时间。`); return text; };
const unique = values => [...new Set((Array.isArray(values) ? values : []).map(optional).filter(Boolean))];
const period = value => { const text = required(value, 'ERP 资料适用月份'); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) throw new Error('ERP 资料适用月份必须为 YYYY-MM。'); return text; };
const evidenceRef = sku => `warehouse:${canonicalWarehouseSku(sku)}`;

function skcs(values) {
  const result = new Map();
  for (const item of Array.isArray(values) ? values : []) { const sku = normalizePlatformSkc(typeof item === 'string' ? item : item?.platformSkc); result.set(canonicalPlatformSkc(sku), sku); }
  if (!result.size) throw new Error('ERP 资料请求至少需要一个已经确认的平台 SKC。');
  return [...result.values()];
}

export function validateErpCatalogRequest(value) {
  if (!value || value.kind !== ERP_CATALOG_REQUEST_KIND) throw new Error('ERP 资料请求类型不受支持。');
  const platformSkcs = skcs(value.platformSkcs);
  const scope = new Set(platformSkcs.map(canonicalPlatformSkc));
  const confirmed = new Map();
  for (const entry of Array.isArray(value.confirmedSkus) ? value.confirmedSkus : []) {
    const platformSku = normalizePlatformSku(entry?.platformSku), platformSkc = normalizePlatformSkc(entry?.platformSkc);
    if (!scope.has(canonicalPlatformSkc(platformSkc))) throw new Error('ERP 资料请求的确认身份超出目标 SKC 范围。');
    const previous = confirmed.get(canonicalPlatformSku(platformSku));
    if (previous && canonicalPlatformSkc(previous.platformSkc) !== canonicalPlatformSkc(platformSkc)) throw new Error(`平台 SKU ${platformSku} 的确认身份存在冲突。`);
    confirmed.set(canonicalPlatformSku(platformSku), { platformSku, platformSkc });
  }
  if (platformSkcs.some(skc => ![...confirmed.values()].some(entry => canonicalPlatformSkc(entry.platformSkc) === canonicalPlatformSkc(skc)))) throw new Error('ERP 资料请求的每个 SKC 均须有本机已确认的 SKU 身份。');
  const sourceRequestId = optional(value.sourceRequestId), sourceProductIds = unique(value.sourceProductIds);
  if (!sourceRequestId && !sourceProductIds.length) throw new Error('ERP 资料请求缺少已验证请求或已有商品来源。');
  const missingGroups = unique(value.missingGroups ?? ERP_CATALOG_GROUPS);
  if (!missingGroups.length || missingGroups.some(group => !ERP_CATALOG_GROUPS.includes(group))) throw new Error('ERP 资料补取分组不受支持。');
  const id = required(value.id ?? value.requestId, 'ERP 资料请求 ID');
  const supersedesRequestId = optional(value.supersedesRequestId);
  if (supersedesRequestId === id) throw new Error('ERP 资料请求不能替代自身。');
  return { kind: ERP_CATALOG_REQUEST_KIND, id, requestId: id, workspaceId: normalizeWorkspaceId(value.workspaceId), ledgerId: optional(value.ledgerId), ledgerPeriod: period(value.ledgerPeriod), platformSkcs, confirmedSkus: [...confirmed.values()], sourceRequestId, sourceProductIds, missingGroups, supersedesRequestId, catalogVersion: ERP_CATALOG_VERSION, idempotencyKey: required(value.idempotencyKey, 'ERP 资料幂等标识'), requestedAt: timestamp(value.requestedAt, 'ERP 资料请求时间') };
}

export function buildErpCatalogRequest(value = {}) {
  return validateErpCatalogRequest({ ...value, kind: ERP_CATALOG_REQUEST_KIND, requestedAt: value.requestedAt ?? new Date().toISOString() });
}

function number(value, label) {
  if (value == null || String(value).trim() === '') return null;
  const result = Number(value); if (!Number.isFinite(result) || result < 0) throw new Error(`${label}必须为非负数字。`); return result;
}

export function normalizeErpCatalogPurchaseEvidence(value) {
  const source = Array.isArray(value) ? value : value?.warehouses;
  const seen = new Set();
  return (Array.isArray(source) ? source : []).map(entry => {
    const warehouseSku = normalizeWarehouseSku(entry?.warehouseSku), canonical = canonicalWarehouseSku(warehouseSku);
    if (seen.has(canonical)) throw new Error(`ERP 资料采购证据的仓库 SKU 重复：${warehouseSku}。`);
    seen.add(canonical);
    const ref = optional(entry?.evidenceRef) ?? evidenceRef(warehouseSku);
    if (ref !== evidenceRef(warehouseSku)) throw new Error('ERP 资料采购证据与仓库 SKU 不一致。');
    const normalizeRecords = (records, excluded) => (Array.isArray(records) ? records : []).map((record, index) => {
      if (optional(record?.warehouseSku) && canonicalWarehouseSku(record.warehouseSku) !== canonical) throw new Error('ERP 资料采购记录与仓库证据不一致。');
      return {
        recordId: required(record?.recordId ?? record?.id, `ERP 资料第 ${index + 1} 条采购记录 ID`), warehouseSku,
      productName: optional(record?.productName ?? record?.name), quantity: number(record?.quantity ?? record?.qty, '采购数量'), unitPrice: number(record?.unitPrice, '采购单价'), totalPrice: number(record?.totalPrice, '采购金额'),
      purchaseDate: optional(record?.purchaseDate ?? record?.date), order1688: optional(record?.order1688), purchaseOrderNo: optional(record?.purchaseOrderNo), purchaseOrderId: optional(record?.purchaseOrderId),
      supplierName: optional(record?.supplierName), supplier1688Url: normalizeErpCatalogUrl(record?.supplier1688Url), ...normalizeErpCatalogFields(record, { includeMappings: false }),
      eligible: excluded ? false : record?.eligible !== false, selectedForPreview: false, exclusionReasons: unique(record?.exclusionReasons), warningReasons: unique(record?.warningReasons),
      statusFields: Object.fromEntries(Object.entries(record?.statusFields ?? {}).filter(([key, child]) => ['purchaseStatus', 'paymentStatus', 'payStatus', 'orderStatus', 'order1688Status', 'orderStatus1688', 'purchaseOrderStatus1688', 'purchaseOrderStatus', 'status'].includes(key) && child != null && ['string', 'number', 'boolean'].includes(typeof child))),
      };
    });
    const sourceWarnings = unique(entry?.sourceWarnings);
    return { warehouseSku, canonicalWarehouseSku: canonical, evidenceRef: ref, purchaseRecords: normalizeRecords(entry?.purchaseRecords, false), excludedRecords: normalizeRecords(entry?.excludedRecords, true), sourceWarnings, evidenceComplete: entry?.evidenceComplete === true && !sourceWarnings.length };
  });
}

export function validateErpCatalogInboxEnvelope(value, { request = null, expectedWorkspaceId = null } = {}) {
  if (!value || value.type !== ERP_CATALOG_MESSAGE_TYPE || value.source !== 'erp-assistant-v8' || value.format !== ERP_CATALOG_INBOX_FORMAT || Number(value.formatVersion) !== ERP_CATALOG_VERSION) throw new Error('ERP 资料收件包来源或版本不受支持。');
  const input = value.catalog;
  if (!input || input.format !== ERP_CATALOG_BATCH_FORMAT || Number(input.formatVersion) !== ERP_CATALOG_VERSION) throw new Error('ERP 资料批次版本不受支持。');
  const workspaceId = normalizeWorkspaceId(input.workspaceId), requestId = required(input.requestId, 'ERP 资料请求 ID');
  const ledgerPeriod = period(input.ledgerPeriod), platformSkcs = skcs(input.query?.platformSkcs);
  if (input.query?.unit !== 'platform_skc') throw new Error('ERP 资料查询单位必须为平台 SKC。');
  const trustedRequest = request ? validateErpCatalogRequest(request) : null;
  if (expectedWorkspaceId && workspaceId !== normalizeWorkspaceId(expectedWorkspaceId)) throw new Error('ERP 资料工作区不匹配。');
  if (trustedRequest && (workspaceId !== trustedRequest.workspaceId || requestId !== trustedRequest.id || ledgerPeriod !== trustedRequest.ledgerPeriod || optional(input.ledgerId) !== trustedRequest.ledgerId)) throw new Error('ERP 资料请求、工作区、账本或适用月份不匹配。');
  const scope = new Set(platformSkcs.map(canonicalPlatformSkc));
  if (trustedRequest && platformSkcs.some(skc => !trustedRequest.platformSkcs.some(target => canonicalPlatformSkc(target) === canonicalPlatformSkc(skc)))) throw new Error('ERP 资料返回扩大了已登记的 SKC 范围。');
  if (!Array.isArray(input.rows)) throw new Error('ERP 资料行必须为数组。');
  const rowsByKey = new Map();
  for (const source of input.rows) {
    const platformSku = normalizePlatformSku(source?.platformSku), platformSkc = normalizePlatformSkc(source?.platformSkc), warehouseSku = normalizeWarehouseSku(source?.warehouseSku);
    if (!scope.has(canonicalPlatformSkc(platformSkc))) throw new Error('ERP 资料包含目标 SKC 之外的身份。');
    const fields = normalizeErpCatalogFields(source);
    const sourceWarnings = unique(source?.sourceWarnings);
    const confirmed = trustedRequest?.confirmedSkus.find(item => canonicalPlatformSku(item.platformSku) === canonicalPlatformSku(platformSku));
    if (confirmed && canonicalPlatformSkc(confirmed.platformSkc) !== canonicalPlatformSkc(platformSkc)) sourceWarnings.push('catalog_identity_conflict:confirmed_skc');
    const mappings = normalizeErpCatalogMappings(fields.catalogMappings ?? [{ platformSku, platformSkc, warehouseSku }]);
    if (!mappings.some(mapping => mapping.platformSku && mapping.platformSkc && mapping.warehouseSku && canonicalPlatformSku(mapping.platformSku) === canonicalPlatformSku(platformSku) && canonicalPlatformSkc(mapping.platformSkc) === canonicalPlatformSkc(platformSkc) && canonicalWarehouseSku(mapping.warehouseSku) === canonicalWarehouseSku(warehouseSku))) throw new Error('ERP 资料行缺少准确对应的 SKC—SKU—仓库映射。');
    const row = { platformSku, platformSkc, warehouseSku, canonicalPlatformSku: canonicalPlatformSku(platformSku), canonicalPlatformSkc: canonicalPlatformSkc(platformSkc), canonicalWarehouseSku: canonicalWarehouseSku(warehouseSku), productName: optional(source?.productName ?? source?.name), supplierName: optional(source?.supplierName), supplier1688Url: normalizeErpCatalogUrl(source?.supplier1688Url), evidenceRef: evidenceRef(warehouseSku), ...fields, catalogMappings: mappings, sourceWarnings: unique(sourceWarnings) };
    const key = JSON.stringify(row);
    if (!rowsByKey.has(key)) rowsByKey.set(key, { ...row, sourceRow: rowsByKey.size + 1 });
  }
  const rows = [...rowsByKey.values()], warehouses = new Set(rows.map(row => row.canonicalWarehouseSku));
  const warehouseEvidence = normalizeErpCatalogPurchaseEvidence(input.warehouseEvidence);
  if (warehouseEvidence.some(entry => !warehouses.has(entry.canonicalWarehouseSku))) throw new Error('ERP 资料采购证据超出已确认仓库映射。');
  const coverage = normalizeErpCatalogCoverage(input.coverage);
  const catalog = { format: ERP_CATALOG_BATCH_FORMAT, formatVersion: ERP_CATALOG_VERSION, catalogVersion: ERP_CATALOG_VERSION, batchId: required(input.batchId, 'ERP 资料批次 ID'), workspaceId, ledgerId: optional(input.ledgerId), ledgerPeriod, requestId, generatedAt: timestamp(input.generatedAt, 'ERP 资料采集时间'), query: { unit: 'platform_skc', platformSkcs }, coverage, rows, warehouseEvidence, status: Object.values(coverage).every(group => group.state === 'complete') ? 'completed' : rows.length ? 'partial' : 'retry_required' };
  const deliveryId = required(value.deliveryId, 'ERP 资料投递 ID');
  return { envelope: { type: ERP_CATALOG_MESSAGE_TYPE, source: 'erp-assistant-v8', format: ERP_CATALOG_INBOX_FORMAT, formatVersion: ERP_CATALOG_VERSION, deliveryId, sentAt: timestamp(value.sentAt, 'ERP 资料投递时间'), transport: required(value.transport ?? 'local-http', 'ERP 资料传输方式'), catalog }, catalog, rows, warehouseEvidence, deliveryId, workspaceId, requestId };
}

export function buildErpCatalogInboxEnvelope({ catalog, deliveryId, sentAt = new Date().toISOString(), transport = 'local-http' } = {}, options = {}) {
  return validateErpCatalogInboxEnvelope({ type: ERP_CATALOG_MESSAGE_TYPE, source: 'erp-assistant-v8', format: ERP_CATALOG_INBOX_FORMAT, formatVersion: ERP_CATALOG_VERSION, deliveryId, sentAt, transport, catalog: { ...catalog, format: ERP_CATALOG_BATCH_FORMAT, formatVersion: ERP_CATALOG_VERSION } }, options).envelope;
}

export { normalizeErpCatalogCoverage, normalizeErpUnitConversion } from './erpCatalogFields.js';
