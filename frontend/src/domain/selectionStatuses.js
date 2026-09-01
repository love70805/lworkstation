const DEFAULT_STATUS_ROWS = [
  { id: "testing", label: "测品", tone: "info", sortOrder: 10, requiresReadiness: false },
  { id: "pending_review", label: "待审核", tone: "warning", sortOrder: 20, requiresReadiness: false },
  { id: "sourcing", label: "采购中", tone: "info", sortOrder: 30, requiresReadiness: false },
  { id: "observing", label: "观察中", tone: "info", sortOrder: 40, requiresReadiness: false },
  { id: "on_sale", label: "在售", tone: "success", sortOrder: 50, requiresReadiness: true },
  { id: "out_of_stock", label: "缺货", tone: "warning", sortOrder: 60, requiresReadiness: false },
  { id: "off_sale", label: "下架", tone: "neutral", sortOrder: 70, requiresReadiness: false },
  { id: "retired", label: "淘汰", tone: "danger", sortOrder: 80, requiresReadiness: false },
];

const ALLOWED_TONES = new Set(["neutral", "info", "success", "warning", "danger"]);
const LEGACY_STATUS_ALIASES = new Map([
  ["observing", "observing"],
  ["pending_review", "pending_review"],
  ["on_sale", "on_sale"],
  ["off_sale", "off_sale"],
  ["retired", "retired"],
]);

function text(value) {
  return String(value ?? "").trim();
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function defaultSelectionStatusDefinitions() {
  return DEFAULT_STATUS_ROWS.map((status) => ({ ...status, isSystem: true, archivedAt: null }));
}

export function normalizeSelectionStatusDefinitions(value) {
  const source = Array.isArray(value) && value.length ? value : defaultSelectionStatusDefinitions();
  const seen = new Set();
  const normalized = source
    .map((status, index) => {
      const id = slug(status?.id) || `custom-status-${index + 1}`;
      if (seen.has(id)) return null;
      seen.add(id);
      const defaultStatus = DEFAULT_STATUS_ROWS.find((item) => item.id === id);
      const label = text(status?.label) || defaultStatus?.label || "未命名状态";
      return {
        id,
        label,
        tone: ALLOWED_TONES.has(status?.tone) ? status.tone : (defaultStatus?.tone ?? "neutral"),
        sortOrder: Number.isFinite(Number(status?.sortOrder)) ? Number(status.sortOrder) : ((index + 1) * 10),
        requiresReadiness: Boolean(status?.requiresReadiness ?? defaultStatus?.requiresReadiness),
        isSystem: Boolean(defaultStatus?.id === id || status?.isSystem),
        archivedAt: status?.archivedAt ?? null,
      };
    })
    .filter(Boolean);

  return normalized.toSorted((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, "zh-CN"));
}

export function resolveSelectionStatusId(value, definitions = defaultSelectionStatusDefinitions()) {
  const requested = text(value);
  const activeDefinitions = normalizeSelectionStatusDefinitions(definitions);
  if (activeDefinitions.some((status) => status.id === requested)) return requested;
  const legacy = LEGACY_STATUS_ALIASES.get(requested);
  if (legacy && activeDefinitions.some((status) => status.id === legacy)) return legacy;
  return activeDefinitions.find((status) => !status.archivedAt)?.id ?? "pending_review";
}

export function activeSelectionStatusDefinitions(definitions) {
  return normalizeSelectionStatusDefinitions(definitions).filter((status) => !status.archivedAt);
}

export function selectionStatusById(definitions, statusId) {
  const normalized = normalizeSelectionStatusDefinitions(definitions);
  const id = resolveSelectionStatusId(statusId, normalized);
  return normalized.find((status) => status.id === id) ?? normalized[0] ?? null;
}

export function createCustomSelectionStatus({ label, tone = "neutral", sortOrder = 999 } = {}) {
  const normalizedLabel = text(label);
  if (!normalizedLabel) throw new Error("状态名称不能为空。");
  const baseId = slug(normalizedLabel) || "custom-status";
  return {
    id: `custom-${baseId}-${Math.random().toString(36).slice(2, 7)}`,
    label: normalizedLabel,
    tone: ALLOWED_TONES.has(tone) ? tone : "neutral",
    sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 999,
    requiresReadiness: false,
    isSystem: false,
    archivedAt: null,
  };
}
