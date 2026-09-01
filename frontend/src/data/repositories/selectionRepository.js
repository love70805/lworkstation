import {
  assertUniquePlatformSkus,
  canonicalPlatformSkc,
  canonicalPlatformSku,
  canonicalWarehouseSku,
  normalizePlatformSkc,
  normalizePlatformSku,
  normalizeWarehouseSku,
} from "../../domain/identifiers";
import { calculateSupplierLandedUnitCost, validateProductDraft } from "../../domain/productCatalog";
import { buildProductDataReadiness, normalizeProductPublicationStatus } from "../../domain/productPublication";
import { calculateReferenceProfitLine, DEFAULT_WAREHOUSE_RATE } from "../../domain/profitCalculations";
import {
  activeSelectionStatusDefinitions,
  defaultSelectionStatusDefinitions,
  normalizeSelectionStatusDefinitions,
  resolveSelectionStatusId,
  selectionStatusById,
} from "../../domain/selectionStatuses";
import { db } from "../db/clientDatabase";
import {
  ACTIVE_MEMBER_CONTEXT_KEY,
  DEFAULT_MEMBER_ID,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_NAME,
} from "../db/constants";
import { makeId } from "../db/utils";
import {
  activeSupplierOffer,
  catalogDisplaySupplierProfiles,
  catalogPendingVariants,
  catalogSupplierHasData,
  catalogSupplierIdentity,
  catalogSupplierNaturalKey,
  catalogSupplierOfferKey,
  catalogSupplierProfile,
  catalogSupplierProfiles,
  catalogText,
  supplierOfferContent,
} from "./selectionCatalogUtils";
export async function getActiveMemberContext() {
  const saved = await db.settings.get(ACTIVE_MEMBER_CONTEXT_KEY);
  const memberId = catalogText(saved?.memberId) || DEFAULT_MEMBER_ID;
  const role = catalogText(saved?.role).toLowerCase() || "admin";
  return {
    memberId,
    role,
    canSeeAllSelection: role === "admin" || role === "operations" || role === "finance",
    workspaceId: saved?.workspaceId ?? DEFAULT_WORKSPACE_ID,
  };
}

