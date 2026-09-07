import Decimal from "decimal.js";
import { canonicalPlatformSku, normalizePlatformSku } from "./identifiers";
import { DEFAULT_CURRENCY } from "./erpCosts";

export const COST_POLICY_VERSION = "formal-cost-policy@5-truncate-2dp";

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function positiveAmount(value) {
  try {
    const amount = new Decimal(value);
    return amount.isFinite() && amount.gt(0) ? amount : null;
  } catch {
    return null;
  }
}

function isResolvedErpCost(candidate) {
  if (candidate?.resolutionStatus === "resolved") return true;
  return candidate?.resolutionStatus == null
    && Boolean(text(candidate?.publishedAt))
    && Number(candidate?.unresolvedAnomalyCount ?? 0) === 0;
}

function normalizeCandidate(candidate, expectedCanonicalSku, kind) {
  if (!candidate) return { candidate: null, issues: [] };

  const issues = [];
  const amount = positiveAmount(candidate.unitCost ?? candidate.amount);
  const currency = String(candidate.currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
  const candidateSku = text(candidate.platformSku);

  if (!amount) issues.push(`invalid_${kind}_amount`);
  if (currency !== DEFAULT_CURRENCY) issues.push(`unsupported_${kind}_currency`);
  if (kind === "erp" && !isResolvedErpCost(candidate)) {
    issues.push("erp_cost_anomaly_pending");
  }
  if (candidateSku && canonicalPlatformSku(candidateSku) !== expectedCanonicalSku) {
    issues.push(`${kind}_sku_mismatch`);
  }

  return {
    candidate: issues.length === 0 ? {
      ...candidate,
      id: text(candidate.id),
      unitCost: amount.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber(),
      currency,
    } : null,
    issues,
  };
}

function validateApproval({ approval, referenceCost, ledgerId, canonicalSku }) {
  if (!approval) return ["approval_required"];

  const issues = [];
  const approvedAmount = positiveAmount(approval.approvedAmount ?? approval.unitCost);
  const approvedAt = text(approval.approvedAt);
  const approvalSku = text(approval.platformSku);
  const approvalCurrency = String(approval.currency ?? DEFAULT_CURRENCY).trim().toUpperCase();

  if (approval.status !== "approved") issues.push("approval_not_approved");
  if (!text(approval.id)) issues.push("approval_id_required");
  if (!text(approval.approvedBy)) issues.push("approval_actor_required");
  if (!text(approval.reason)) issues.push("approval_reason_required");
  if (!approvedAt || !Number.isFinite(Date.parse(approvedAt))) issues.push("approval_time_invalid");
  if (text(approval.ledgerId) !== text(ledgerId)) issues.push("approval_ledger_mismatch");
  if (!approvalSku || canonicalPlatformSku(approvalSku) !== canonicalSku) issues.push("approval_sku_mismatch");
  if (text(approval.referenceCostId) !== text(referenceCost.id)) issues.push("approval_reference_mismatch");
  if (approvalCurrency !== DEFAULT_CURRENCY) issues.push("approval_currency_unsupported");
  if (!approvedAmount || !new Decimal(referenceCost.unitCost).eq(approvedAmount.toDecimalPlaces(2, Decimal.ROUND_DOWN))) {
    issues.push("approval_amount_mismatch");
  }

  return issues;
}

function latestValidCost(items, kind) {
  return (items ?? [])
    .map((item, index) => {
      if (kind === "erp_history" && !isResolvedErpCost(item)) return null;
      const amount = positiveAmount(item.unitCost ?? item.amount);
      const currency = String(item.currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
      if (!amount || currency !== DEFAULT_CURRENCY) return null;
      const dateText = text(item.effectiveAt ?? item.calculatedAt ?? item.finalizedAt ?? item.createdAt);
      const timestamp = dateText && Number.isFinite(Date.parse(dateText)) ? Date.parse(dateText) : index;
      return {
        ...item,
        unitCost: kind === "finalized_profit_history"
          ? amount.toNumber()
          : amount.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber(),
        currency,
        referenceKind: kind,
        _timestamp: timestamp,
      };
    })
    .filter(Boolean)
    .toSorted((a, b) => b._timestamp - a._timestamp)[0] ?? null;
}

export function resolveFormalCostDecision({
  ledgerId,
  platformSku,
  erpCost = null,
  reference1688Cost = null,
  approval = null,
}) {
  const normalizedSku = normalizePlatformSku(platformSku);
  const canonicalSku = canonicalPlatformSku(normalizedSku);
  const reasons = [];
  const normalizedErp = normalizeCandidate(erpCost, canonicalSku, "erp");
  reasons.push(...normalizedErp.issues);

  if (normalizedErp.candidate) {
    return {
      status: "final",
      calculationMode: "exact",
      eligibleForExactProfit: true,
      platformSku: normalizedSku,
      canonicalPlatformSku: canonicalSku,
      ledgerId: text(ledgerId),
      source: "erp",
      unitCost: normalizedErp.candidate.unitCost,
      currency: DEFAULT_CURRENCY,
      sourceRecordId: normalizedErp.candidate.id,
      approvalId: null,
      reasons,
      policyVersion: COST_POLICY_VERSION,
    };
  }

  const normalizedReference = normalizeCandidate(reference1688Cost, canonicalSku, "reference_1688");
  reasons.push(...normalizedReference.issues);

  if (!normalizedReference.candidate) {
    return {
      status: "missing",
      calculationMode: null,
      eligibleForExactProfit: false,
      platformSku: normalizedSku,
      canonicalPlatformSku: canonicalSku,
      ledgerId: text(ledgerId),
      source: null,
      unitCost: null,
      currency: DEFAULT_CURRENCY,
      sourceRecordId: null,
      approvalId: null,
      reasons,
      policyVersion: COST_POLICY_VERSION,
    };
  }

  if (!approval) {
    return {
      status: "reference_only",
      calculationMode: "reference",
      eligibleForExactProfit: false,
      platformSku: normalizedSku,
      canonicalPlatformSku: canonicalSku,
      ledgerId: text(ledgerId),
      source: "1688_reference",
      unitCost: normalizedReference.candidate.unitCost,
      currency: DEFAULT_CURRENCY,
      sourceRecordId: normalizedReference.candidate.id,
      approvalId: null,
      reasons: [...reasons, "approval_required"],
      policyVersion: COST_POLICY_VERSION,
    };
  }

  const approvalIssues = validateApproval({
    approval,
    referenceCost: normalizedReference.candidate,
    ledgerId,
    canonicalSku,
  });

  if (approvalIssues.length > 0) {
    return {
      status: "pending_approval",
      calculationMode: "reference",
      eligibleForExactProfit: false,
      platformSku: normalizedSku,
      canonicalPlatformSku: canonicalSku,
      ledgerId: text(ledgerId),
      source: "1688_reference",
      unitCost: normalizedReference.candidate.unitCost,
      currency: DEFAULT_CURRENCY,
      sourceRecordId: normalizedReference.candidate.id,
      approvalId: text(approval.id),
      reasons: [...reasons, ...approvalIssues],
      policyVersion: COST_POLICY_VERSION,
    };
  }

  return {
    // A reviewed 1688 amount is useful for operational reference, but it is
    // never a substitute for the ERP purchase-cost record in a formal ledger.
    status: "manual_fallback",
    calculationMode: "reference",
    eligibleForExactProfit: false,
    platformSku: normalizedSku,
    canonicalPlatformSku: canonicalSku,
    ledgerId: text(ledgerId),
    source: "approved_1688",
    unitCost: normalizedReference.candidate.unitCost,
    currency: DEFAULT_CURRENCY,
    sourceRecordId: normalizedReference.candidate.id,
    approvalId: text(approval.id),
    reasons,
    policyVersion: COST_POLICY_VERSION,
  };
}

export function selectSelectionReferenceCost({
  erpHistory = [],
  manualConfirmedCost = null,
  finalizedProfitHistory = [],
  supplierLandedCost = null,
}) {
  const erp = latestValidCost(erpHistory, "erp_history");
  if (erp) {
    const { _timestamp, ...result } = erp;
    return { ...result, calculationMode: "reference", authoritativeSource: "erp" };
  }

  const manual = latestValidCost(manualConfirmedCost ? [manualConfirmedCost] : [], "manual_confirmed");
  if (manual) {
    const { _timestamp, ...result } = manual;
    return { ...result, calculationMode: "reference", authoritativeSource: "manual_confirmed" };
  }

  const finalized = latestValidCost(finalizedProfitHistory, "finalized_profit_history");
  if (finalized) {
    const { _timestamp, ...result } = finalized;
    return { ...result, calculationMode: "reference", authoritativeSource: finalized.costSource ?? "historical_final" };
  }

  const supplier = latestValidCost(supplierLandedCost ? [supplierLandedCost] : [], "supplier_landed");
  if (supplier) {
    const { _timestamp, ...result } = supplier;
    return { ...result, calculationMode: "reference", authoritativeSource: "1688_reference" };
  }

  return null;
}
