function normalized(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function canonical(value) {
  return normalized(value).toUpperCase();
}

/** ERP v8.0 查询只能使用台账中的平台 SKC，不能使用平台 SKU 或供方货号替代。 */
export function collectErpPlatformSkcs(rows = []) {
  const unique = new Map();
  const missingRows = [];

  rows.forEach((row, index) => {
    const platformSkc = normalized(row.platformSkc);
    if (!platformSkc) {
      missingRows.push({
        index,
        sourceRow: row.sourceRow ?? index + 2,
        platformSku: normalized(row.platformSku ?? row.sku),
        supplierNumber: normalized(row.supplierNumber),
      });
      return;
    }
    const key = canonical(platformSkc);
    if (!unique.has(key)) unique.set(key, platformSkc);
  });

  return { platformSkcs: [...unique.values()], missingRows, missingCount: missingRows.length };
}
