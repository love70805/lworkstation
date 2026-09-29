import { canonicalPlatformSku } from "./identifiers";

const text = value => String(value ?? "").normalize("NFKC").trim();

/** Strip only observed, bounded ERP decorations; numbers/models in a title stay intact. */
export function erpProductTitle(value) {
  let name = text(value);
  name = name.replace(/(?:\s*-\s*(?:[A-Za-z]{2,10}\s+)?)?sh\d+[A-Za-z]*\s*$/i, "").trim();
  const quantity = /^\d+\s*(?:pcs?(?![A-Za-z])|个(?!装|套|组合)|件(?!装|套|组合))\s*/i.exec(name);
  if (quantity) {
    name = name.slice(quantity[0].length);
    name = name.replace(/^(?:蓝色|黑色|红色|白色|绿色|黄色|紫色|粉色|灰色|棕色)\s*/, "");
  }
  return name.trim();
}

export function suggestErpProductTitles(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    for (const candidate of row.erpCatalogFields?.productName?.candidates ?? []) {
      const rawName = text(candidate.value);
      const name = erpProductTitle(rawName);
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, { name, rawNames: [], platformSkus: [] });
      const group = groups.get(name);
      if (!group.rawNames.includes(rawName)) group.rawNames.push(rawName);
      if (row.platformSku && !group.platformSkus.some(sku => canonicalPlatformSku(sku) === row.canonicalPlatformSku)) group.platformSkus.push(row.platformSku);
    }
  }
  const candidates = [...groups.values()].sort((a, b) => b.platformSkus.length - a.platformSkus.length || a.name.localeCompare(b.name, "zh-CN"));
  return { name: candidates.length === 1 ? candidates[0].name : "", suggestedName: candidates[0]?.name ?? "", candidates, needsChoice: candidates.length > 1 };
}
