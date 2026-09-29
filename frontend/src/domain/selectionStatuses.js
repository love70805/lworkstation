const DEFAULT_STATUS_ROWS = [
  { id: "testing", label: "测品", tone: "info", sortOrder: 10 },
  { id: "unpublished", label: "待上架", tone: "neutral", sortOrder: 15 },
  { id: "pending_review", label: "待审核", tone: "warning", sortOrder: 20 },
  { id: "approved_pending_listing", label: "审核通过待上架", tone: "info", sortOrder: 25 },
  { id: "sourcing", label: "采购中", tone: "info", sortOrder: 30 },
  { id: "observing", label: "观察中", tone: "info", sortOrder: 40 },
  { id: "on_sale", label: "已上架", tone: "success", sortOrder: 50 },
  { id: "out_of_stock", label: "缺货", tone: "warning", sortOrder: 60 },
  { id: "off_sale", label: "已下架", tone: "neutral", sortOrder: 70 },
  { id: "retired", label: "淘汰", tone: "danger", sortOrder: 80 },
];
const ALLOWED_TONES = new Set(["neutral", "info", "success", "warning", "danger"]);
const LEGACY_STATUS_ALIASES = new Map([["listed", "on_sale"], ["off_shelf", "off_sale"], ["published_pending_review", "pending_review"]]);
const TECHNICAL_STATUSES = new Set(["active", "draft", "inactive", "unlinked"]);
const text = value => String(value ?? "").trim();
const slug = value => text(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
export const canonicalProductStatusId = value => LEGACY_STATUS_ALIASES.get(text(value)) ?? text(value);

export function defaultSelectionStatusDefinitions() {
  return DEFAULT_STATUS_ROWS.map(status => ({ ...status, requiresReadiness: false, isSystem: true, archivedAt: null }));
}

export function normalizeSelectionStatusDefinitions(value) {
  const source = Array.isArray(value) && value.length ? value : defaultSelectionStatusDefinitions();
  const seen = new Set();
  const normalized = source.map((status, index) => {
    const id = canonicalProductStatusId(text(status?.id) || `custom-status-${index + 1}`);
    if (seen.has(id)) return null;
    seen.add(id);
    const system = DEFAULT_STATUS_ROWS.find(item => item.id === id);
    const suppliedLabel = text(status?.label);
    const oldDefaultLabel = (id === "on_sale" && suppliedLabel === "在售") || (id === "off_sale" && suppliedLabel === "下架")
      || ["未发布", "已发布待审核"].includes(suppliedLabel);
    return {
      id, label: oldDefaultLabel ? system?.label ?? suppliedLabel : suppliedLabel || system?.label || "未命名状态",
      tone: ALLOWED_TONES.has(status?.tone) ? status.tone : system?.tone ?? "neutral",
      sortOrder: Number.isFinite(Number(status?.sortOrder)) ? Number(status.sortOrder) : (index + 1) * 10,
      // Listed products only require their identity, regardless of old completeness settings.
      requiresReadiness: id === "on_sale" ? false : Boolean(status?.requiresReadiness),
      isSystem: Boolean(system || status?.isSystem), archivedAt: status?.archivedAt ?? null,
    };
  }).filter(Boolean);
  defaultSelectionStatusDefinitions().forEach(status => { if (!seen.has(status.id)) normalized.push(status); });
  return normalized.toSorted((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "zh-CN"));
}

export function resolveSelectionStatusId(value, definitions = defaultSelectionStatusDefinitions()) {
  const requested = canonicalProductStatusId(value);
  if (requested && !TECHNICAL_STATUSES.has(requested)) return requested;
  const statuses = normalizeSelectionStatusDefinitions(definitions);
  return statuses.find(status => status.id === "pending_review")?.id ?? statuses.find(status => !status.archivedAt)?.id ?? "pending_review";
}

/** Resolve the user-facing status without rewriting either historical field. */
export function resolveProductStatus(product = {}, definitions = defaultSelectionStatusDefinitions()) {
  const explicit = [product.productStatus, product.userStatus].map(text).find(value => value && !TECHNICAL_STATUSES.has(value));
  const legacyStatuses = { salesStatus: text(product.salesStatus), publicationStatus: text(product.publicationStatus) };
  if (explicit && !TECHNICAL_STATUSES.has(explicit)) return { statusId: resolveSelectionStatusId(explicit, definitions), legacyConflict: false, legacyStatuses };
  const sales = legacyStatuses.salesStatus ? canonicalProductStatusId(legacyStatuses.salesStatus) : "";
  const publication = legacyStatuses.publicationStatus ? canonicalProductStatusId(legacyStatuses.publicationStatus) : "";
  const systemIds = new Set(DEFAULT_STATUS_ROWS.map(status => status.id));
  const custom = sales && !systemIds.has(sales) && !TECHNICAL_STATUSES.has(sales);
  const compatible = publication === sales || (!publication) || (publication === "unpublished" && !["on_sale", "out_of_stock", "off_sale"].includes(sales))
    || (publication === "on_sale" && sales === "out_of_stock") || (publication === "off_sale" && sales === "retired");
  return { statusId: resolveSelectionStatusId(sales || publication || "pending_review", definitions), legacyConflict: Boolean(sales && publication && !compatible && !custom), legacyStatuses };
}

export function activeSelectionStatusDefinitions(definitions) {
  return normalizeSelectionStatusDefinitions(definitions).filter(status => !status.archivedAt);
}

export function selectionStatusById(definitions, statusId) {
  const id = resolveSelectionStatusId(statusId, definitions);
  return normalizeSelectionStatusDefinitions(definitions).find(status => status.id === id)
    ?? { id, label: id, tone: "neutral", requiresReadiness: false, isSystem: false, archivedAt: null };
}

export function createCustomSelectionStatus({ label, tone = "neutral", sortOrder = 999 } = {}) {
  const normalizedLabel = text(label);
  if (!normalizedLabel) throw new Error("状态名称不能为空。");
  return { id: `custom-${slug(normalizedLabel) || "custom-status"}-${Math.random().toString(36).slice(2, 7)}`, label: normalizedLabel,
    tone: ALLOWED_TONES.has(tone) ? tone : "neutral", sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 999,
    requiresReadiness: false, isSystem: false, archivedAt: null };
}
