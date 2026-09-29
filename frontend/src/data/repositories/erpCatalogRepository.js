import { db } from "../db/clientDatabase";
import { makeId } from "../db/utils";
import { getActiveMemberContext, selectionRecordVisible } from "./selectionRepository";
import { canonicalPlatformSkc, canonicalPlatformSku } from "../../domain/identifiers";
import { buildErpCatalogRequest, validateErpCatalogRequest, validateErpCatalogInboxEnvelope, ERP_CATALOG_GROUPS } from "../../domain/erpCatalogRequest";
import { registerErpBridgeRequest } from "../../lib/erpInboxTransport";
import { validateErpCostInboxEnvelope } from "../../domain/erpInboxContract";

const requestKey = (workspace, id) => `erp-catalog:request:${workspace}:${id}`;
const resultKey = (workspace, batch) => `erp-catalog:result:${workspace}:${batch}`;
const pair = value => `${canonicalPlatformSku(value.platformSku)}\u001f${canonicalPlatformSkc(value.platformSkc)}`;
const skc = value => canonicalPlatformSkc(value.platformSkc ?? value);
const sameCatalogBasis = (a, b) => a.workspaceId === b.workspaceId && a.ledgerId === b.ledgerId
  && a.ledgerPeriod === b.ledgerPeriod && a.sourceRequestId === b.sourceRequestId
  && JSON.stringify(a.platformSkcs.map(skc).sort()) === JSON.stringify(b.platformSkcs.map(skc).sort())
  && JSON.stringify(a.sourceProductIds.toSorted()) === JSON.stringify(b.sourceProductIds.toSorted());

async function confirmedIdentities(context) {
  const [products, skus, rows, batches, ledgers] = await Promise.all([db.products.toArray(), db.platformSkus.toArray(), db.salesRows.toArray(), db.importBatches.toArray(), db.ledgers.toArray()]);
  const visible = products.filter(product => selectionRecordVisible(product, context));
  const productIds = new Set(visible.map(product => product.id));
  const ledgerIds = new Set(ledgers.filter(ledger => ledger.workspaceId === context.workspaceId).map(ledger => ledger.id));
  const batchById = new Map(batches.filter(batch => batch.workspaceId === context.workspaceId && batch.status === "completed" && ledgerIds.has(batch.ledgerId)).map(batch => [batch.id, batch]));
  const identities = [...skus.filter(item => item.workspaceId === context.workspaceId && productIds.has(item.productId)),
    ...rows.filter(row => row.workspaceId === context.workspaceId && ledgerIds.has(row.ledgerId) && batchById.get(row.batchId)?.ledgerId === row.ledgerId)]
    .filter(item => item.platformSku && item.platformSkc);
  return { products: visible, identities, ledgers };
}

// Catalog metadata can be used after durable verified receipt, even when the
// separate formal cost adoption is blocked. The original financial path keeps
// its published/request checks; this projection never adopts or writes costs.
export async function readTrustedErpCostInboxCatalogRecords(context) {
  const [inboxes, requests, local] = await Promise.all([
    db.erpCostInbox.toArray(), db.erpCostRequests.toArray(), confirmedIdentities(context),
  ]);
  const requestById = new Map(requests.filter(item => item.workspaceId === context.workspaceId).map(item => [item.id, item]));
  const known = new Set(local.identities.map(pair));
  const records = [];
  for (const inbox of inboxes) {
    const request = requestById.get(inbox.requestId);
    const ledger = local.ledgers.find(item => item.id === inbox.ledgerId && item.workspaceId === context.workspaceId);
    if (inbox.workspaceId !== context.workspaceId || !request || !ledger
      || request.ledgerId !== ledger.id || request.ledgerPeriod !== ledger.period
      || ["rejected", "voided"].includes(inbox.status) || ["cancelled", "voided"].includes(request.status)
      || !request.expectedSkus?.length || request.expectedSkus.some(item => !known.has(pair(item))
        || local.identities.some(identity => canonicalPlatformSku(identity.platformSku) === canonicalPlatformSku(item.platformSku) && skc(identity) !== skc(item)))) continue;
    try {
      const verified = validateErpCostInboxEnvelope(inbox.envelope, {
        expectedWorkspaceId: context.workspaceId, expectedLedgerId: ledger.id, expectedRequestId: request.id,
        expectedPlatformSkcs: request.platformSkcs, expectedSkus: request.expectedSkus,
      });
      if (verified.batch.batchId !== inbox.batchId || verified.deliveryId !== inbox.deliveryId) continue;
      records.push({ envelope: verified.batch, batchId: verified.batch.batchId, publishedAt: inbox.receivedAt,
        period: ledger.period, coverage: verified.batch.catalogCoverage ?? null });
    } catch { /* Keep invalid history intact but out of the trusted catalog. */ }
  }
  return records;
}

