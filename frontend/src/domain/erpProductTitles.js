import { canonicalPlatformSku } from "./identifiers";

const text = value => String(value ?? "").normalize("NFKC").trim();

/** Strip only observed, bounded ERP decorations; numbers/models in a title stay intact. */
export function erpProductTitle(value) {
  let name = text(value);
  name = name.replace(/(?:\s*-\s*[A-Za-z]{2,10}\s*)?sh\d+[A-Za-z]*\s*$/i, "").trim();
  const quantity = /^\d+\s*(?:pcs?(?![A-Za-z])|个(?!装|套|组合)|件(?!装|套|组合))\s*/i.exec(name);
  if (quantity) {
    name = name.slice(quantity[0].length);
    name = name.replace(/^(?:(?:深|浅|亮|暗)?(?:玫红|黑|白|红|蓝|绿|黄|紫|粉|灰|棕|橙|米|银|金){1,3}色)\s*/, "");
  }
  return name.trim();
}

// Specifications are used only to remove an observed variant prefix/suffix
// from this SKU's title. They never supply identity, prices or platform attributes.
function titleFromSellingSpecs(rawName, row) {
  const title = erpProductTitle(rawName);
  if (/^型号(?:\s|[:：])/.test(title)) return title;
  const specs = (row.erpCatalogPurchases ?? []).filter(purchase =>
    text(purchase.platformSku) && text(row.platformSku) && canonicalPlatformSku(purchase.platformSku) === canonicalPlatformSku(row.platformSku)
    && (!purchase.platformSkc || !row.platformSkc || text(purchase.platformSkc).toUpperCase() === text(row.platformSkc).toUpperCase()));
  const suggestions = new Set();
  for (const purchase of specs) {
    const catalog = purchase.purchaseCatalog;
    const raw = text(catalog?.purchaseSpecificationAndModel1688 || catalog?.model1688);
    if (!raw) continue;
    const tokens = raw.split(/[;；\n|]/).map(part => part.replace(/^\s*(?:颜色|色号|规格|型号|尺寸|款式)\s*[:：]\s*/, '').trim()).filter(Boolean);
    let name = title;
    for (const token of tokens.toSorted((a, b) => b.length - a.length)) {
      // A short color/size or explicit pack label is a removable variant. An
      // arbitrary supplier description must not erase product/model semantics.
      if (!/^(?:(?:深|浅|亮|暗)?(?:玫红|黑|白|红|蓝|绿|黄|紫|粉|灰|棕|橙|米|银|金){1,3}色|[大小中]号|[SMLX]{1,4}|\d+\s*(?:pcs?|个|件|只)(?:装)?)$/i.test(token)) continue;
      if (name.startsWith(token) && /^[\s\-·:：/]/.test(name.slice(token.length))) name = name.slice(token.length).replace(/^[\s\-·:：/]+/, '');
      if (name.endsWith(token) && /[\s\-·:：/]$/.test(name.slice(0, -token.length))) name = name.slice(0, -token.length).replace(/[\s\-·:：/]+$/, '');
    }
    if (name !== title && /[\p{Script=Han}A-Za-z]{2}/u.test(name)) suggestions.add(name);
  }
  return suggestions.size === 1 ? [...suggestions][0] : title;
}

export function suggestErpProductTitles(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    for (const candidate of row.erpCatalogFields?.productName?.candidates ?? []) {
      const rawName = text(candidate.value);
      const name = titleFromSellingSpecs(rawName, row);
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
