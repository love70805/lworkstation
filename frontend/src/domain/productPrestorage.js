import { catalogProductName } from './erpProductCatalog';
import { canonicalPlatformSku } from './identifiers';
import { productDraftReferences, productSalePrice } from './productSelectionDraft';
import { validateProductDraft } from './productCatalog';

const text = value => String(value ?? '').trim();
const validUrl = value => { try { return ['https:', 'http:'].includes(new URL(text(value)).protocol); } catch { return false; } };
export const isPrestorageProduct = product => product?.status === 'draft';
export const canAutoPromotePrestorage = product => isPrestorageProduct(product)
  && (product.attributes?.catalogOrigin === 'ledger_import' || product.attributes?.prestorage?.autoPromote === true);

// Full catalog completeness is independent of the user-facing sales status.
// Zero prices are valid; a blank field must never become a zero.
export function productPrestorageReadiness({ draft = {}, prefill = {}, historicalRows = [] } = {}) {
  const missing = [];
  const add = (key, label, platformSku = null) => missing.push({ key, label, platformSku });
  if (!catalogProductName(draft.name)) add('name', '商品名称');
  if (!validUrl(draft.imageUrl)) add('image', '商品图片');
  if (!text(draft.platformSkc)) add('skc', '平台 SKC');
  if (!text(draft.store)) add('store', '店铺');
  const suppliers = draft.suppliers?.length ? draft.suppliers : [draft];
  if (!suppliers.some(supplier => validUrl(supplier.sourceUrl))) add('supplier', '供应商来源链接');
  const variants = draft.variants ?? [];
  if (!variants.some(variant => text(variant.platformSku))) add('sku', '平台 SKU');
  const references = productDraftReferences(draft, historicalRows);
  variants.forEach((variant, index) => {
    const sku = text(variant.platformSku);
    if (!sku) { add(`sku_${index}`, '平台 SKU', `第 ${index + 1} 个分支`); return; }
    if (!text(variant.attribute)) add(`attribute_${index}`, '属性/规格', sku);
    if (productSalePrice(variant.salePrice) == null) add(`price_${index}`, '售价', sku);
    if (productSalePrice(references[index]?.unitCost) == null) add(`cost_${index}`, '参考成本', sku);
  });
  const validation = validateProductDraft(draft);
  validation.blockingIssues.filter(issue => issue !== 'product_name_required').forEach(issue => add(issue, '资料格式待核对'));
  const excluded = new Set((draft.excludedIdentitySkus ?? []).map(canonicalPlatformSku));
  const identityConflicts = (draft.identityConflicts ?? prefill.identityConflicts ?? []).filter(item => !excluded.has(canonicalPlatformSku(item.platformSku)));
  if (identityConflicts.length) add('identity_conflict', '商品身份冲突');
  if (draft.legacyStatusConflict && !draft.statusEdited) add('status_conflict', '商品状态待选择');
  if (prefill.needsTitleChoice && !draft.fieldEdits?.name) add('title_choice', '商品名称待选择');
  const included = new Set(variants.map(variant => canonicalPlatformSku(variant.platformSku)));
  (prefill.conflicts ?? []).filter(item => included.has(canonicalPlatformSku(item.platformSku))
    && !draft.fieldEdits?.variants?.[canonicalPlatformSku(item.platformSku)]?.[item.field]).forEach(item => add(`conflict_${item.platformSku}_${item.field}`, '资料来源冲突', item.platformSku));
  return { ready: missing.length === 0, missing, labels: [...new Set(missing.map(item => item.label))], references };
}