async function assertConfirmedRequest(request, context) {
  if (request.workspaceId !== context.workspaceId) throw new Error("ERP 资料请求不属于当前工作区。");
  const local = await confirmedIdentities(context);
  const known = new Set(local.identities.map(pair));
  for (const identity of request.confirmedSkus) {
    if (!known.has(pair(identity))) throw new Error(`平台 SKU ${identity.platformSku} 缺少本机已确认的 SKC 关系。`);
    if (local.identities.some(item => canonicalPlatformSku(item.platformSku) === canonicalPlatformSku(identity.platformSku) && skc(item) !== skc(identity))) throw new Error(`平台 SKU ${identity.platformSku} 的本机身份存在冲突。`);
  }
  if (request.sourceProductIds.some(id => !local.products.some(product => product.id === id))) throw new Error("ERP 资料请求的商品来源已失效或无权访问。");
  const sourceProducts = local.products.filter(product => request.sourceProductIds.includes(product.id));
  if (sourceProducts.some(product => !request.platformSkcs.some(target => skc(target) === skc(product))
    || !local.identities.some(identity => identity.productId === product.id && request.confirmedSkus.some(confirmed => pair(confirmed) === pair(identity))))) throw new Error("ERP 资料请求的商品来源与已确认身份或目标范围不匹配。");
  if (!request.sourceRequestId && request.platformSkcs.some(target => !sourceProducts.some(product => skc(product) === skc(target)))) throw new Error("ERP 资料请求的目标范围没有对应商品来源。");
  if (request.sourceRequestId) {
    const source = await db.erpCostRequests.get(request.sourceRequestId);
    if (!source || source.workspaceId !== context.workspaceId || source.ledgerId !== request.ledgerId || source.ledgerPeriod !== request.ledgerPeriod || request.platformSkcs.some(target => !source.platformSkcs.some(item => skc(item) === skc(target)))) throw new Error("ERP 资料请求的原核算来源或范围不匹配。");
  }
  return local;
}

export async function saveErpCatalogRequest(input) {
  const request = validateErpCatalogRequest(input), context = await getActiveMemberContext();
  return db.transaction("rw", db.settings, db.products, db.platformSkus, db.salesRows, db.importBatches, db.ledgers, db.erpCostRequests, db.auditEvents, async () => {
    await assertConfirmedRequest(request, context);
    const key = requestKey(request.workspaceId, request.id), previous = await db.settings.get(key);
    if (previous && JSON.stringify(previous.request) !== JSON.stringify(request)) throw new Error("ERP 资料请求 ID 已被不同范围使用。");
    if (!previous) {
      if (request.supersedesRequestId) {
        const superseded = await db.settings.get(requestKey(request.workspaceId, request.supersedesRequestId));
        if (!superseded?.request || !sameCatalogBasis(request, validateErpCatalogRequest(superseded.request))) throw new Error("ERP 资料请求只能替代同来源、同月份和同目标的已有资料请求。");
        await db.settings.put({ ...superseded, status: "superseded", supersededBy: request.id, updatedAt: request.requestedAt });
      }
      await db.settings.put({ key, kind: "erp_catalog_request", workspaceId: request.workspaceId, request, status: "waiting", createdAt: request.requestedAt });
      await db.auditEvents.add({ workspaceId: request.workspaceId, objectType: "erp_catalog_request", objectId: request.id, action: "catalog_requested", actorId: context.memberId, createdAt: request.requestedAt, localOnly: true, syncState: "local_only", after: { request } });
    }
    return request;
  });
}

