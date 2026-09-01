import { assertDomain, DomainRuleError } from "./errors.js";

function normalizeRequiredIdentifier(value, label) {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  assertDomain(normalized.length > 0, "identifier_required", `${label}不能为空`, { label });
  return normalized;
}

export function normalizeWorkspaceId(value) {
  return normalizeRequiredIdentifier(value, "工作区 ID");
}

export function normalizePlatformSku(value) {
  return normalizeRequiredIdentifier(value, "平台 SKU");
}

export function canonicalPlatformSku(value) {
  return normalizePlatformSku(value).toUpperCase();
}

export function normalizePlatformSkc(value) {
  return normalizeRequiredIdentifier(value, "平台 SKC");
}

export function canonicalPlatformSkc(value) {
  return normalizePlatformSkc(value).toUpperCase();
}

export function normalizeWarehouseSku(value) {
  return normalizeRequiredIdentifier(value, "仓库 SKU");
}

export function canonicalWarehouseSku(value) {
  return normalizeWarehouseSku(value).toUpperCase();
}

export function platformSkuIdentity(workspaceId, platformSku) {
  return `${normalizeWorkspaceId(workspaceId)}::${canonicalPlatformSku(platformSku)}`;
}

export function findPlatformSkuDuplicates(records) {
  const occurrences = new Map();

  records.forEach((record, index) => {
    const workspaceId = normalizeWorkspaceId(record.workspaceId);
    const platformSku = normalizePlatformSku(record.platformSku);
    const canonicalSku = canonicalPlatformSku(platformSku);
    const key = platformSkuIdentity(workspaceId, canonicalSku);
    const current = occurrences.get(key) ?? {
      key,
      workspaceId,
      canonicalPlatformSku: canonicalSku,
      occurrences: [],
    };
    current.occurrences.push({
      index,
      id: record.id ?? null,
      platformSku,
    });
    occurrences.set(key, current);
  });

  return [...occurrences.values()].filter((item) => item.occurrences.length > 1);
}

export function assertUniquePlatformSkus(records) {
  const duplicates = findPlatformSkuDuplicates(records);
  if (duplicates.length > 0) {
    throw new DomainRuleError(
      "duplicate_platform_sku",
      "同一工作区内的平台 SKU 必须全局唯一",
      { duplicates },
    );
  }
  return true;
}
