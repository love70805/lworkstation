import { canonicalPlatformSku, canonicalPlatformSkc } from './identifiers';
import { resolveFormalCostDecision } from './costPolicy';

const text = value => String(value ?? '').normalize('NFKC').trim();
export const LEDGER_COST_IDENTITY_VERSION = 'ledger-cost-identity@1';

// Build from the complete ledger, before any store/search/missing-cost filter.
// A manual amount can replace a price, but cannot resolve an ambiguous parent.
export function buildLedgerSkuIdentityIndex(salesRows = []) {
  const identities = new Map();
  for (const row of salesRows) {
    const platformSku = text(row.platformSku ?? row.sku);
    if (!platformSku) continue;
    const key = canonicalPlatformSku(platformSku);
    const identity = identities.get(key) ?? { platformSku, canonicalPlatformSku: key, platformSkcs: new Map() };
    const platformSkc = text(row.platformSkc);
    if (platformSkc) identity.platformSkcs.set(canonicalPlatformSkc(platformSkc), platformSkc);
    identities.set(key, identity);
  }
  return identities;
}

export function ledgerCostIdentityIssue(identity, erpCost = null, { requireSkc = false } = {}) {
  const platformSkcs = [...(identity?.platformSkcs.values() ?? [])];
  const issue = { platformSku: identity?.platformSku ?? erpCost?.platformSku, ledgerPlatformSkcs: platformSkcs };
  if (platformSkcs.length > 1) return { ...issue, code: 'ledger_sku_skc_conflict' };
  if (!erpCost) return null;
  const erpPlatformSkc = text(erpCost.platformSkc);
  if (!platformSkcs.length) return requireSkc ? { ...issue, code: 'ledger_skc_unverified', erpPlatformSkc } : null;
  if (!erpPlatformSkc) return requireSkc ? { ...issue, code: 'erp_cost_skc_unverified', erpPlatformSkc } : null;
  if (!identity.platformSkcs.has(canonicalPlatformSkc(erpPlatformSkc))) {
    return { ...issue, code: 'erp_cost_skc_mismatch', erpPlatformSkc };
  }
  return null;
}

export function describeLedgerCostIdentityIssue(issue) {
  if (!issue) return '';
  const sku = `平台 SKU ${issue.platformSku}`;
  if (issue.code === 'ledger_sku_skc_conflict') return `${sku} 在本月台账对应多个平台 SKC（${issue.ledgerPlatformSkcs.join('、')}），请核对并重新导入正确归属；人工金额不能替代归属核对。`;
  if (issue.code === 'erp_cost_skc_mismatch') return `${sku} 当前台账 SKC ${issue.ledgerPlatformSkcs[0]} 与已采用 ERP 成本 SKC ${issue.erpPlatformSkc} 不一致，请按当前归属重新采集或按店铺人工更正。`;
  if (issue.code === 'ledger_skc_unverified') return `${sku} 的台账缺少平台 SKC，无法核实 ERP 成本归属，请补齐台账或按店铺人工更正。`;
  return `${sku} 已采用的 ERP 成本缺少平台 SKC，无法核实成本归属，请重新采集或按店铺人工更正。`;
}

export function resolveLedgerCostDecision({ identity, ...scope }) {
  const decision = resolveFormalCostDecision(scope);
  // Some valid historical adoptions predate persisted SKC evidence. Preserve
  // their existing eligibility; never invent a parent. New ERP envelopes are
  // checked strictly on adoption, and every known mismatch/conflict is blocked.
  const issue = ledgerCostIdentityIssue(identity,
    decision.source === 'manual_override' ? null : scope.erpCost);
  if (!issue) return decision;
  return { ...decision, status: 'missing', calculationMode: null, eligibleForExactProfit: false,
    source: null, unitCost: null, sourceRecordId: null, approvalId: null,
    reasons: [...decision.reasons, issue.code], identityIssue: issue };
}