export async function setActiveMemberContext({ memberId = DEFAULT_MEMBER_ID, role = "admin", workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
  const context = {
    key: ACTIVE_MEMBER_CONTEXT_KEY,
    memberId: catalogText(memberId) || DEFAULT_MEMBER_ID,
    role: catalogText(role).toLowerCase() || "admin",
    workspaceId: catalogText(workspaceId) || DEFAULT_WORKSPACE_ID,
    updatedAt: new Date().toISOString(),
  };
  await db.settings.put(context);
  return getActiveMemberContext();
}

export function selectionRecordVisible(record, context) {
  if (!record || record.status === "deleted") return false;
  if (record.workspaceId && context.workspaceId && record.workspaceId !== context.workspaceId) return false;
  if (context.canSeeAllSelection) return true;
  const visibility = catalogText(record.visibility) || "workspace";
  return visibility !== "private" || catalogText(record.ownerId) === context.memberId;
}

function defaultProductDraft(overrides = {}) {
  return {
    name: "",
    englishTitle: "",
    salesPlatform: "",
    publicationStatus: "unpublished",
    platformSkc: "",
    store: "",
    imageUrl: "",
    supplierCode: "",
    supplierName: "",
    sourceProductId: "",
    sourceUrl: "",
    shippingAmount: 0,
    handlingFee: 0,
    packageWeight: "",
    ownerId: "",
    visibility: "",
    salesStatus: "pending_review",
    tags: [],
    notes: "",
    suppliers: [],
    variants: [],
    ...overrides,
  };
}

export async function ensureDefaultWorkspace() {
  const existing = await db.workspaces.get(DEFAULT_WORKSPACE_ID);
  if (existing) return existing;
  const now = new Date().toISOString();
  const workspace = {
    id: DEFAULT_WORKSPACE_ID,
    name: DEFAULT_WORKSPACE_NAME,
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    selectionStatusDefinitions: defaultSelectionStatusDefinitions(),
    createdAt: now,
    updatedAt: now,
  };
  await db.workspaces.put(workspace);
  return workspace;
}

async function getSelectionStatusWorkspace() {
  const context = await getActiveMemberContext();
  const existing = await db.workspaces.get(context.workspaceId);
  if (existing) return { workspace: existing, context };
  if (context.workspaceId === DEFAULT_WORKSPACE_ID) return { workspace: await ensureDefaultWorkspace(), context };
  const now = new Date().toISOString();
  const workspace = {
    id: context.workspaceId,
    name: context.workspaceId,
    defaultCurrency: "CNY",
    timezone: "Asia/Shanghai",
    selectionStatusDefinitions: defaultSelectionStatusDefinitions(),
    createdAt: now,
    updatedAt: now,
  };
  await db.workspaces.put(workspace);
  return { workspace, context };
}

export async function getSelectionStatusDefinitions() {
  const context = await getActiveMemberContext();
  const workspace = await db.workspaces.get(context.workspaceId);
  return normalizeSelectionStatusDefinitions(workspace?.selectionStatusDefinitions);
}

export async function saveSelectionStatusDefinitions({ definitions, updatedBy = "local-user" } = {}) {
  const { workspace, context } = await getSelectionStatusWorkspace();
  const normalized = normalizeSelectionStatusDefinitions(definitions);
  const active = activeSelectionStatusDefinitions(normalized);
  if (!active.length) throw new Error("至少需要保留一个可选销售状态。");
  const now = new Date().toISOString();
  const savedWorkspace = {
    ...workspace,
    selectionStatusDefinitions: normalized,
    updatedAt: now,
  };
  await db.transaction("rw", db.workspaces, db.auditEvents, async () => {
    await db.workspaces.put(savedWorkspace);
    await db.auditEvents.add({
      workspaceId: context.workspaceId,
      objectType: "selection_status_definitions",
      objectId: context.workspaceId,
      action: "selection_status_definitions_updated",
      actorId: updatedBy,
      before: { selectionStatusDefinitions: workspace.selectionStatusDefinitions ?? defaultSelectionStatusDefinitions() },
      after: { snapshot: savedWorkspace },
      createdAt: now,
    });
  });
  return normalized;
}

function productValidationMessage(issue) {
  const messages = {
    product_name_required: "商品名称不能为空。",
    platform_skc_required: "平台 SKC 不能为空。",
    platform_sku_required: "至少需要一个平台 SKU。",
    package_weight_required: "存在运费时必须填写大于 0 的包装重量。",
  };
  if (messages[issue]) return messages[issue];
  const variantMatch = /^variant_(\d+)_(.+)$/.exec(issue);
  if (!variantMatch) return "商品资料仍有阻断项。";
  const index = Number(variantMatch[1]) + 1;
  const variantMessages = {
    platform_sku_required: `第 ${index} 个规格缺少平台 SKU。`,
    platform_sku_duplicate: `第 ${index} 个规格的平台 SKU 与其他规格重复。`,
    purchase_pack_count_invalid: `第 ${index} 个规格的采购份数必须大于 0。`,
    units_per_pack_invalid: `第 ${index} 个规格的每份单品数必须大于 0。`,
  };
  return variantMessages[variantMatch[2]] ?? `第 ${index} 个规格仍有阻断项。`;
}

function captureTimestamp(value, fallback) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString();
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export async function receiveSelectionCaptureEnvelope({ envelope, inboxRecord = null, receivedVia = "local-http" } = {}) {
  if (!envelope || envelope.schemaVersion !== 1 || envelope.source !== "1688") {
    throw new Error("1688 采集包版本或来源不受支持。");
  }
  const memberContext = await getActiveMemberContext();
  const workspaceId = memberContext.workspaceId || DEFAULT_WORKSPACE_ID;
  const product = envelope.product ?? {};
  const requestId = catalogText(envelope.requestId);
  if (!requestId) throw new Error("1688 采集包缺少 requestId。");
  const existingCaptures = await db.captures.where("workspaceId").equals(workspaceId).toArray();
  const sourceProductId = catalogText(product.sourceProductId);
  const sourceUrl = catalogText(envelope.sourceUrl);
  const sourceSkuIds = new Set((product.skus ?? []).map((sku) => catalogText(sku?.sourceSkuId).toUpperCase()).filter(Boolean));
  const duplicate = existingCaptures.find((capture) => {
    if (capture.requestId === requestId) return true;
    if (sourceProductId && catalogText(capture.sourceProductId).toUpperCase() === sourceProductId.toUpperCase()) return true;
    if (sourceUrl && catalogText(capture.sourceUrl) === sourceUrl) return true;
    const existingSkuIds = new Set((capture.draft?.variants ?? []).map((variant) => catalogText(variant.sourceSku).toUpperCase()).filter(Boolean));
    return sourceSkuIds.size > 0 && [...sourceSkuIds].some((id) => existingSkuIds.has(id));
  });
  if (duplicate) return { status: "duplicate", capture: duplicate };

  const variants = (Array.isArray(product.skus) ? product.skus : []).map((sku, index) => ({
    id: makeId("VAR"),
    attribute: catalogText(sku.spec) || `规格 ${index + 1}`,
    color: "",
    swatch: "#9ca3af",
    platformSku: "",
    sourceSku: catalogText(sku.sourceSkuId),
    imageUrl: catalogText(sku.imageUrl) || catalogText(product.imageUrl),
    purchaseUnitPrice: sku.purchasePrice ?? product.purchasePrice ?? "",
    salePrice: "",
    purchasePackCount: Math.max(1, Number(sku.purchaseQty ?? product.purchaseQty ?? 1) || 1),
    unitsPerPack: Math.max(1, Number(product.bundleQty ?? 1) || 1),
  }));
  const supplierVariants = variants.map((variant) => ({
    platformSku: variant.platformSku,
    sourceSku: variant.sourceSku,
    purchaseUnitPrice: variant.purchaseUnitPrice,
    purchasePackCount: variant.purchasePackCount,
    unitsPerPack: variant.unitsPerPack,
  }));
  const draft = defaultProductDraft({
    name: catalogText(product.name),
    platformSkc: catalogText(product.platformSkc),
    imageUrl: catalogText(product.imageUrl),
    sourceProductId,
    sourceUrl,
    shippingAmount: Number(product.shippingFee) || 0,
    handlingFee: 0,
    suppliers: [{
      id: makeId("SUP"),
      supplierCode: "",
      supplierName: "1688 采集供应商",
      sourceProductId,
      sourceUrl,
      shippingAmount: Number(product.shippingFee) || 0,
      handlingFee: 0,
      variants: supplierVariants,
    }],
    variants,
    captureWarnings: Array.isArray(envelope.warnings) ? envelope.warnings : [],
  });
  const baseValidation = validateProductDraft(draft);
  const warningIssues = [
    ...baseValidation.warningIssues,
    ...(Array.isArray(envelope.warnings) ? envelope.warnings.map((warning, index) => `capture_warning_${index}_${catalogText(warning.code) || "unknown"}`) : []),
  ];
  const validation = {
    ...baseValidation,
    warningIssues,
    warningCount: warningIssues.length,
  };
  const now = new Date().toISOString();
  const capture = {
    id: catalogText(inboxRecord?.captureId) || makeId("CAP"),
    workspaceId,
    requestId,
    batchId: catalogText(inboxRecord?.deliveryId) || `SEL-BATCH-${requestId}`,
    source: "1688",
    captureMethod: "browser-extension",
    sourceProductId,
    sourceUrl,
    sourceTitle: catalogText(product.name),
    imageUrl: catalogText(product.imageUrl),
    supplierCode: "",
    ownerId: catalogText(inboxRecord?.ownerId) || memberContext.memberId,
    visibility: inboxRecord?.visibility === "private" ? "private" : memberContext.canSeeAllSelection ? "workspace" : "private",
    status: validation.valid ? "pending" : "blocked",
    draft,
    validation,
    warnings: Array.isArray(envelope.warnings) ? envelope.warnings : [],
    rawEnvelope: envelope,
    capturedBy: `1688-extension:${catalogText(envelope.extractorVersion) || "unknown"}`,
    capturedAt: captureTimestamp(envelope.capturedAt, now),
    receivedVia,
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction("rw", db.captures, db.auditEvents, async () => {
    const concurrent = await db.captures.where("requestId").equals(requestId).first();
    if (concurrent) return;
    await db.captures.add(capture);
    await db.auditEvents.add({
      workspaceId,
      objectType: "capture",
      objectId: capture.id,
      action: "capture_created",
      actorId: capture.capturedBy,
      createdAt: now,
      after: {
        source: "1688",
        sourceProductId,
        status: capture.status,
        captureMethod: capture.captureMethod,
        snapshot: capture,
      },
    });
  });
  return { status: "accepted", capture };
}

export async function createManualCaptureRecord({
  name,
  sourceUrl,
  sourceProductId = "",
  supplierCode = "",
  supplierName = "",
  imageUrl = "",
  capturedBy = "local-user",
  workspaceId = DEFAULT_WORKSPACE_ID,
}) {
  const normalizedName = catalogText(name);
  const normalizedUrl = catalogText(sourceUrl);
  if (!normalizedName) throw new Error("采集商品名称不能为空。");
  if (!normalizedUrl) throw new Error("1688 来源链接不能为空。");

  await ensureDefaultWorkspace();
  const memberContext = await getActiveMemberContext();
  const capturedAt = new Date().toISOString();
  const id = makeId("CAP");
  const draft = defaultProductDraft({
    name: normalizedName,
    sourceUrl: normalizedUrl,
    sourceProductId: catalogText(sourceProductId),
    supplierCode: catalogText(supplierCode),
    supplierName: catalogText(supplierName),
    imageUrl: catalogText(imageUrl),
  });
  const validation = validateProductDraft(draft);
  const capture = {
    id,
    workspaceId,
    requestId: makeId("CAP-REQ"),
    batchId: makeId("CAP-BATCH"),
    source: "1688",
    captureMethod: "manual",
    sourceProductId: draft.sourceProductId,
    sourceUrl: draft.sourceUrl,
    sourceTitle: normalizedName,
    imageUrl: draft.imageUrl,
    supplierCode: draft.supplierCode,
    ownerId: memberContext.memberId,
    visibility: memberContext.canSeeAllSelection ? "workspace" : "private",
    status: validation.valid ? "pending" : "blocked",
    draft,
    validation,
    capturedBy,
    capturedAt,
    updatedAt: capturedAt,
  };

  await db.transaction("rw", db.captures, db.auditEvents, async () => {
    await db.captures.add(capture);
    await db.auditEvents.add({
      workspaceId,
      objectType: "capture",
      objectId: id,
      action: "capture_created",
      actorId: capturedBy,
      createdAt: capturedAt,
      after: {
        source: "1688",
        sourceProductId: draft.sourceProductId,
        status: capture.status,
        snapshot: capture,
      },
    });
  });

  return capture;
}

export async function updateCaptureDraft({ captureId, draft, updatedBy = "local-user" }) {
  const existing = await db.captures.get(captureId);
  if (!existing) throw new Error("找不到对应的采集记录。");
  if (!selectionRecordVisible(existing, await getActiveMemberContext())) throw new Error("当前账号无权访问该采集记录。");
  if (["confirmed", "ignored"].includes(existing.status)) throw new Error("该采集记录已经结束处理，不能继续修改。");

  const normalizedDraft = defaultProductDraft({ ...existing.draft, ...draft });
  const validation = validateProductDraft(normalizedDraft);
  const updatedAt = new Date().toISOString();
  const savedCapture = {
    ...existing,
    draft: normalizedDraft,
    validation,
    status: validation.valid ? "pending" : "blocked",
    sourceProductId: catalogText(normalizedDraft.sourceProductId),
    sourceUrl: catalogText(normalizedDraft.sourceUrl),
    imageUrl: catalogText(normalizedDraft.imageUrl),
    supplierCode: catalogText(normalizedDraft.supplierCode),
    updatedAt,
  };
  await db.transaction("rw", db.captures, db.auditEvents, async () => {
    await db.captures.put(savedCapture);
    await db.auditEvents.add({
      workspaceId: existing.workspaceId,
      objectType: "capture",
      objectId: captureId,
      action: "capture_draft_saved",
      actorId: updatedBy,
      createdAt: updatedAt,
      after: {
        status: validation.valid ? "pending" : "blocked",
        ...validation,
        snapshot: savedCapture,
      },
    });
  });
  return validation;
}

export async function ignoreCaptureRecord(captureId, ignoredBy = "local-user") {
  const capture = await db.captures.get(captureId);
  if (!capture) throw new Error("找不到对应的采集记录。");
  if (!selectionRecordVisible(capture, await getActiveMemberContext())) throw new Error("当前账号无权访问该采集记录。");
  if (capture.status === "confirmed") throw new Error("已确认入库的采集记录不能忽略。");
  const ignoredAt = new Date().toISOString();
  const savedCapture = {
    ...capture,
    status: "ignored",
    ignoredAt,
    ignoredBy,
    updatedAt: ignoredAt,
  };
  await db.transaction("rw", db.captures, db.auditEvents, async () => {
    await db.captures.put(savedCapture);
    await db.auditEvents.add({
      workspaceId: capture.workspaceId,
      objectType: "capture",
      objectId: captureId,
      action: "capture_ignored",
      actorId: ignoredBy,
      createdAt: ignoredAt,
      before: { status: capture.status },
      after: {
        status: "ignored",
        snapshot: savedCapture,
      },
    });
  });
}

export async function listPendingCaptureRecords() {
  const [captures, context] = await Promise.all([db.captures.toArray(), getActiveMemberContext()]);
  return captures
    .filter((capture) => ["pending", "blocked", "needs_review", "draft"].includes(capture.status) && selectionRecordVisible(capture, context))
    .toSorted((a, b) => String(b.capturedAt ?? b.updatedAt ?? "").localeCompare(String(a.capturedAt ?? a.updatedAt ?? "")));
}

export async function getProductEditorSnapshot({ captureId = null, productId = null, platformSkc = "", platformSku = "", productName = "" } = {}) {
  const memberContext = await getActiveMemberContext();
  const statusDefinitions = await getSelectionStatusDefinitions();
  if (captureId) {
    const capture = await db.captures.get(captureId);
    if (!capture || !selectionRecordVisible(capture, memberContext)) return null;
    return {
      mode: "capture",
      capture,
      product: null,
      draft: defaultProductDraft({
        ...capture.draft,
        salesStatus: resolveSelectionStatusId(capture.draft?.salesStatus ?? "pending_review", statusDefinitions),
      }),
      validation: capture.validation ?? validateProductDraft(capture.draft),
    };
  }

  if (productId) {
    const product = await db.products.get(productId);
    if (!product || !selectionRecordVisible(product, memberContext)) return null;
    const [skuRows, storedOffers] = await Promise.all([
      db.platformSkus.where("productId").equals(productId).toArray(),
      db.supplierOffers.where("productId").equals(productId).toArray(),
    ]);
    const offers = storedOffers.filter(activeSupplierOffer);
    const offerBySku = new Map();
    offers.forEach((offer) => {
      const key = offer.canonicalPlatformSku ?? canonicalPlatformSku(offer.platformSku);
      if (!offerBySku.has(key)) offerBySku.set(key, offer);
    });
    const savedVariants = [
      ...skuRows.map((sku) => {
        const offer = offerBySku.get(sku.canonicalPlatformSku) ?? {};
        return {
          id: sku.id,
          platformSku: sku.platformSku,
          sourceSku: sku.sourceSku ?? offer.sourceSku ?? "",
          warehouseSku: sku.warehouseSku ?? "",
          attribute: sku.attribute ?? "",
          color: sku.color ?? "",
          swatch: sku.swatch ?? "#9ca3af",
          purchaseUnitPrice: offer.purchaseUnitPrice ?? "",
          purchasePackCount: offer.purchasePackCount ?? 1,
          unitsPerPack: offer.unitsPerPack ?? 1,
          landedUnitCost: offer.landedUnitCost ?? null,
          salePrice: sku.salePrice ?? sku.price ?? "",
          imageUrl: sku.imageUrl ?? "",
        };
      }),
      ...catalogPendingVariants(product.attributes?.pendingVariants),
    ];
    const supplierGroups = new Map();
    const supplierGroupsByNaturalKey = new Map();
    const addSupplier = (supplier, fallback) => {
      const profile = catalogSupplierProfile(supplier, fallback);
      const naturalKey = catalogSupplierNaturalKey(profile);
      const current = supplierGroups.get(profile.supplierId) ?? (naturalKey ? supplierGroupsByNaturalKey.get(naturalKey) : null);
      if (current) {
        supplierGroups.set(profile.supplierId, current);
        if (naturalKey) supplierGroupsByNaturalKey.set(naturalKey, current);
        current.supplierCode ||= profile.supplierCode;
        current.supplierName ||= profile.supplierName;
        current.sourceProductId ||= profile.sourceProductId;
        current.sourceUrl ||= profile.sourceUrl;
        current.shippingAmount ||= profile.shippingAmount;
        current.handlingFee ||= profile.handlingFee;
        if (!current.profileVariants.length && profile.variants.length) current.profileVariants = profile.variants;
        return current;
      }
      const next = { ...profile, profileVariants: profile.variants, offerBySku: new Map() };
      supplierGroups.set(profile.supplierId, next);
      if (naturalKey) supplierGroupsByNaturalKey.set(naturalKey, next);
      return next;
    };
    const storedProfiles = catalogSupplierProfiles(product.attributes?.supplierProfiles ?? []);
    if (!storedProfiles.length && catalogSupplierHasData(product)) storedProfiles.push(catalogSupplierProfile(product));
    storedProfiles.forEach((profile) => addSupplier(profile, profile.id));
    offers.forEach((offer) => {
      const group = addSupplier(offer, offer.id);
      const key = offer.canonicalPlatformSku ?? canonicalPlatformSku(offer.platformSku);
      group.offerBySku.set(key, offer);
    });
    const suppliers = [...new Set(supplierGroups.values())].map((supplier) => ({
      id: supplier.id,
      supplierId: supplier.supplierId,
      supplierCode: supplier.supplierCode,
      supplierName: supplier.supplierName,
      sourceProductId: supplier.sourceProductId,
      sourceUrl: supplier.sourceUrl,
      shippingAmount: supplier.shippingAmount,
      handlingFee: supplier.handlingFee,
      variants: savedVariants.map((variant, index) => {
        const platformSku = catalogText(variant.platformSku);
        const profileVariant = platformSku
          ? supplier.profileVariants.find((item) => catalogText(item.platformSku) && canonicalPlatformSku(item.platformSku) === canonicalPlatformSku(platformSku))
          : supplier.profileVariants[index];
        const offer = platformSku ? supplier.offerBySku.get(canonicalPlatformSku(platformSku)) : null;
        return {
          platformSku,
          sourceSku: offer?.sourceSku ?? profileVariant?.sourceSku ?? "",
          purchaseUnitPrice: offer?.purchaseUnitPrice ?? profileVariant?.purchaseUnitPrice ?? "",
          purchasePackCount: offer?.purchasePackCount ?? profileVariant?.purchasePackCount ?? 0,
          unitsPerPack: offer?.unitsPerPack ?? profileVariant?.unitsPerPack ?? 1,
        };
      }),
    }));
    const firstOffer = offers[0] ?? {};
    const firstSupplier = suppliers[0] ?? {};
    const draft = defaultProductDraft({
      name: product.name,
      englishTitle: product.englishTitle,
      salesPlatform: product.salesPlatform ?? "",
      publicationStatus: normalizeProductPublicationStatus(product.publicationStatus),
      platformSkc: skuRows[0]?.platformSkc ?? product.platformSkc,
      store: product.store,
      imageUrl: product.imageUrl ?? product.image,
      supplierCode: firstSupplier.supplierCode ?? firstOffer.supplierCode ?? product.supplierCode,
      supplierName: firstSupplier.supplierName ?? firstOffer.supplierName ?? product.supplierName,
      sourceProductId: firstSupplier.sourceProductId ?? firstOffer.sourceProductId ?? product.sourceProductId,
      sourceUrl: firstSupplier.sourceUrl ?? firstOffer.sourceUrl ?? product.sourceUrl,
      shippingAmount: firstSupplier.shippingAmount ?? firstOffer.shippingAmount ?? 0,
      handlingFee: firstSupplier.handlingFee ?? firstOffer.handlingFee ?? 0,
      packageWeight: product.packageWeight ?? "",
      ownerId: product.ownerId ?? "",
      visibility: product.visibility ?? "workspace",
      salesStatus: resolveSelectionStatusId(product.salesStatus ?? (product.status === "active" ? "on_sale" : "pending_review"), statusDefinitions),
      tags: Array.isArray(product.tags) ? product.tags : [],
      notes: product.notes ?? "",
      suppliers,
      variants: savedVariants,
    });
    return { mode: "product", product, capture: null, draft, validation: validateProductDraft(draft) };
  }

  const draft = defaultProductDraft({
    name: catalogText(productName),
    platformSkc: catalogText(platformSkc),
    ownerId: memberContext.memberId,
    visibility: memberContext.canSeeAllSelection ? "workspace" : "private",
    variants: catalogText(platformSku) ? [{ platformSku: normalizePlatformSku(platformSku), attribute: "", sourceSku: "", purchaseUnitPrice: "", purchasePackCount: 1, unitsPerPack: 1 }] : [],
  });
  return { mode: "new", product: null, capture: null, draft, validation: validateProductDraft(draft) };
}

export async function listProductCatalogRecords() {
  const [products, platformSkus, supplierOffers, catalogManualCosts, erpCosts, profitLines, context] = await Promise.all([
    db.products.toArray(),
    db.platformSkus.toArray(),
    db.supplierOffers.toArray(),
    db.catalogManualCosts.toArray(),
    db.erpCostRows.toArray(),
    db.profitLines.toArray(),
    getActiveMemberContext(),
  ]);
  const skusByProduct = new Map();
  platformSkus.forEach((sku) => {
    if (!skusByProduct.has(sku.productId)) skusByProduct.set(sku.productId, []);
    skusByProduct.get(sku.productId).push(sku);
  });
  const offersByProduct = new Map();
  supplierOffers.filter(activeSupplierOffer).forEach((offer) => {
    if (!offersByProduct.has(offer.productId)) offersByProduct.set(offer.productId, []);
    offersByProduct.get(offer.productId).push(offer);
  });
  const latestErpCostBySku = new Map();
  const statusDefinitions = await getSelectionStatusDefinitions();
  erpCosts
    .filter((cost) => !cost.workspaceId || cost.workspaceId === context.workspaceId)
    .forEach((cost) => {
      const key = cost.canonicalPlatformSku ?? canonicalPlatformSku(cost.platformSku);
      const amount = Number(cost.unitCost);
      if (!key || !Number.isFinite(amount) || amount <= 0) return;
      const current = latestErpCostBySku.get(key);
      const currentTime = Date.parse(current?.publishedAt ?? current?.calculatedAt ?? current?.updatedAt ?? "") || 0;
      const nextTime = Date.parse(cost.publishedAt ?? cost.calculatedAt ?? cost.updatedAt ?? "") || 0;
      if (!current || nextTime >= currentTime) latestErpCostBySku.set(key, cost);
    });
  const latestManualCostBySku = new Map();
  catalogManualCosts
    .filter((cost) => cost.workspaceId === context.workspaceId && cost.status === "active")
    .forEach((cost) => {
      const key = cost.canonicalPlatformSku ?? canonicalPlatformSku(cost.platformSku);
      const amount = Number(cost.amount ?? cost.unitCost);
      if (!key || !Number.isFinite(amount) || amount <= 0) return;
      const current = latestManualCostBySku.get(key);
      const currentTime = Date.parse(current?.confirmedAt ?? current?.updatedAt ?? "") || 0;
      const nextTime = Date.parse(cost.confirmedAt ?? cost.updatedAt ?? "") || 0;
      if (!current || nextTime >= currentTime) latestManualCostBySku.set(key, cost);
    });
  const latestFinalizedCostBySku = new Map();
  profitLines
    .filter((line) => !line.workspaceId || line.workspaceId === context.workspaceId)
    .forEach((line) => {
      const key = line.canonicalPlatformSku ?? canonicalPlatformSku(line.platformSku ?? line.sku);
      const amount = Number(line.formalUnitCost ?? line.unitCost);
      if (!key || !Number.isFinite(amount) || amount <= 0) return;
      const current = latestFinalizedCostBySku.get(key);
      const currentTime = Date.parse(current?.finalizedAt ?? current?.calculatedAt ?? "") || 0;
      const nextTime = Date.parse(line.finalizedAt ?? line.calculatedAt ?? "") || 0;
      if (!current || nextTime >= currentTime) latestFinalizedCostBySku.set(key, line);
    });

  return products
    .filter((product) => selectionRecordVisible(product, context))
    .map((product) => {
      const skus = skusByProduct.get(product.id) ?? [];
      const offers = offersByProduct.get(product.id) ?? [];
      const supplierProfiles = catalogDisplaySupplierProfiles(product, offers);
      const pendingVariantCount = catalogPendingVariants(product.attributes?.pendingVariants).length;
      const supplierCostBySku = new Map();
      offers.forEach((offer) => {
        const key = offer.canonicalPlatformSku ?? canonicalPlatformSku(offer.platformSku);
        const amount = Number(offer.landedUnitCost ?? offer.referenceUnitCost);
        if (!key || !Number.isFinite(amount) || amount <= 0) return;
        const current = supplierCostBySku.get(key);
        if (current == null || amount < current) supplierCostBySku.set(key, amount);
      });
      const skuReferences = skus.map((sku) => {
        const key = sku.canonicalPlatformSku ?? canonicalPlatformSku(sku.platformSku);
        const erpCost = latestErpCostBySku.get(key);
        const salePrice = Number(sku.salePrice ?? sku.price);
        const supplierOffers = offers.filter((offer) => (offer.canonicalPlatformSku ?? canonicalPlatformSku(offer.platformSku)) === key);
        const manualCost = latestManualCostBySku.get(key);
        const finalizedCost = latestFinalizedCostBySku.get(key);
        const supplierCost = supplierCostBySku.get(key);
        const unitCost = erpCost
          ? Number(erpCost.unitCost)
          : manualCost
            ? Number(manualCost.amount)
            : finalizedCost
              ? Number(finalizedCost.formalUnitCost ?? finalizedCost.unitCost)
              : supplierCost;
        const source = erpCost
          ? "erp"
          : manualCost
            ? "manual_confirmed"
            : finalizedCost
              ? "finalized_profit_history"
              : supplierCost == null ? null : "supplier_landed";
        const referenceProfit = source && Number.isFinite(salePrice) && salePrice >= 0
          ? calculateReferenceProfitLine({
            revenue: salePrice,
            quantity: 1,
            referenceCost: { unitCost, currency: "CNY", referenceKind: source },
            warehouseRate: DEFAULT_WAREHOUSE_RATE,
          })
          : null;
        return {
          id: sku.id,
          platformSku: sku.platformSku,
          canonicalPlatformSku: key,
          warehouseSku: sku.warehouseSku ?? "",
          canonicalWarehouseSku: sku.canonicalWarehouseSku ?? (sku.warehouseSku ? canonicalWarehouseSku(sku.warehouseSku) : ""),
          attribute: sku.attribute ?? "",
          salePrice: Number.isFinite(salePrice) && salePrice >= 0 ? salePrice : null,
          unitCost: source ? unitCost : null,
          source,
          manualCostId: manualCost?.id ?? null,
          supplierCount: new Set(supplierOffers.map((offer) => `${offer.supplierCode ?? ""}\u001f${offer.supplierName ?? ""}\u001f${offer.sourceUrl ?? ""}`)).size,
          referenceUnitProfit: referenceProfit?.profit ?? null,
          referenceProfitRate: referenceProfit?.profitRate ?? null,
        };
      });
      const referenceCosts = skuReferences.map((item) => item.unitCost).filter((amount) => amount != null);
      const erpCoveredSkuCount = skuReferences.filter((item) => item.source === "erp").length;
      const manualCoveredSkuCount = skuReferences.filter((item) => item.source === "manual_confirmed").length;
      const finalizedCoveredSkuCount = skuReferences.filter((item) => item.source === "finalized_profit_history").length;
      const supplierCoveredSkuCount = skuReferences.filter((item) => item.source === "supplier_landed").length;
      const referenceCoveredSkuCount = skuReferences.filter((item) => item.source != null).length;
      const profitHistorySkuCount = skuReferences.filter((item) => latestFinalizedCostBySku.has(item.canonicalPlatformSku)).length;
      const warehouseMappedSkuCount = skuReferences.filter((item) => item.canonicalWarehouseSku).length;
      const dataReadiness = buildProductDataReadiness({
        skuCount: skus.length,
        erpCoveredSkuCount,
        profitHistorySkuCount,
        warehouseMappedSkuCount,
      });
      const lowestReferenceCost = referenceCosts.length > 0 ? Math.min(...referenceCosts) : null;
      const highestReferenceCost = referenceCosts.length > 0 ? Math.max(...referenceCosts) : null;
      return {
        ...product,
        image: product.imageUrl ?? product.image ?? null,
        skuCount: skus.length,
        pendingVariantCount,
        skus,
        offers,
        supplierProfiles,
        supplierCount: supplierProfiles.length,
        supplier: supplierProfiles[0]?.supplierCode || supplierProfiles[0]?.supplierName || product.supplierCode || "未填写",
        salesPlatform: product.salesPlatform ?? "",
        publicationStatus: normalizeProductPublicationStatus(product.publicationStatus),
        salesStatus: resolveSelectionStatusId(product.salesStatus ?? (product.status === "active" ? "on_sale" : "pending_review"), statusDefinitions),
        salePrice: skuReferences.find((item) => item.salePrice != null)?.salePrice ?? null,
        lowestReferenceCost,
        highestReferenceCost,
        referenceCostCoverage: {
          totalSkuCount: skus.length,
          coveredSkuCount: referenceCoveredSkuCount,
          missingSkuCount: Math.max(0, skus.length - referenceCoveredSkuCount),
          erpCoveredSkuCount,
          manualCoveredSkuCount,
          finalizedCoveredSkuCount,
          supplierCoveredSkuCount,
        },
        costSource: erpCoveredSkuCount === skus.length && skus.length > 0
          ? "erp"
          : referenceCoveredSkuCount === 0
            ? null
            : manualCoveredSkuCount === referenceCoveredSkuCount
              ? "manual_confirmed"
              : finalizedCoveredSkuCount === referenceCoveredSkuCount
                ? "finalized_profit_history"
              : supplierCoveredSkuCount === referenceCoveredSkuCount
                ? "supplier_landed"
                : "mixed",
        erpCoveredSkuCount,
        referenceCoveredSkuCount,
        profitHistorySkuCount,
        warehouseMappedSkuCount,
        dataReadiness,
        skuReferences,
        skuReferenceCosts: skuReferences.filter((item) => item.source != null),
        store: product.store || "未分配",
      };
    })
    .toSorted((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

function normalizedProductIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map((id) => catalogText(id)).filter(Boolean))];
}

async function readSkcMergeParticipants({ primaryProductId, sourceProductIds, context }) {
  const primaryId = catalogText(primaryProductId);
  const sourceIds = normalizedProductIds(sourceProductIds).filter((id) => id !== primaryId);
  if (!primaryId || !sourceIds.length) throw new Error("请选择一个主商品档案和至少一个待合并档案。");
  const allIds = [primaryId, ...sourceIds];
  const products = await db.products.bulkGet(allIds);
  if (products.some((product) => !product)) throw new Error("存在已不存在的商品档案，请刷新后重试。");
  if (products.some((product) => !selectionRecordVisible(product, context))) throw new Error("当前账号无权合并其中的商品档案。");
  if (products.some((product) => product.workspaceId !== context.workspaceId)) throw new Error("只能合并当前工作区内的商品档案。");
  const canonicalSkc = canonicalPlatformSkc(products[0].platformSkc);
  if (!canonicalSkc || products.some((product) => canonicalPlatformSkc(product.platformSkc) !== canonicalSkc)) {
    throw new Error("只能合并平台 SKC 完全相同的商品档案。");
  }
  return { primary: products[0], sources: products.slice(1), canonicalSkc };
}

export async function previewProductSkcMerge({ primaryProductId, sourceProductIds } = {}) {
  const context = await getActiveMemberContext();
  const { primary, sources, canonicalSkc } = await readSkcMergeParticipants({ primaryProductId, sourceProductIds, context });
  const sourceIds = new Set(sources.map((product) => product.id));
  const [platformSkus, supplierOffers, manualCosts] = await Promise.all([
    db.platformSkus.toArray(),
    db.supplierOffers.toArray(),
    db.catalogManualCosts.toArray(),
  ]);
  const movedSkus = platformSkus.filter((sku) => sourceIds.has(sku.productId));
  const movedOffers = supplierOffers.filter((offer) => sourceIds.has(offer.productId));
  const movedManualCosts = manualCosts.filter((cost) => sourceIds.has(cost.productId));
  return {
    primaryProductId: primary.id,
    primaryName: primary.name,
    canonicalSkc,
    sourceProducts: sources.map((product) => ({ id: product.id, name: product.name, updatedAt: product.updatedAt })),
    movedSkuCount: movedSkus.length,
    movedSupplierOfferCount: movedOffers.filter(activeSupplierOffer).length,
    retainedSupplierOfferHistoryCount: movedOffers.filter((offer) => !activeSupplierOffer(offer)).length,
    movedManualCostCount: movedManualCosts.length,
    mergedTags: [...new Set(productsTags([primary, ...sources]))],
  };
}

function productsTags(products) {
  return products.flatMap((product) => Array.isArray(product.tags) ? product.tags.map(catalogText).filter(Boolean) : []);
}

export async function mergeProductSkcRecords({ primaryProductId, sourceProductIds, mergedBy = "local-user" } = {}) {
  const context = await getActiveMemberContext();
  const { primary, sources } = await readSkcMergeParticipants({ primaryProductId, sourceProductIds, context });
  const now = new Date().toISOString();
  const sourceIds = new Set(sources.map((product) => product.id));
  let mergedProduct = null;

  await db.transaction("rw", db.products, db.platformSkus, db.supplierOffers, db.catalogManualCosts, db.captures, db.auditEvents, async () => {
    const sourceNotes = sources.map((product) => catalogText(product.notes)).filter(Boolean);
    const mergedNotes = [catalogText(primary.notes), ...sourceNotes.filter((note) => note !== catalogText(primary.notes))].filter(Boolean).join("\n\n");
    const mergedSupplierProfiles = catalogSupplierProfiles([
      ...catalogDisplaySupplierProfiles(primary),
      ...sources.flatMap((product) => catalogDisplaySupplierProfiles(product)),
    ]);
    const mergedPendingVariants = [
      ...catalogPendingVariants(primary.attributes?.pendingVariants),
      ...sources.flatMap((product) => catalogPendingVariants(product.attributes?.pendingVariants)),
    ];
    mergedProduct = {
      ...primary,
      tags: [...new Set(productsTags([primary, ...sources]))],
      notes: mergedNotes,
      attributes: {
        ...(primary.attributes ?? {}),
        supplierProfiles: mergedSupplierProfiles,
        pendingVariants: mergedPendingVariants,
      },
      updatedAt: now,
    };
    await db.products.put(mergedProduct);

    const [sourceSkus, sourceOffers, sourceCosts, captures] = await Promise.all([
      db.platformSkus.toArray(), db.supplierOffers.toArray(), db.catalogManualCosts.toArray(), db.captures.toArray(),
    ]);
    const movedSkus = sourceSkus.filter((sku) => sourceIds.has(sku.productId)).map((sku) => ({
      ...sku,
      productId: primary.id,
      platformSkc: primary.platformSkc,
      canonicalPlatformSkc: primary.canonicalPlatformSkc,
      updatedAt: now,
    }));
    const movedOffers = sourceOffers.filter((offer) => sourceIds.has(offer.productId)).map((offer) => {
      const supplierId = catalogSupplierIdentity(offer, offer.id);
      return {
        ...offer,
        productId: primary.id,
        supplierId,
        offerKey: catalogSupplierOfferKey({
          productId: primary.id,
          supplierId,
          canonicalPlatformSku: offer.canonicalPlatformSku ?? canonicalPlatformSku(offer.platformSku),
        }),
        updatedAt: now,
      };
    });
    const movedCosts = sourceCosts.filter((cost) => sourceIds.has(cost.productId)).map((cost) => ({ ...cost, productId: primary.id, updatedAt: now }));
    const relinkedCaptures = captures.filter((capture) => sourceIds.has(capture.confirmedProductId)).map((capture) => ({
      ...capture,
      confirmedProductId: primary.id,
      updatedAt: now,
    }));

    if (movedSkus.length) await db.platformSkus.bulkPut(movedSkus);
    if (movedOffers.length) await db.supplierOffers.bulkPut(movedOffers);
    if (movedCosts.length) await db.catalogManualCosts.bulkPut(movedCosts);
    if (relinkedCaptures.length) await db.captures.bulkPut(relinkedCaptures);
    await db.products.bulkDelete([...sourceIds]);

    for (const source of sources) {
      await db.auditEvents.add({
        workspaceId: context.workspaceId,
        objectType: "product",
        objectId: source.id,
        action: "product_deleted",
        actorId: mergedBy,
        createdAt: now,
        before: { snapshot: source },
        after: null,
      });
    }
    const [mergedSkus, mergedOffers] = await Promise.all([
      db.platformSkus.where("productId").equals(primary.id).toArray(),
      db.supplierOffers.where("productId").equals(primary.id).toArray(),
    ]);
    await db.auditEvents.add({
      workspaceId: context.workspaceId,
      objectType: "product",
      objectId: primary.id,
      action: "product_merged",
      actorId: mergedBy,
      createdAt: now,
      after: { snapshot: { product: mergedProduct, platformSkus: mergedSkus, supplierOffers: mergedOffers } },
    });
    for (const cost of movedCosts) {
      await db.auditEvents.add({
        workspaceId: context.workspaceId,
        objectType: "catalog_manual_cost",
        objectId: cost.id,
        action: "catalog_manual_cost_relinked",
        actorId: mergedBy,
        createdAt: now,
        after: { snapshot: { catalogManualCost: cost } },
      });
    }
    for (const capture of relinkedCaptures) {
      await db.auditEvents.add({
        workspaceId: context.workspaceId,
        objectType: "capture",
        objectId: capture.id,
        action: "capture_product_relinked",
        actorId: mergedBy,
        createdAt: now,
        after: { snapshot: capture },
      });
    }
  });

  return {
    product: mergedProduct,
    mergedSourceCount: sources.length,
  };
}

export async function bulkUpdateProductCatalogSalesStatus({ productIds, salesStatus, updatedBy = "local-user" }) {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) throw new Error("请先选择至少一条商品记录。");
  const definitions = await getSelectionStatusDefinitions();
  const statusDefinition = selectionStatusById(definitions, salesStatus);
  if (!statusDefinition || statusDefinition.archivedAt || statusDefinition.id !== salesStatus) throw new Error("不支持的选品状态。");

  const context = await getActiveMemberContext();
  const updatedAt = new Date().toISOString();
  const updatedProducts = [];

  await db.transaction("rw", db.products, db.auditEvents, async () => {
    const products = await db.products.bulkGet(ids);
    for (const product of products) {
      if (!product) throw new Error("部分商品记录不存在，页面已刷新。");
      if (!selectionRecordVisible(product, context)) throw new Error("当前账号无权修改选中的商品。");
    }

    for (const product of products) {
      const savedProduct = { ...product, salesStatus: statusDefinition.id, updatedAt };
      await db.products.put(savedProduct);
      updatedProducts.push(savedProduct);
      await db.auditEvents.add({
        workspaceId: product.workspaceId,
        objectType: "product",
        objectId: product.id,
        action: "product_sales_status_bulk_updated",
        actorId: updatedBy,
        createdAt: updatedAt,
        before: { salesStatus: resolveSelectionStatusId(product.salesStatus ?? (product.status === "active" ? "on_sale" : "pending_review"), definitions) },
        after: { salesStatus: statusDefinition.id, batchSize: ids.length, snapshot: savedProduct },
      });
    }
  });

  return updatedProducts;
}

export async function saveProductCatalogRecord({
  productId = null,
  captureId = null,
  draft,
  status = "active",
  savedBy = "local-user",
  workspaceId = DEFAULT_WORKSPACE_ID,
}) {
  await ensureDefaultWorkspace();
  const memberContext = await getActiveMemberContext();
  const statusDefinitions = await getSelectionStatusDefinitions();
  const normalizedDraft = defaultProductDraft(draft);
  const validation = validateProductDraft(normalizedDraft);
  if (!catalogText(normalizedDraft.name)) throw new Error("商品名称不能为空。");
  if (status === "active" && !validation.valid) {
    throw new Error(productValidationMessage(validation.blockingIssues[0]));
  }

  const normalizedVariants = normalizedDraft.variants
    .filter((variant) => catalogText(variant.platformSku))
    .map((variant) => ({
      ...variant,
      platformSku: normalizePlatformSku(variant.platformSku),
      canonicalPlatformSku: canonicalPlatformSku(variant.platformSku),
      warehouseSku: catalogText(variant.warehouseSku) ? normalizeWarehouseSku(variant.warehouseSku) : "",
      canonicalWarehouseSku: catalogText(variant.warehouseSku) ? canonicalWarehouseSku(variant.warehouseSku) : "",
    }));
  assertUniquePlatformSkus(normalizedVariants.map((variant) => ({ workspaceId, platformSku: variant.platformSku })));

  const normalizedSkc = catalogText(normalizedDraft.platformSkc)
    ? normalizePlatformSkc(normalizedDraft.platformSkc)
    : "";
  const canonicalSkc = normalizedSkc ? canonicalPlatformSkc(normalizedSkc) : "";
  const legacySupplier = {
    supplierCode: normalizedDraft.supplierCode,
    supplierName: normalizedDraft.supplierName,
    sourceProductId: normalizedDraft.sourceProductId,
    sourceUrl: normalizedDraft.sourceUrl,
    shippingAmount: normalizedDraft.shippingAmount,
    handlingFee: normalizedDraft.handlingFee,
    variants: normalizedDraft.variants,
  };
  const normalizedSuppliers = (Array.isArray(normalizedDraft.suppliers) && normalizedDraft.suppliers.length > 0
    ? normalizedDraft.suppliers
    : [legacySupplier])
    .map((supplier) => ({
      ...supplier,
      supplierId: catalogSupplierIdentity(supplier),
      supplierCode: catalogText(supplier.supplierCode),
      supplierName: catalogText(supplier.supplierName),
      sourceProductId: catalogText(supplier.sourceProductId),
      sourceUrl: catalogText(supplier.sourceUrl),
      shippingAmount: Number(supplier.shippingAmount) || 0,
      handlingFee: Number(supplier.handlingFee) || 0,
      variants: Array.isArray(supplier.variants) ? supplier.variants : [],
    }))
    .filter(catalogSupplierHasData);
  const supplierProfiles = catalogSupplierProfiles(normalizedSuppliers);
  const pendingVariants = catalogPendingVariants(normalizedDraft.variants);
  const primarySupplier = supplierProfiles[0] ?? {};
  const now = new Date().toISOString();
  const resolvedProductId = productId || makeId("PROD");
  let savedProduct = null;

  await db.transaction(
    "rw",
    db.products,
    db.platformSkus,
    db.supplierOffers,
    db.captures,
    db.auditEvents,
    async () => {
      const existingProduct = await db.products.get(resolvedProductId);
      if (productId && !existingProduct) throw new Error("找不到对应的商品档案。");
      const capture = captureId ? await db.captures.get(captureId) : null;
      if (captureId && !capture) throw new Error("找不到对应的采集记录。");
      if (existingProduct && !selectionRecordVisible(existingProduct, memberContext)) throw new Error("当前账号无权访问该商品。");
      if (capture && !selectionRecordVisible(capture, memberContext)) throw new Error("当前账号无权访问该采集记录。");
      if (capture && ["confirmed", "ignored"].includes(capture.status)) throw new Error("该采集记录已经结束处理。");

      for (const variant of normalizedVariants) {
        const duplicate = await db.platformSkus
          .where("[workspaceId+canonicalPlatformSku]")
          .equals([workspaceId, variant.canonicalPlatformSku])
          .first();
        if (duplicate && duplicate.productId !== resolvedProductId) {
          throw new Error(`平台 SKU ${variant.platformSku} 已属于其他商品，工作区内不能重复。`);
        }
      }

      const existingSkus = await db.platformSkus.where("productId").equals(resolvedProductId).toArray();
      const existingOffers = await db.supplierOffers.where("productId").equals(resolvedProductId).toArray();
      const skuByCanonical = new Map(existingSkus.map((sku) => [sku.canonicalPlatformSku, sku]));
      const skuRows = normalizedVariants.map((variant) => ({
        id: skuByCanonical.get(variant.canonicalPlatformSku)?.id ?? makeId("SKU"),
        workspaceId,
        productId: resolvedProductId,
        platformSku: variant.platformSku,
        canonicalPlatformSku: variant.canonicalPlatformSku,
        warehouseSku: variant.warehouseSku,
        canonicalWarehouseSku: variant.canonicalWarehouseSku,
        platformSkc: normalizedSkc,
        canonicalPlatformSkc: canonicalSkc,
        sourceSku: catalogText(variant.sourceSku),
        attribute: catalogText(variant.attribute),
        color: catalogText(variant.color),
        swatch: catalogText(variant.swatch) || "#9ca3af",
        imageUrl: catalogText(variant.imageUrl),
        status: status === "active" ? "active" : "draft",
        salePrice: Number(variant.salePrice) || null,
        createdAt: skuByCanonical.get(variant.canonicalPlatformSku)?.createdAt ?? now,
        updatedAt: now,
      }));
      const savedSkuByCanonical = new Map(skuRows.map((sku) => [sku.canonicalPlatformSku, sku]));
      const activeOfferByKey = new Map(existingOffers
        .filter(activeSupplierOffer)
        .map((offer) => [offer.offerKey ?? catalogSupplierOfferKey({
          productId: resolvedProductId,
          supplierId: catalogSupplierIdentity(offer, offer.id),
          canonicalPlatformSku: offer.canonicalPlatformSku ?? canonicalPlatformSku(offer.platformSku),
        }), offer]));
      const activeOfferKeys = new Set();
      const replacementRows = [];
      const nextActiveOffers = normalizedSuppliers.flatMap((supplier, supplierIndex) => {
        const supplierVariants = normalizedVariants.map((variant) => {
          const supplierVariant = supplier.variants.find((item) => {
            const platformSku = catalogText(item.platformSku);
            return platformSku && canonicalPlatformSku(platformSku) === variant.canonicalPlatformSku;
          }) ?? {};
          return {
            ...variant,
            sourceSku: supplierVariant.sourceSku ?? variant.sourceSku,
            purchaseUnitPrice: supplierVariant.purchaseUnitPrice ?? (supplierIndex === 0 ? variant.purchaseUnitPrice : ""),
            purchasePackCount: supplierVariant.purchasePackCount ?? (supplierIndex === 0 ? variant.purchasePackCount : 0),
            unitsPerPack: supplierVariant.unitsPerPack ?? (supplierIndex === 0 ? variant.unitsPerPack : 1),
          };
        });
        const totalPurchasePacks = supplierVariants.reduce((sum, variant) => sum + Number(variant.purchasePackCount ?? 0), 0);
        return supplierVariants.map((variant) => {
          const landedUnitCost = calculateSupplierLandedUnitCost({
            purchaseUnitPrice: variant.purchaseUnitPrice,
            shippingAmount: supplier.shippingAmount,
            totalPurchasePacks,
            handlingFee: supplier.handlingFee,
            unitsPerPack: variant.unitsPerPack,
          });
          const platformSkuId = savedSkuByCanonical.get(variant.canonicalPlatformSku)?.id ?? null;
          const offerKey = catalogSupplierOfferKey({
            productId: resolvedProductId,
            supplierId: supplier.supplierId,
            canonicalPlatformSku: variant.canonicalPlatformSku,
          });
          activeOfferKeys.add(offerKey);
          const current = activeOfferByKey.get(offerKey);
          const candidate = {
            id: current?.id ?? makeId("OFFER"),
            workspaceId,
            productId: resolvedProductId,
            platformSkuId,
            platformSku: variant.platformSku,
            canonicalPlatformSku: variant.canonicalPlatformSku,
            supplierId: supplier.supplierId,
            offerKey,
            source: "1688",
            sourceProductId: supplier.sourceProductId,
            sourceUrl: supplier.sourceUrl,
            supplierCode: supplier.supplierCode,
            supplierName: supplier.supplierName,
            sourceSku: catalogText(variant.sourceSku),
            purchaseUnitPrice: Number(variant.purchaseUnitPrice) || null,
            shippingAmount: supplier.shippingAmount,
            handlingFee: supplier.handlingFee,
            purchasePackCount: Number(variant.purchasePackCount) || 0,
            totalPurchasePacks,
            unitsPerPack: Number(variant.unitsPerPack) || 1,
            landedUnitCost,
            referenceUnitCost: landedUnitCost,
            currency: "CNY",
            calculatedAt: now,
            status: "active",
            supersededAt: null,
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
          };
          if (current && supplierOfferContent(current) !== supplierOfferContent(candidate)) {
            replacementRows.push({ ...current, status: "superseded", supersededAt: now, updatedAt: now });
            return { ...candidate, id: makeId("OFFER"), createdAt: now };
          }
          return current ? { ...current, ...candidate, calculatedAt: current.calculatedAt ?? now, updatedAt: current.updatedAt ?? now } : candidate;
        });
      });
      const retiredRows = existingOffers
        .filter((offer) => activeSupplierOffer(offer))
        .filter((offer) => !activeOfferKeys.has(offer.offerKey ?? catalogSupplierOfferKey({
          productId: resolvedProductId,
          supplierId: catalogSupplierIdentity(offer, offer.id),
          canonicalPlatformSku: offer.canonicalPlatformSku ?? canonicalPlatformSku(offer.platformSku),
        })))
        .map((offer) => ({ ...offer, status: "superseded", supersededAt: now, updatedAt: now }));
      const unchangedHistory = existingOffers.filter((offer) => !activeSupplierOffer(offer));
      const offerRows = [...unchangedHistory, ...replacementRows, ...retiredRows, ...nextActiveOffers];
      const referenceCosts = nextActiveOffers.map((offer) => offer.landedUnitCost).filter((cost) => Number.isFinite(cost) && cost > 0);
      savedProduct = {
        id: resolvedProductId,
        workspaceId,
        name: catalogText(normalizedDraft.name),
        englishTitle: catalogText(normalizedDraft.englishTitle),
        salesPlatform: catalogText(normalizedDraft.salesPlatform),
        publicationStatus: normalizeProductPublicationStatus(normalizedDraft.publicationStatus),
        platformSkc: normalizedSkc,
        canonicalPlatformSkc: canonicalSkc,
        store: catalogText(normalizedDraft.store),
        imageUrl: catalogText(normalizedDraft.imageUrl),
        packageWeight: Number(normalizedDraft.packageWeight) || null,
        supplierCode: primarySupplier.supplierCode ?? catalogText(normalizedDraft.supplierCode),
        supplierName: primarySupplier.supplierName ?? catalogText(normalizedDraft.supplierName),
        sourceProductId: primarySupplier.sourceProductId ?? catalogText(normalizedDraft.sourceProductId),
        sourceUrl: primarySupplier.sourceUrl ?? catalogText(normalizedDraft.sourceUrl),
        ownerId: existingProduct?.ownerId ?? capture?.ownerId ?? (catalogText(normalizedDraft.ownerId) || memberContext.memberId),
        visibility: catalogText(normalizedDraft.visibility) || existingProduct?.visibility || (memberContext.canSeeAllSelection ? "workspace" : "private"),
        salesStatus: resolveSelectionStatusId(catalogText(normalizedDraft.salesStatus) || (status === "active" ? "on_sale" : "pending_review"), statusDefinitions),
        tags: Array.isArray(normalizedDraft.tags) ? normalizedDraft.tags.map(catalogText).filter(Boolean) : [],
        notes: catalogText(normalizedDraft.notes),
        sourceCaptureId: captureId,
        status,
        skuCount: skuRows.length,
        referenceCost: referenceCosts.length > 0 ? Math.min(...referenceCosts) : null,
        currency: "CNY",
        attributes: {
          ...(existingProduct?.attributes ?? {}),
          supplierProfiles,
          pendingVariants,
        },
        createdAt: existingProduct?.createdAt ?? now,
        updatedAt: now,
      };

      await db.products.put(savedProduct);
      await db.platformSkus.where("productId").equals(resolvedProductId).delete();
      if (skuRows.length > 0) await db.platformSkus.bulkAdd(skuRows);
      if (offerRows.length > 0) await db.supplierOffers.bulkPut(offerRows);

      let savedCapture = capture;
      if (capture) {
        savedCapture = {
          ...capture,
          draft: normalizedDraft,
          validation,
          status: status === "active" ? "confirmed" : capture.status,
          confirmedProductId: status === "active" ? resolvedProductId : null,
          confirmedAt: status === "active" ? now : null,
          confirmedBy: status === "active" ? savedBy : null,
          updatedAt: now,
        };
        await db.captures.put(savedCapture);
      }

      await db.auditEvents.add({
        workspaceId,
        objectType: "product",
        objectId: resolvedProductId,
        action: existingProduct ? "product_updated" : "product_created",
      actorId: savedBy,
      createdAt: now,
      after: {
        status,
        platformSkc: normalizedSkc,
        platformSkuCount: skuRows.length,
        captureId,
        snapshot: {
          product: savedProduct,
          platformSkus: skuRows,
          supplierOffers: offerRows,
        },
      },
      });
      if (capture && status === "active") {
        await db.auditEvents.add({
          workspaceId,
          objectType: "capture",
          objectId: captureId,
          action: "capture_confirmed",
          actorId: savedBy,
          createdAt: now,
          after: {
            productId: resolvedProductId,
            platformSkuCount: skuRows.length,
            snapshot: savedCapture,
          },
        });
      }
    },
  );

  return { product: savedProduct, validation };
}

export async function saveCatalogManualCost({
  productId,
  platformSku,
  amount,
  note = "",
  confirmedBy = "local-user",
} = {}) {
  await ensureDefaultWorkspace();
  const context = await getActiveMemberContext();
  const normalizedSku = normalizePlatformSku(platformSku);
  const canonicalSku = canonicalPlatformSku(normalizedSku);
  const confirmedAmount = Number(amount);
  if (!productId) throw new Error("请选择需要确认成本的商品 SKU。");
  if (!canonicalSku) throw new Error("平台 SKU 不能为空。");
  if (!Number.isFinite(confirmedAmount) || confirmedAmount <= 0) throw new Error("人工确认成本必须大于 0。");

  const [product, sku] = await Promise.all([
    db.products.get(productId),
    db.platformSkus.where("[workspaceId+canonicalPlatformSku]").equals([context.workspaceId, canonicalSku]).first(),
  ]);
  if (!product || !selectionRecordVisible(product, context)) throw new Error("找不到可编辑的商品档案。");
  if (!sku || sku.productId !== productId) throw new Error("该平台 SKU 不属于当前商品档案。");

  const now = new Date().toISOString();
  const saved = {
    id: makeId("CATCOST"),
    workspaceId: context.workspaceId,
    productId,
    platformSkuId: sku.id,
    platformSku: normalizedSku,
    canonicalPlatformSku: canonicalSku,
    amount: confirmedAmount,
    currency: "CNY",
    kind: "manual_confirmed",
    status: "active",
    note: catalogText(note),
    confirmedBy,
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction("rw", db.catalogManualCosts, db.auditEvents, async () => {
    const existing = (await db.catalogManualCosts.toArray())
      .filter((item) => item.workspaceId === context.workspaceId && item.productId === productId && item.canonicalPlatformSku === canonicalSku && item.status === "active");
    for (const current of existing) {
      await db.catalogManualCosts.put({ ...current, status: "superseded", supersededAt: now, updatedAt: now });
    }
    await db.catalogManualCosts.add(saved);
    await db.auditEvents.add({
      workspaceId: context.workspaceId,
      objectType: "catalog_manual_cost",
      objectId: saved.id,
      action: "catalog_manual_cost_confirmed",
      actorId: confirmedBy,
      createdAt: now,
      before: existing.map((item) => ({ id: item.id, amount: item.amount, status: item.status })),
      after: { snapshot: { catalogManualCost: saved } },
    });
  });

  return saved;
}

export async function getSelectionReferenceSnapshot() {
  const [platformSkus, products, supplierOffers, catalogManualCosts, erpCosts, profitLines, context] = await Promise.all([
    db.platformSkus.toArray(),
    db.products.toArray(),
    db.supplierOffers.toArray(),
    db.catalogManualCosts.toArray(),
    db.erpCostRows.toArray(),
    db.profitLines.toArray(),
    getActiveMemberContext(),
  ]);
  const visibleProducts = products.filter((product) => selectionRecordVisible(product, context));
  const visibleProductIds = new Set(visibleProducts.map((product) => product.id));
  const workspaceMatch = (record) => !record.workspaceId || record.workspaceId === context.workspaceId;
  return {
    platformSkus: platformSkus.filter((sku) => workspaceMatch(sku) && (!sku.productId || visibleProductIds.has(sku.productId))),
    products: visibleProducts,
    supplierOffers: supplierOffers.filter((offer) => activeSupplierOffer(offer) && workspaceMatch(offer) && (!offer.productId || visibleProductIds.has(offer.productId))),
    catalogManualCosts: catalogManualCosts.filter((item) => workspaceMatch(item) && (!item.productId || visibleProductIds.has(item.productId))),
    erpCosts: erpCosts.filter(workspaceMatch),
    profitLines: profitLines.filter(workspaceMatch),
  };
}