export async function requestErpProductCatalog({ platformSkcs = [], productId = null, period = null, missingGroups = ERP_CATALOG_GROUPS } = {}) {
  const context = await getActiveMemberContext(), local = await confirmedIdentities(context);
  const targets = [...new Set(platformSkcs.filter(Boolean).map(value => String(value).trim()))];
  const confirmedSkus = [...new Map(local.identities.filter(item => targets.some(target => skc(target) === skc(item))).map(item => [pair(item), { platformSku: item.platformSku, platformSkc: item.platformSkc }])).values()];
  const sourceProducts = local.products.filter(product => (productId ? product.id === productId : true) && targets.some(target => skc(target) === skc(product)));
  const sources = (await db.erpCostRequests.toArray()).filter(request => request.workspaceId === context.workspaceId && targets.every(target => request.platformSkcs.some(item => skc(target) === skc(item)))).sort((a, b) => String(b.ledgerPeriod ?? "").localeCompare(String(a.ledgerPeriod ?? "")));
  const source = sourceProducts.length ? null : sources.find(request => !period || request.ledgerPeriod === period);
  const ledgerPeriod = period || source?.ledgerPeriod || local.ledgers.filter(ledger => ledger.workspaceId === context.workspaceId).map(ledger => ledger.period).sort().at(-1);
  if (!ledgerPeriod) throw new Error("请选择资料采购截止月份；没有台账时也可按明确月份补充资料。");
  const idempotencyKey = JSON.stringify([context.workspaceId, ledgerPeriod, targets.map(skc).sort(), missingGroups.slice().sort(), source?.id ?? null, sourceProducts.map(product => product.id).sort()]);
  const activeRequests = (await db.settings.toArray()).filter(item => item.kind === "erp_catalog_request" && item.workspaceId === context.workspaceId && ["waiting", "retry_required", "partial", "completed"].includes(item.status));
  const existing = activeRequests.find(item => item.request.idempotencyKey === idempotencyKey && item.status !== "completed");
  const basis = { workspaceId: context.workspaceId, ledgerId: source?.ledgerId ?? null, ledgerPeriod, platformSkcs: targets, sourceRequestId: source?.id ?? null, sourceProductIds: sourceProducts.map(product => product.id) };
  const superseded = existing ? null : activeRequests.find(item => sameCatalogBasis(basis, validateErpCatalogRequest(item.request)));
  const request = existing?.request ?? buildErpCatalogRequest({ id: makeId("ERP-CATALOG-REQ"), workspaceId: context.workspaceId, ledgerId: source?.ledgerId ?? null, ledgerPeriod, platformSkcs: targets, confirmedSkus,
    sourceRequestId: source?.id ?? null, sourceProductIds: sourceProducts.map(product => product.id), missingGroups, idempotencyKey, supersedesRequestId: superseded?.request.id ?? null });
  await saveErpCatalogRequest(request);
  const registration = await registerErpBridgeRequest({ request, expectedSkus: request.confirmedSkus });
  return { request, registered: registration?.accepted === true, status: existing?.status ?? "waiting", registration };
}

export async function receiveErpCatalogInboxEnvelope({ envelope } = {}) {
  const context = await getActiveMemberContext();
  return db.transaction("rw", db.settings, db.products, db.platformSkus, db.salesRows, db.importBatches, db.ledgers, db.erpCostRequests, db.auditEvents, async () => {
    const stored = await db.settings.get(requestKey(context.workspaceId, envelope?.catalog?.requestId));
    if (!stored?.request) throw new Error("ERP 资料返回没有匹配的本机请求。");
    if (stored.status === "superseded") throw new Error("ERP 资料请求已被新的补取请求替代，请使用当前请求。");
    const request = validateErpCatalogRequest(stored.request);
    await assertConfirmedRequest(request, context);
    const validated = validateErpCatalogInboxEnvelope(envelope, { request, expectedWorkspaceId: context.workspaceId });
    const key = resultKey(context.workspaceId, validated.catalog.batchId), previous = await db.settings.get(key);
    const delivery = (await db.settings.toArray()).find(item => item.kind === "erp_catalog_result" && item.deliveryId === validated.deliveryId);
    if (delivery && delivery.key !== key) throw new Error("ERP 资料投递标识已被其它批次使用。");
    if (previous) {
      if (JSON.stringify(previous.envelope.catalog) !== JSON.stringify(validated.catalog)) throw new Error("ERP 资料批次 ID 已被不同证据使用。");
      return { id: key, deliveryId: validated.deliveryId, batchId: validated.catalog.batchId, status: previous.status, idempotent: true };
    }
    const receivedAt = new Date().toISOString();
    await db.settings.put({ key, kind: "erp_catalog_result", workspaceId: context.workspaceId, requestId: request.id, deliveryId: validated.deliveryId, status: validated.catalog.status, envelope: validated.envelope, receivedAt });
    await db.settings.put({ ...stored, status: validated.catalog.status, receivedAt });
    await db.auditEvents.add({ workspaceId: context.workspaceId, objectType: "erp_catalog_result", objectId: key, action: "catalog_received", actorId: context.memberId, createdAt: receivedAt, localOnly: true, syncState: "local_only", after: { requestId: request.id, batchId: validated.catalog.batchId, status: validated.catalog.status } });
    return { id: key, deliveryId: validated.deliveryId, batchId: validated.catalog.batchId, status: validated.catalog.status, idempotent: false };
  });
}

export async function readTrustedErpCatalogRecords(context) {
  const settings = await db.settings.toArray(), records = [];
  for (const record of settings.filter(item => item.kind === "erp_catalog_result" && item.workspaceId === context.workspaceId)) {
    const stored = settings.find(item => item.key === requestKey(context.workspaceId, record.requestId));
    if (!stored?.request) continue;
    try {
      await assertConfirmedRequest(stored.request, context);
      const result = validateErpCatalogInboxEnvelope(record.envelope, { request: stored.request, expectedWorkspaceId: context.workspaceId });
      if (result.catalog.batchId && record.key === resultKey(context.workspaceId, result.catalog.batchId)) records.push({ ...record, catalog: result.catalog, request: stored.request });
    } catch { /* Preserve invalid source history but exclude it from trusted display. */ }
  }
  return records;
}
