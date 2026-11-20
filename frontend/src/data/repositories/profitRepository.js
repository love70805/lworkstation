import Dexie from "dexie";
import { erpInboxSummary, indexedErpInboxSummary } from '../../domain/erpInboxSummary';
import { profitCostFields, profitCostWithinPeriod, packProfitSearch, unpackProfitSearch } from '../../domain/profitPageProjection';
import { committedCostSource, readCostSaleIdentities } from './costActionSources';
import { assertLedgerCostEditingReady, assertCachedLedgerCostEditingReady, readReceiptStates } from './erpCostEditingGuard';
import { erpLedgerVersion } from '../../domain/erpLedgerVersion';
import { calculateLedgerCostCoverage, ledgerStatusFromCoverage, projectCoverageCost } from "../../domain/costCoverage";
import { resolveFormalCostDecision } from "../../domain/costPolicy";
import { buildLedgerSkuIdentityIndex, ledgerCostIdentityIssue, resolveLedgerCostDecision, describeLedgerCostIdentityIssue, LEDGER_COST_IDENTITY_VERSION } from '../../domain/ledgerCostIdentity';
import {
  canonicalPlatformSkc,
  canonicalPlatformSku,
  canonicalWarehouseSku,
  normalizePlatformSku,
} from "../../domain/identifiers";
import { summarizeLedgerRows } from "../../domain/ledgerImport";
import { prepareSalesImportItems } from "../../domain/batchSalesImport";
import { createLedgerCatalogDraftBuilder } from "../../domain/ledgerCatalogDraft";
import { createSalesRowsAuditSnapshotBuilder, encodeSalesRowsAuditSnapshot } from "../../domain/salesRowsAuditSnapshot";
import { readImportStageChunk } from "../../lib/salesImportStage";
import { computeSalesImportPlan, prepareSalesImportSnapshot } from "../../lib/salesImportPlanner";
import { normalizeSalesSourceCoverage, salesSourceDateEvidence } from "../../domain/selectionSalesLabels";
import { ERP_COST_BATCH_VERSION, validateErpCostBatchEnvelope } from "../../domain/erpCostBatchEnvelope";
import { normalizeErpCatalogFields } from "../../domain/erpCatalogFields";
import { erpProductCatalogRowsFromEnvelope } from "../../domain/erpProductCatalog";
import { buildErpCostInboxEnvelope, validateErpCostInboxEnvelope } from "../../domain/erpInboxContract";
import { calculateWarehouseCostDecision, ERP_COST_RESOLUTION_VERSION, normalizedResolution, upsertCostResolution } from "../../domain/erpCostResolution";
import { indexErpAnomalyEvidence } from "../../domain/erpAnomalyEvidence";
import { hasLegacyMonthExclusions, isErpCostWithinPeriod } from "../../domain/erpCostPeriod";
import { purchaseOrderSummary } from "../../domain/erpPurchaseSelection";
import { buildErpVoidTransitionId } from "../../domain/syncLifecycleGroup";
import { runtimeConfig } from "../../config/runtimeConfig";
import { db } from "../db/clientDatabase";
import { readLedgerSalesRows, ledgerSnapshotRevision, observeLedgerSnapshotRevision, forEachLedgerChunk } from './ledgerReadCache';
import { readProfitPageSales } from './profitPageSalesRepository';
import { readActionCostFacts, readActionCostRows, readActionHeaderIndex, readCostIds, readIndexedProfitCosts, completeProfitResolutionIndex } from './profitCostIndex';
import { hasOpenCostReview } from '../../lib/costReviewActivity';
import { runDerivedComputation } from './derivedComputationService';
import {
  readErpRecoveryProbe, cachedErpRecoveryResult, rememberErpRecoveryResult, loadErpRecoveryMemo, persistErpRecoveryMemo,
  recoveryIgnoreIds, readRecoveryAdoptionInputs, adoptionCostHeader, adoptionBatchHeader,
} from './erpRecoveryReadCache';
import { sourceRevision, selectionFactsRevision, cachedDerived, assertSourceRevision, retrySourceRead, observeSourceRevision, observeTableRevision, tableRevisionReader, inboxRowVersion } from '../db/derivedCache';
import {
  ACTIVE_MEMBER_CONTEXT_KEY,
  DEFAULT_MEMBER_ID,
  DEFAULT_WORKSPACE_ID,
  monthlyLedgerId,
  normalizeLedgerPeriod,
} from "../db/constants";
import { makeId } from "../db/utils";
import { ensureDefaultWorkspace, getActiveMemberContext, ensureLedgerCatalogDrafts } from "./selectionRepository";
import { manualSnapshot, selectManualOverride, createManualOverrideLookup, manualCostConflicts, storeIdentity, storeSkuKey, validManualOverride } from "../../domain/manualCostOverride";
import { calculateFormalLedgerRows, comparableProfitLines } from "../../domain/ledgerProfit";
import { planWarehouseHistoryCosts, WAREHOUSE_HISTORY_FORMAT } from '../../domain/erpWarehouseHistory';
import { normalizeErpHistoryMappings } from '../../../../integrations/contracts/erp-history-mappings.mjs';
import { summarizeProfitRows } from "../../lib/profitPrecision";
import { reconcileErpCostRows } from "../../domain/erpCosts";
import { erpAdoptionReadiness } from "../../domain/erpAdoptionReadiness";
import { ERP_ADOPTION_VERSION, erpSourceOrder, compareErpSourceOrder, erpBatchAdoptionBoundary, legacyExpectedSkusForRequest, summarizeErpAdoption } from "../../domain/erpAutomaticAdoption";
import { readAdoptionEvidence, ignorableErpPriceAnomaly, newestAnomalyReceipts, uncoveredAnomalySkus, createAnomalyReview, reviewErpAnomalyReceipt } from "../../domain/erpAnomalyPreview";
import { operatingLedger, costEvaluationPeriod, accountingApprovals, LOWEST_ACCOUNTING } from '../../domain/inventoryAccounting';
import { readAccountingMode, accountingCosts, projectAccountingLedger, accountingRateKey, readHistoricalLowestCosts, readLowestPurchaseReview } from './inventoryAccountingRepository';
import { inventoryCalculationRevision, inventoryEvidenceRevision, inventoryLowestRevision, observeInventoryRevision, publishedCostRevision, observePublishedCostRevision } from '../db/inventoryRevisions';

const TECHNICAL_AUDIT_ACTORS = new Set(["erp-assistant-v8", "system-migration"]);

export function selectProfitAuditActor({
  activeMemberId = "",
  requestedActor = "",
  cloudConfigured = false,
} = {}) {
  const active = String(activeMemberId ?? "").trim();
  if (active && active !== DEFAULT_MEMBER_ID) return active;
  if (cloudConfigured) throw new Error("云端同步需要先选择已登录的工作区成员。");
  const requested = String(requestedActor ?? "").trim();
  if (requested && !TECHNICAL_AUDIT_ACTORS.has(requested)) return requested;
  return DEFAULT_MEMBER_ID;
}

async function resolveProfitAuditActor(requestedActor) {
  const context = await db.settings.get(ACTIVE_MEMBER_CONTEXT_KEY);
  return selectProfitAuditActor({
    activeMemberId: context?.memberId,
    requestedActor,
    cloudConfigured: runtimeConfig.cloudConfigured,
  });
}
async function readLedgerCostCoverage(ledgerId, current = {}) {
  const [salesRows, erpCosts, approvals] = await Promise.all([
    current.salesRows ?? db.salesRows.where("ledgerId").equals(ledgerId).toArray(),
    current.erpCosts ?? getLatestLedgerCosts(ledgerId),
    db.costApprovals.where("ledgerId").equals(ledgerId).toArray(),
  ]);
  const ledger = current.ledger ?? await db.ledgers.get(ledgerId);
  return calculateLedgerCostCoverage({ salesRows, erpCosts, approvals: accountingApprovals(approvals), workspaceId: ledger?.workspaceId, ledgerId, period: ledger?.period }, current.checkPeriod);
}

const readActionCosts = committedCostSource(['erpCostRows','erpCostBatches','erpCostRequests'], async ledger =>
  (await scanProfitPageCosts(ledger, true, true)).costs);
async function manualCostInputs(ledger, mode) {
  const rows = await readCostSaleIdentities(ledger, false);
  const weightedCosts = await readActionCosts(ledger);
  const erpCosts = mode === LOWEST_ACCOUNTING ? await accountingCosts(ledger, [], mode, rows) : weightedCosts;
  return { rows, erpCosts, weightedCosts, approvals: await db.costApprovals.where('ledgerId').equals(ledger.id).toArray() };
}

export async function saveManualCostOverride({ ledgerId, store, platformSku, unitCost, reason, historyEvidence = null, expectedAccountingMode }) {
  return mutateManualCostOverride({ ledgerId, store, platformSku, unitCost, reason, historyEvidence, expectedAccountingMode });
}

export async function revokeManualCostOverride({ ledgerId, approvalId, expectedAccountingMode }) {
  return mutateManualCostOverride({ ledgerId, approvalId, revoke: true, expectedAccountingMode });
}

async function mutateManualCostOverride({ ledgerId, store, platformSku, unitCost, reason, approvalId, revoke = false, historyEvidence = null, expectedAccountingMode }, batchContext = null) {
  await assertLedgerCostEditingReady(ledgerId);
  const amount = Number(unitCost);
  if (!revoke && (unitCost == null || String(unitCost).trim() === "" || !Number.isFinite(amount) || amount < 0)) throw new Error("人工更正成本必须是非负有限数值。");
  if (!revoke && !String(reason ?? "").trim()) throw new Error("请填写更正说明。");
  return db.transaction("rw", db.settings, db.ledgers, db.salesRows, db.erpCostRequests, db.erpCostInbox, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.auditEvents, async () => {
    const member = await getActiveMemberContext();
    const ledger = operatingLedger(await db.ledgers.get(ledgerId));
    if (!ledger || ledger.workspaceId !== member.workspaceId || !["admin", "finance"].includes(member.role)) throw new Error("当前成员无此账本的财务写权限。");
    if (["finalized", "locked"].includes(ledger.status)) throw new Error("已定稿或锁定账本不能更正或撤销成本，请先显式重开。");
    await assertCachedLedgerCostEditingReady(ledger);
    const mode = await readAccountingMode(ledger.workspaceId);
    if (expectedAccountingMode != null && expectedAccountingMode !== mode) throw new Error('核算上下文已变化，请重新打开成本明细。');
    const { rows, erpCosts, weightedCosts, approvals } = batchContext ?? await manualCostInputs(ledger, mode);
    const visible = accountingApprovals(approvals, mode);
    const target = revoke ? visible.find((item) => item.id === approvalId && item.workspaceId === ledger.workspaceId && manualSnapshot(item)?.kind === "manual_override" && item.status === "approved") : null;
    if (revoke && !target) throw new Error("找不到当前账本有效的人工更正。");
    const scopedStore = storeIdentity(revoke ? manualSnapshot(target).store : store);
    const sku = normalizePlatformSku(revoke ? target.platformSku : platformSku);
    if (!scopedStore || !rows.some((row) => storeIdentity(row.store) === scopedStore && canonicalPlatformSku(row.platformSku ?? row.sku) === canonicalPlatformSku(sku))) throw new Error("店铺和 SKU 不属于当前账本。");
    const now = new Date().toISOString();
    const scope = { workspaceId: ledger.workspaceId, ledgerId, store: scopedStore, platformSku: sku };
    const previous = selectManualOverride(visible, scope);
    if (revoke && previous?.id !== approvalId) throw new Error("人工成本已变化，请重新打开成本明细。");
    const erpCost = erpCosts.find((row) => canonicalPlatformSku(row.platformSku) === canonicalPlatformSku(sku));
    const checkPeriod = mode === LOWEST_ACCOUNTING ? undefined : profitCostWithinPeriod;
    const oldDecision = resolveLedgerCostDecision({ ...scope, accountingMode: mode, identity: buildLedgerSkuIdentityIndex(rows).get(canonicalPlatformSku(sku)), period: mode === LOWEST_ACCOUNTING ? null : ledger.period, manualOverride: previous, erpCost }, checkPeriod);
    const auditActor = await resolveProfitAuditActor();
    const revokedRecords = approvals.filter(item => item.workspaceId === ledger.workspaceId && item.ledgerId === ledgerId && item.status === "approved"
      && manualSnapshot(item)?.kind === "manual_override" && storeIdentity(manualSnapshot(item).store) === scopedStore
      && String(item.platformSku ?? '').trim() && canonicalPlatformSku(item.platformSku) === canonicalPlatformSku(sku));
    for (const item of revokedRecords) {
      const revoked = { ...item, status: "revoked", revokedAt: now, revokedBy: auditActor, revokeReason: revoke ? "撤销人工更正" : "由新人工更正替代" };
      await db.costApprovals.put(revoked);
      await db.auditEvents.add({ workspaceId: ledger.workspaceId, objectType: "cost_approval", objectId: item.id, action: "manual_override_revoked", actorId: auditActor, createdAt: now, before: { snapshot: item }, after: { snapshot: revoked } });
    }
    let saved = null;
    if (!revoke) {
      const referenceId = makeId("MANUAL-COST");
      saved = { id: makeId("OVERRIDE"), workspaceId: ledger.workspaceId, ledgerId, platformSku: sku, canonicalPlatformSku: canonicalPlatformSku(sku), referenceCostId: referenceId, approvedAmount: amount, currency: "CNY", reason: String(reason).trim(), approvedBy: auditActor, approvedAt: now, status: "approved",
        referenceCost: { id: referenceId, kind: "manual_override", store: scopedStore, unitCost: amount, currency: "CNY", previousUnitCost: oldDecision.unitCost, previousSource: oldDecision.source,
          ...(historyEvidence ? { historyEvidence: structuredClone(historyEvidence) } : {}) } };
      await db.costApprovals.add(saved);
    }
    const coverage = batchContext ? null : await readLedgerCostCoverage(ledgerId, { ledger, salesRows: rows, erpCosts: weightedCosts, checkPeriod: profitCostWithinPeriod });
    const savedLedger = coverage ? { ...ledger, ...buildLedgerCoveragePatch(ledger, coverage, now) } : ledger;
    if (coverage) await db.ledgers.put(savedLedger);
    if (saved) await db.auditEvents.add({ workspaceId: ledger.workspaceId, objectType: "cost_approval", objectId: saved.id, action: "manual_override_saved", actorId: auditActor, createdAt: now, before: { unitCost: oldDecision.unitCost, source: oldDecision.source, store: scopedStore }, after: { snapshot: { ...saved, ledger: savedLedger } } });
    else {
      const event = (await db.auditEvents.where("objectId").equals(target.id).toArray()).filter((item) => item.action === "manual_override_revoked").at(-1);
      await db.auditEvents.update(event.id, { after: { snapshot: { ...await db.costApprovals.get(target.id), ledger: savedLedger } } });
    }
    return saved;
  });
}

// One transaction and one coverage recomputation for a user-confirmed group.
export async function saveManualCostOverrideGroup({ ledgerId, targets, unitCost, reason, expectedAccountingMode }) {
  await assertLedgerCostEditingReady(ledgerId);
  if (!targets?.length || new Set(targets.map(row => JSON.stringify([storeIdentity(row.store), canonicalPlatformSku(row.platformSku)]))).size !== targets.length) throw new Error('批量更正范围无效。');
  return db.transaction('rw', db.settings, db.ledgers, db.salesRows, db.erpCostRequests, db.erpCostInbox, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.auditEvents, async () => {
    const ledger = operatingLedger(await db.ledgers.get(ledgerId));
    const mode = await readAccountingMode(ledger.workspaceId);
    const context = await manualCostInputs(ledger, mode);
    const saved = [];
    for (const row of targets) saved.push(await mutateManualCostOverride({ ledgerId, ...row, unitCost, reason, expectedAccountingMode }, context));
    const coverage = await readLedgerCostCoverage(ledgerId, { ledger, salesRows: context.rows, erpCosts: context.weightedCosts, checkPeriod: profitCostWithinPeriod });
    await db.ledgers.put({ ...ledger, ...buildLedgerCoveragePatch(ledger, coverage, new Date().toISOString()) });
    return saved;
  });
}

async function warehouseHistoryPlan({ ledgerId, history, expectedAccountingMode }) {
  const member = await getActiveMemberContext();
  const original = operatingLedger(await db.ledgers.get(ledgerId));
  if (!original || original.workspaceId !== member.workspaceId || !['admin', 'finance'].includes(member.role)) throw new Error('当前成员无此账本的财务写权限。');
  const mode = await readAccountingMode(member.workspaceId);
  if (expectedAccountingMode && expectedAccountingMode !== mode) throw new Error('核算上下文已变化，请重新打开成本明细。');
  const ledger = await projectAccountingLedger(original, mode);
  const [rows, originalCosts, approvals, batches] = await Promise.all([
    db.salesRows.where('ledgerId').equals(ledgerId).toArray(), getLatestLedgerCosts(ledgerId),
    db.costApprovals.where('ledgerId').equals(ledgerId).toArray(), db.erpCostBatches.where('workspaceId').equals(member.workspaceId).toArray(),
  ]);
  const costs = await accountingCosts(ledger, originalCosts, mode, rows);
  const identities = buildLedgerSkuIdentityIndex(rows);
  const visibleApprovals = accountingApprovals(approvals, mode);
  const manualFor = createManualOverrideLookup(visibleApprovals);
  const conflicts = manualCostConflicts(visibleApprovals, ledger);
  const costBySku = new Map(costs.map(row => [canonicalPlatformSku(row.platformSku), row]));
  const uniqueRows = new Map(rows.map(row => [JSON.stringify([row.store, canonicalPlatformSku(row.platformSku), canonicalPlatformSkc(row.platformSkc)]), row]));
  const targets = new Map();
  for (const row of uniqueRows.values()) {
    const scope = { workspaceId: member.workspaceId, ledgerId, store: row.store, platformSku: row.platformSku };
    if (conflicts.has(storeSkuKey(row.store, row.platformSku))) continue;
    const decision = resolveLedgerCostDecision({ ...scope, accountingMode: mode, period: costEvaluationPeriod(ledger), identity: identities.get(canonicalPlatformSku(row.platformSku)), manualOverride: manualFor(scope), erpCost: costBySku.get(canonicalPlatformSku(row.platformSku)) });
    if (decision.eligibleForExactProfit) continue;
    targets.set(JSON.stringify([row.store, canonicalPlatformSku(row.platformSku), canonicalPlatformSkc(row.platformSkc)]), { store: row.store, platformSku: row.platformSku, platformSkc: row.platformSkc });
  }
  const trustedBatches = new Set(batches.filter(batch => batch.status === 'published').map(batch => batch.id));
  const oldRows = targets.size ? await db.erpCostRows.where('canonicalPlatformSku').anyOf([...new Set([...targets.values()].map(row => canonicalPlatformSku(row.platformSku)))]).toArray() : [];
  const knownMappings = oldRows.filter(row => row.workspaceId === member.workspaceId && trustedBatches.has(row.batchId) && row.platformSkc && row.warehouseSku && row.evidenceComplete === true && !row.mappingFallback);
  return { ledger, ...planWarehouseHistoryCosts({ history, period: ledger.period, targets: [...targets.values()], knownMappings, accountingMode: mode }) };
}

export async function readErpHistoryMappings({ ledgerId, expectedSkus = [] }) {
  const member = await getActiveMemberContext(), ledger = operatingLedger(await db.ledgers.get(ledgerId));
  if (!ledger || ledger.workspaceId !== member.workspaceId || !['admin', 'finance'].includes(member.role)) throw new Error('当前成员无此账本的财务权限。');
  const skus = [...new Set(expectedSkus.map(row => canonicalPlatformSku(row.platformSku)).filter(Boolean))];
  if (!skus.length) return [];
  const [batchIds, publishedIds, approvals] = await Promise.all([
    db.erpCostBatches.where('workspaceId').equals(member.workspaceId).primaryKeys(),
    db.erpCostBatches.where('status').equals('published').primaryKeys(),
    db.costApprovals.where('workspaceId').equals(member.workspaceId).toArray(),
  ]);
  const published = new Set(publishedIds), owned = new Set(batchIds);
  const pairs = new Set(expectedSkus.map(row => JSON.stringify([canonicalPlatformSku(row.platformSku), canonicalPlatformSkc(row.platformSkc)])));
  const hints = [];
  await db.erpCostRows.where('canonicalPlatformSku').anyOf(skus).each(row => {
    if (!(row.workspaceId === member.workspaceId && owned.has(row.batchId) && published.has(row.batchId)
    && row.evidenceComplete === true && !row.mappingFallback && row.warehouseSku
    && pairs.has(JSON.stringify([canonicalPlatformSku(row.platformSku), canonicalPlatformSkc(row.platformSkc)])))) return;
    hints.push({
      platformSku: row.platformSku, platformSkc: row.platformSkc, warehouseSku: row.warehouseSku,
      sourceRecordId: String(row.id), sourceBatchId: row.batchId,
      observedAt: row.publishedAt,
      ...(row.store ? { store: row.store } : {}),
      ...(row.unitConversion ? { unitConversion: row.unitConversion } : {}),
    });
  });
  const batchDates = new Map();
  for (const hint of hints) if (hint.observedAt == null) {
    if (!batchDates.has(hint.sourceBatchId)) batchDates.set(hint.sourceBatchId, (await db.erpCostBatches.get(hint.sourceBatchId))?.publishedAt);
    hint.observedAt = batchDates.get(hint.sourceBatchId);
  }
  for (const approval of accountingApprovals(approvals)) {
    const snapshot = manualSnapshot(approval), history = snapshot?.historyEvidence, mapping = history?.historicalMapping;
    if (!mapping?.platformSku || !mapping.platformSkc || !mapping.warehouseSku
      || !validManualOverride(approval, { workspaceId: member.workspaceId, ledgerId: approval.ledgerId, store: snapshot.store, platformSku: mapping.platformSku })
      || history.format !== WAREHOUSE_HISTORY_FORMAT || history.formatVersion !== 1
      || !pairs.has(JSON.stringify([canonicalPlatformSku(mapping.platformSku), canonicalPlatformSkc(mapping.platformSkc)]))
      || !history.warehouseEvidence?.warehouseSku || canonicalWarehouseSku(history.warehouseEvidence.warehouseSku) !== canonicalWarehouseSku(mapping.warehouseSku)
      || history.warehouseEvidence.evidenceComplete !== true || !Array.isArray(history.warehouseEvidence.sourceWarnings) || history.warehouseEvidence.sourceWarnings.length) continue;
    hints.push({ platformSku: mapping.platformSku, platformSkc: mapping.platformSkc, warehouseSku: mapping.warehouseSku,
      store: snapshot.store, sourceRecordId: `approval:${approval.id}`, sourceBatchId: history.sourceBatchId ?? '',
      observedAt: approval.approvedAt, ...(mapping.unitConversion ? { unitConversion: mapping.unitConversion } : {}) });
  }
  return normalizeErpHistoryMappings(hints.filter(row => Number.isFinite(Date.parse(row.observedAt))), expectedSkus);
}

export async function previewWarehouseHistoryCosts(input) { return warehouseHistoryPlan(input); }

export async function saveWarehouseHistoryCosts({ ledgerId, history, sourceName = '仓库历史采购证据', expectedAccountingMode }) {
  await assertLedgerCostEditingReady(ledgerId);
  return db.transaction('rw', db.settings, db.ledgers, db.salesRows, db.erpCostRequests, db.erpCostInbox, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.auditEvents, async () => {
    const plan = await warehouseHistoryPlan({ ledgerId, history, expectedAccountingMode });
    const saved = [];
    for (const row of plan.ready) {
      const evidence = { ...row.historyEvidence, sourceName: String(sourceName).slice(0, 250) };
      // Re-evaluate from the preserved evidence; no imported proposed price is trusted.
      if (evidence.format !== WAREHOUSE_HISTORY_FORMAT) throw new Error('历史采购证据来源无效。');
      saved.push(await mutateManualCostOverride({ ledgerId, store: row.store, platformSku: row.platformSku, unitCost: row.unitCost,
        reason: `历史仓库采购补齐：${row.warehouseSku}；按当前核算口径核价；来源 ${evidence.sourceName}；采购记录 ${row.selectedRecordIds.join('、')}。保留历史关联，不恢复当前 ERP 映射。`, historyEvidence: evidence, expectedAccountingMode: plan.ledger.accountingMode }));
    }
    return { savedCount: saved.length, pending: plan.pending, savedIds: saved.map(row => row.id) };
  });
}

function buildLedgerCoveragePatch(ledger, coverage, updatedAt, extraSummary = {}) {
  return {
    status: ledgerStatusFromCoverage(coverage),
    updatedAt,
    costSummary: {
      ...(ledger.costSummary ?? {}),
      ...extraSummary,
      ...coverage,
      matchedCount: coverage.erpMatchedCount,
    },
  };
}

export async function createOrGetMonthlyLedger({
  workspaceId = DEFAULT_WORKSPACE_ID,
  period,
  createdBy = "local-user",
}) {
  const normalizedPeriod = normalizeLedgerPeriod(period);
  const id = monthlyLedgerId(workspaceId, normalizedPeriod);
  const existing = await db.ledgers.get(id);
  if (existing) return existing;

  const now = new Date().toISOString();
  const auditActor = await resolveProfitAuditActor(createdBy);
  const ledger = {
    id,
    workspaceId,
    period: normalizedPeriod,
    type: "monthly_profit",
    status: "draft",
    currency: "CNY",
    warehouseRate: 0.7,
    createdBy: auditActor,
    createdAt: now,
    updatedAt: now,
    summary: {
      groupCount: 0,
      skuLineCount: 0,
      quantity: 0,
      revenue: 0,
      penalty: 0,
      sourceRowCount: 0,
      realOrderCount: 0,
    },
  };

  await db.transaction("rw", db.workspaces, db.ledgers, db.auditEvents, async () => {
    await ensureDefaultWorkspace();
    await db.ledgers.add(ledger);
    await db.auditEvents.add({
      workspaceId,
      objectType: "monthly_ledger",
      objectId: id,
      action: "created",
      actorId: auditActor,
      createdAt: now,
      after: { period: normalizedPeriod, status: "draft", snapshot: ledger },
    });
  });

  return ledger;
}

async function readSalesImportPlan(workspaceId, period, items, signal) {
  const ledgerId = monthlyLedgerId(workspaceId, period);
  const ledger = operatingLedger(await db.ledgers.get(ledgerId));
  let existingRows = await db.salesRows.where("ledgerId").equals(ledgerId).toArray();
  const batches = await db.importBatches.where("ledgerId").equals(ledgerId).toArray();
  const pending = computeSalesImportPlan({ ledger, existingRows, batches, items, ledgerId, period }, { signal });
  existingRows = null;
  return { ledger, plan: await Dexie.waitFor(pending) };
}

export async function previewSalesImports({ workspaceId = DEFAULT_WORKSPACE_ID, period, items, signal }) {
  const normalizedPeriod = normalizeLedgerPeriod(period);
  const prepared = await prepareSalesImportSnapshot(items, { period: normalizedPeriod, signal });
  return db.transaction("r", db.ledgers, db.salesRows, db.importBatches, async () => {
    const { plan } = await readSalesImportPlan(workspaceId, normalizedPeriod, prepared, signal);
    return plan;
  });
}

export async function saveSalesImports({
  workspaceId = DEFAULT_WORKSPACE_ID,
  period,
  items,
  preview,
  overwriteSignature = null,
  importedBy = "local-user",
  signal,
  onProgress,
}) {
  const checkCancelled = () => { if (signal?.aborted) throw new Error("导入已取消，整批写入已回滚。"); };
  checkCancelled();
  const normalizedPeriod = normalizeLedgerPeriod(period);
  // Clone the payload before any asynchronous work, so caller edits cannot change a pending write.
  const prepared = await prepareSalesImportSnapshot(items, { period: normalizedPeriod, signal });
  const auditActor = await resolveProfitAuditActor(importedBy);
  return db.transaction("rw", db.workspaces, db.settings, db.products, db.platformSkus, db.supplierOffers, db.ledgers, db.importBatches, db.salesRows, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.auditEvents, async () => {
    checkCancelled();
    const { ledger, plan } = await readSalesImportPlan(workspaceId, normalizedPeriod, prepared, signal);
    if (!preview || preview.ledgerId !== plan.ledgerId || preview.inputSignature !== plan.inputSignature) {
      throw new Error("导入配置已变化，请重新校验整批文件。");
    }
    // A successful identical retry is a no-op even though its first commit changed the target.
    if (plan.items.every((item) => item.status === "skipped_duplicate")) return plan;
    if (preview.targetSignature !== plan.targetSignature) throw new Error("账本数据已变化，预览已过期，请刷新后重新确认。");
    if (plan.requiresOverwrite && overwriteSignature !== plan.targetSignature) throw new Error("请明确确认本次预览中的覆盖范围。");
    await ensureDefaultWorkspace();
    const createdAt = new Date().toISOString();
    const pending = prepared.filter((item, index) => plan.items[index].status !== "skipped_duplicate");
    const total = pending.reduce((count, item) => count + (item.rowSource?.rowCount ?? item.rows.length), 0);
    let completed = 0;
    const catalog = createLedgerCatalogDraftBuilder();
    const replacementIds = plan.replacementRowIds;
    if (replacementIds.length) await db.salesRows.bulkDelete(replacementIds);
    const [erpCosts, approvals] = await Promise.all([getLatestLedgerCosts(plan.ledgerId), db.costApprovals.where('ledgerId').equals(plan.ledgerId).toArray()]);
    const coverage = calculateLedgerCostCoverage({ salesRows: plan.costTargets, erpCosts, approvals, workspaceId, ledgerId: plan.ledgerId, period: normalizedPeriod });
    const savedLedger = {
      ...(ledger ?? { id: plan.ledgerId, workspaceId, period: normalizedPeriod, type: "monthly_profit", currency: "CNY", warehouseRate: 0.7, createdBy: auditActor, createdAt }),
      ...buildLedgerCoveragePatch(ledger ?? {}, coverage, createdAt), summary: plan.finalSummary,
    };
    await db.ledgers.put(savedLedger);
    for (const item of pending) {
      const result = plan.items.find((entry) => entry.itemId === item.itemId);
      const batchId = makeId("IMP");
      const savedBatch = {
        id: batchId, ledgerId: plan.ledgerId, workspaceId, fileName: item.fileName, fileHash: item.fileHash,
        mapping: item.mapping, filterOptions: item.filterOptions ?? null, createdAt, status: "completed", store: item.storeName, period: normalizedPeriod,
        sourceRowCount: item.summary.sourceRowCount, validRowCount: (item.rowSource?.rowCount ?? item.rows.length),
        ignoredRowCount: item.summary.ignoredCount ?? 0, errorCount: 0, skippedRowCount: item.summary.ignoredCount ?? 0,
        replacedGroupCount: result.replacedGroupCount, addedGroupCount: result.addedGroupCount,
        sourceCoverage: item.sourceCoverage ?? null, dateEvidence: result.dateEvidence ?? salesSourceDateEvidence(item.rows, { period: normalizedPeriod }),
        importMode: item.importMode ?? "append", removedGroupCount: result.removedGroupCount ?? 0,
      };
      await db.importBatches.add(savedBatch);
      const auditSnapshot = createSalesRowsAuditSnapshotBuilder();
      const chunkCount = item.rowSource?.chunkCount ?? Math.ceil(item.rows.length / 2000);
      for (let index = 0; index < chunkCount; index += 1) {
        checkCancelled();
        const sourceRows = item.rowSource ? await Dexie.waitFor(readImportStageChunk(item.rowSource, index)) : item.rows.slice(index * 2000, (index + 1) * 2000);
        if (!sourceRows.length) continue;
        const chunk = item.rowSource ? prepareSalesImportItems([{ ...item, rows: sourceRows }], { period: normalizedPeriod, ownedRows: true })[0].rows : sourceRows;
        if (!chunk.length) continue;
        const storedRows = chunk.map((row) => ({ ...row, workspaceId, ledgerId: plan.ledgerId, batchId, importedAt: createdAt }));
        const keys = await db.salesRows.bulkAdd(storedRows, { allKeys: true });
        storedRows.forEach((row, index) => { row.id = keys[index]; });
        auditSnapshot.addRows(storedRows);
        catalog.addRows(storedRows, batchId);
        completed += chunk.length;
        onProgress?.({ completed, total });
      }
      checkCancelled();
      await db.auditEvents.add({
        workspaceId, objectType: "sales_import_batch", objectId: batchId, action: "imported", actorId: auditActor, createdAt,
        after: { ledgerId: plan.ledgerId, fileName: item.fileName, validRowCount: (item.rowSource?.rowCount ?? item.rows.length),
          replacedGroupCount: result.replacedGroupCount, addedGroupCount: result.addedGroupCount,
          snapshot: { ...savedBatch, importBatch: savedBatch, salesRows: auditSnapshot.finish(), ledger: savedLedger } },
      });
      result.status = "imported";
      result.batchId = batchId;
    }
    plan.catalog = await ensureLedgerCatalogDrafts({ workspaceId, ledgerId: plan.ledgerId, period: normalizedPeriod,
      ...catalog.finish(), actorId: auditActor, now: createdAt });
    checkCancelled();
    return plan;
  });
}

export async function saveSalesImport({
  fileName,
  fileHash = null,
  mapping,
  summary,
  rows,
  period,
  storeName,
  filterOptions = null,
  workspaceId = DEFAULT_WORKSPACE_ID,
  importedBy = "local-user",
  sourceCoverage = null,
}) {
  const normalizedPeriod = normalizeLedgerPeriod(period);
  const ledgerId = monthlyLedgerId(workspaceId, normalizedPeriod);
  const batchId = makeId("IMP");
  const createdAt = new Date().toISOString();
  const auditActor = await resolveProfitAuditActor(importedBy);
  const groupKeys = new Set(rows.map((row) => row.groupKey));
  let replacedGroupCount = 0;
  let addedGroupCount = groupKeys.size;

  await db.transaction(
    "rw",
    db.workspaces,
    db.ledgers,
    db.importBatches,
    db.salesRows,
    db.auditEvents,
    async () => {
      await ensureDefaultWorkspace();
      const existingLedger = operatingLedger(await db.ledgers.get(ledgerId));
      if (existingLedger && ["finalized", "locked"].includes(existingLedger.status)) {
        throw new Error("已定稿或已锁定的月度账本不能直接导入新数据。");
      }

      const existingRows = existingLedger
        ? await db.salesRows.where("ledgerId").equals(ledgerId).toArray()
        : [];
      const replacedKeys = new Set(existingRows.filter((row) => groupKeys.has(row.groupKey)).map((row) => row.groupKey));
      const replacementIds = existingRows.filter((row) => groupKeys.has(row.groupKey)).map((row) => row.id);
      replacedGroupCount = replacedKeys.size;
      addedGroupCount = Math.max(0, groupKeys.size - replacedGroupCount);

      if (replacementIds.length > 0) await db.salesRows.bulkDelete(replacementIds);

      const savedBatch = {
        id: batchId,
        ledgerId,
        workspaceId,
        fileName,
        fileHash,
        mapping,
        filterOptions,
        sourceCoverage: normalizeSalesSourceCoverage(sourceCoverage, { period: normalizedPeriod, storeName }),
        dateEvidence: salesSourceDateEvidence(rows, { period: normalizedPeriod }),
        createdAt,
        status: "completed",
        store: storeName,
        period: normalizedPeriod,
        sourceRowCount: summary.sourceRowCount,
        validRowCount: rows.length,
        ignoredRowCount: (summary.errorCount ?? 0) + (summary.ignoredCount ?? 0),
        errorCount: summary.errorCount ?? 0,
        skippedRowCount: summary.ignoredCount ?? 0,
        replacedGroupCount,
        addedGroupCount,
      };
      await db.importBatches.add(savedBatch);

      const storedRows = rows.map((row) => ({
        ...row,
        workspaceId,
        ledgerId,
        batchId,
        importedAt: createdAt,
      }));
      if (rows.length > 0) {
        await db.salesRows.bulkAdd(storedRows);
      }

      const remainingRows = existingRows.filter((row) => !groupKeys.has(row.groupKey));
      const ledgerSummary = summarizeLedgerRows([...remainingRows, ...rows]);
      const savedLedger = {
        ...(existingLedger ?? {
          id: ledgerId,
          workspaceId,
          period: normalizedPeriod,
          type: "monthly_profit",
          currency: "CNY",
          warehouseRate: 0.7,
          createdBy: auditActor,
          createdAt,
        }),
        status: rows.length > 0 ? "cost_pending" : existingLedger?.status ?? "draft",
        updatedAt: createdAt,
        summary: ledgerSummary,
      };
      await db.ledgers.put(savedLedger);

      const persistedRows = rows.length > 0
        ? await db.salesRows.where("batchId").equals(batchId).toArray()
        : [];

      await db.auditEvents.add({
        workspaceId,
        objectType: "sales_import_batch",
        objectId: batchId,
        action: "imported",
        actorId: auditActor,
        createdAt,
        after: {
          ledgerId,
          fileName,
          validRowCount: rows.length,
          replacedGroupCount,
          addedGroupCount,
          snapshot: {
            ...savedBatch,
            importBatch: savedBatch,
            salesRows: encodeSalesRowsAuditSnapshot(persistedRows),
            ledger: savedLedger,
          },
        },
      });
    },
  );

  return { batchId, ledgerId, replacedGroupCount, addedGroupCount };
}

export async function savePublishedErpCostBatch(args) {
  await assertLedgerCostEditingReady(args.ledgerId);
  const inbox = args.inboxId ? await db.erpCostInbox.get(args.inboxId) : null;
  if (inbox?.adoption?.version === ERP_ADOPTION_VERSION) {
    return processErpCostInboxAdoption({ inboxId: inbox.id, resolutions: args.reconciliation?.matches?.flatMap(row => row.resolutions ?? []) ?? [] });
  }
  return publishVerifiedErpCostBatch(args);
}

export async function processErpCostInboxAdoption({ inboxId, resolutions = [] } = {}) {
  if (resolutions.length) {
    const inbox = await db.erpCostInbox.get(inboxId);
    if (inbox) await assertLedgerCostEditingReady(inbox.ledgerId);
  }
  try { return await processErpCostInboxAdoptionOnce({ inboxId, resolutions }); }
  catch (error) {
    if (error.code === 'ERP_COST_REVIEW_NOT_READY') throw error;
    // The cost transaction has rolled back, but the original receipt is durable.
    // Record a separate, deduplicated failure so background retries and the page
    // do not mistake a saved receipt for successful cost adoption.
    try {
      await db.transaction('rw', db.settings, db.erpCostInbox, db.auditEvents, async () => {
        const member = await getActiveMemberContext();
        const inbox = await db.erpCostInbox.get(inboxId);
        if (!inbox || inbox.workspaceId !== member.workspaceId || !['admin', 'finance'].includes(member.role)
          || !['pending', 'loaded'].includes(inbox.status)) return;
        const failure = { name: String(error.name || 'Error').slice(0, 80), message: String(error.message || 'ERP 自动采用失败').slice(0, 500) };
        if (inbox.adoptionFailure?.name === failure.name && inbox.adoptionFailure?.message === failure.message) return;
        const attemptedAt = new Date().toISOString();
        await db.erpCostInbox.update(inboxId, { adoptionPending: false, adoptionFailure: { ...failure, attemptedAt } });
        await db.auditEvents.add({ workspaceId: inbox.workspaceId, objectType: 'erp_cost_inbox', objectId: inbox.id, action: 'adoption_failed', actorId: member.memberId, createdAt: attemptedAt, localOnly: true, syncState: 'local_only',
          after: { requestId: inbox.requestId, batchId: inbox.batchId, failure, systemSource: 'erp-auto-adoption' } });
      });
    } catch { /* A failure to save diagnostics must preserve the original error. */ }
    throw error;
  }
}

function erpAdoptionScopeIssue(inbox, ledger, request, ledgerVersion) {
  if (!ledger || !request || ledger.workspaceId !== inbox.workspaceId || request.workspaceId !== inbox.workspaceId || request.ledgerId !== ledger.id) return 'request_or_ledger_missing';
  if (request.ledgerPeriod && request.ledgerPeriod !== ledger.period) return 'ledger_period_mismatch';
  if (request.ledgerVersion != null && request.ledgerVersion !== ledgerVersion) return 'ledger_import_changed';
  return null;
}

const activeAnomalyReceipt = inbox => ['pending', 'loaded', 'applied'].includes(inbox.status);

async function reusableErpAnomalyIgnores({ inbox, batch, ledger, ledgerVersion, salesRows, resolutions, readScope }) {
  const ignoreIds = recoveryIgnoreIds(readScope, ledger.id);
  if (ignoreIds && !ignoreIds.some(id => id !== inbox.id)) return { resolutions: [], sources: [] };
  const wanted = indexErpAnomalyEvidence(batch, ledger.period);
  for (const [warehouse, evidence] of wanted) {
    const pending = evidence.decision.anomalies.filter(item => {
      const record = evidence.decision.selectedRecords.find(row => row.recordId === item.recordId);
      return !resolutions.some(resolution => normalizedResolution(resolution, warehouse, record));
    });
    if (pending.length) evidence.pending = pending;
    else wanted.delete(warehouse);
  }
  if (!wanted.size) return { resolutions: [], sources: [] };
  const eligible = row => row && row.id !== inbox.id && row.ledgerId === ledger.id && row.workspaceId === ledger.workspaceId
    && activeAnomalyReceipt(row) && row.costResolutions?.some(item => item.action === 'ignore_anomaly');
  const records = ignoreIds ? (await db.erpCostInbox.bulkGet(ignoreIds)).filter(eligible)
    : await db.erpCostInbox.where('ledgerId').equals(ledger.id).filter(eligible).toArray();
  const inherited = [], sources = [];
  for (const source of records) {
    const request = await db.erpCostRequests.get(source.requestId);
    if (erpAdoptionScopeIssue(source, ledger, request, ledgerVersion)) continue;
    let evidence;
    try {
      const read = readAdoptionEvidence(source, ledger, request, salesRows);
      if (read.reason) continue;
      evidence = indexErpAnomalyEvidence(read.batch, ledger.period);
    } catch { continue; } // Unverifiable history cannot authorize a new cost.
    for (const [warehouse, current] of wanted) {
      if (evidence.get(warehouse)?.key !== current.key) continue;
      for (const anomaly of current.pending) {
        if (inherited.some(item => canonicalWarehouseSku(item.warehouseSku) === warehouse && item.recordId === anomaly.recordId)) continue;
        const record = current.decision.selectedRecords.find(row => row.recordId === anomaly.recordId);
        const resolution = source.costResolutions.map(item => normalizedResolution(item, warehouse, record))
          .find(item => item?.action === 'ignore_anomaly');
        if (resolution) {
          inherited.push(resolution);
          sources.push({ inboxId: source.id, warehouseSku: warehouse, recordId: resolution.recordId });
        }
      }
    }
  }
  return { resolutions: inherited, sources };
}

function comparePublishedRows(a, b) {
  return String(a.publishedAt ?? '').localeCompare(String(b.publishedAt ?? '')) || Number(a.id ?? 0) - Number(b.id ?? 0);
}

function setCoverageHead(heads, row, published, period, verifiedCost) {
  const sku = row.canonicalPlatformSku ?? canonicalPlatformSku(row.platformSku);
  const previous = heads.get(sku);
  const identity = { id: row.id, publishedAt: row.publishedAt };
  const first = previous && comparePublishedRows(previous.first, identity) < 0 ? previous.first : identity;
  if (previous && comparePublishedRows(previous, identity) > 0) { previous.first = first; return; }
  // Voiding the newest owned batch still suppresses older prices. Only the
  // winner needs a period check, performed against its original purchase data.
  const cost = published ? verifiedCost ?? projectCoverageCost(row, period) : null;
  heads.set(sku, { ...identity, first, cost });
}

async function previousAdoptionCosts(heads, candidates) {
  const skus = new Set(candidates.map(row => canonicalPlatformSku(row.platformSku)));
  const selected = [...heads.values()].filter(head => head.cost && skus.has(canonicalPlatformSku(head.cost.platformSku)));
  selected.sort((a,b) => comparePublishedRows(a.first, b.first));
  const rows = await db.erpCostRows.bulkGet(selected.map(head => head.id));
  const batches = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.evidenceRef && row.evidenceComplete === true) continue;
    if (!batches.has(row.batchId)) batches.set(row.batchId, await db.erpCostBatches.get(row.batchId));
    rows[i] = projectPublishedCostEvidence(row, batches.get(row.batchId));
  }
  return rows;
}

async function readSingleReceiptCosts(ledger, batchById, scope) {
  const table = db.erpCostRows;
  const ranks = new Map(), selected = new Set();
  // The write transaction owns this index. Use the indexed identity and actual
  // publication order to find every relevant prior cost and every coverage winner.
  const ids = await table.where('ledgerId').equals(ledger.id).primaryKeys();
  if (!ids.every(Number.isSafeInteger)) return null;
  const headers = await readActionHeaderIndex(ledger, ids);
  if (!headers) return null;
  for (const [id, { workspaceId, batchId, platformSku, canonicalSku, publishedAt, sourceBatch }] of headers) {
    if (typeof platformSku !== 'string' || !platformSku.trim() || !canonicalSku) return null;
    if (scope.sourceBatch === sourceBatch || scope.skus.has(canonicalPlatformSku(platformSku))) selected.add(id);
    const batch = batchById.get(batchId);
    if (!batch || workspaceId && workspaceId !== ledger.workspaceId || batch.workspaceId && batch.workspaceId !== ledger.workspaceId) continue;
    const row = {id, publishedAt};
    const rank = ranks.get(canonicalSku);
    if (!rank) ranks.set(canonicalSku, { first: row, latest: row, published: batch.status === 'published' });
    else {
      if (comparePublishedRows(row, rank.first) < 0) rank.first = row;
      if (comparePublishedRows(row, rank.latest) > 0) { rank.latest = row; rank.published = batch.status === 'published'; }
    }
  }
  const resolved = await table.where('[ledgerId+resolutions.length]').between([ledger.id,0], [ledger.id,Dexie.maxKey], false, true).primaryKeys();
  const needed = new Set(resolved.filter(id => selected.has(id)));
  for (const {latest, published} of ranks.values()) if (published) needed.add(latest.id);
  const facts = await readActionCostFacts(ledger, [...needed].sort((a,b) => a-b));
  if (facts.size !== needed.size) return null;
  const coverageHeads = new Map();
  for (const [sku, {latest, first, published}] of ranks) {
    coverageHeads.set(sku, { ...latest, first, cost: published ? facts.get(latest.id).coverage : null });
  }
  const costHeaders = [...selected].sort((a,b) => a-b).map(id => {
    if (facts.has(id)) return facts.get(id).header;
    // A superseded cost without decisions needs just its indexed identity and
    // source order for this ignore. Its purchase details never enter coverage.
    const {workspaceId,batchId,platformSku,warehouseSku,sourceOrder,sourceBatch} = headers.get(id);
    return {id,workspaceId,batchId,platformSku,warehouseSku,sourceOrder,sourceEnvelopeBatchId:sourceBatch};
  });
  return { coverageHeads, costHeaders };
}

async function readAdoptionBatchHeaders(ledgerId, { indexed = false, appliedBatchId } = {}) {
  const table = db.erpCostBatches, headers = new Map();
  const owner = table.where('ledgerId').equals(ledgerId);
  if (!indexed) {
    await owner.each(row => { headers.set(row.id, adoptionBatchHeader(row)); });
    return headers;
  }
  const [ids] = await Promise.all([owner.primaryKeys(), table.where('[ledgerId+workspaceId+status+publishedAt+sourceOrder]')
    .between([ledgerId, Dexie.minKey], [ledgerId, Dexie.maxKey]).eachKey(([,workspaceId,status,publishedAt,sourceOrder], cursor) => {
      headers.set(cursor.primaryKey, {workspaceId, status, publishedAt, sourceOrder});
    })]);
  // The active receipt also needs its full adoption state. Sparse legacy
  // batches are read from the original table to retain their metadata.
  const missing = ids.filter(id => !headers.has(id) || id === appliedBatchId);
  for (const id of missing) {
    const batch = await table.get(id);
    if (batch) headers.set(id, adoptionBatchHeader(batch));
  }
  return headers;
}

async function readAdoptionLedgerInputs(ledger, needsImportDates, readScope, prepareCoverage, actionSales, singleReceiptScope) {
  const ledgerId = ledger.id;
  const key = JSON.stringify([ledgerId, needsImportDates, sourceRevision()]);
  if (readScope?.adoptionInputs?.key === key) return readScope.adoptionInputs.value;
  if (readScope && !needsImportDates) {
    const checked = await readRecoveryAdoptionInputs(readScope, ledgerId);
    if (checked) {
      readScope.adoptionInputs = { key, value: checked };
      return checked;
    }
  }
  const salesByIdentity = new Map(), costHeaders = [];
  const coverageHeads = prepareCoverage ? new Map() : null;
  const [approvals, batchById] = await Promise.all([
    db.costApprovals.where('ledgerId').equals(ledgerId).toArray(),
    readAdoptionBatchHeaders(ledgerId, { indexed: Boolean(singleReceiptScope), appliedBatchId: singleReceiptScope?.appliedBatchId }),
    actionSales ? null : forEachLedgerChunk(db.salesRows, ledgerId, 1000, row => {
      const { workspaceId, store, platformSku, sku, platformSkc } = row;
      const identity = { workspaceId, ledgerId, store, platformSku, sku, platformSkc };
      if (needsImportDates) identity.importedAt = row.importedAt;
      salesByIdentity.set(JSON.stringify(identity), identity);
    }),
  ]);
  if (singleReceiptScope && actionSales && prepareCoverage) {
    const scoped = await readSingleReceiptCosts(ledger, batchById, singleReceiptScope);
    if (scoped) return { salesRows: actionSales, approvals, batchById, ...scoped };
  }
  function collect(row, header, verifiedCost) {
    costHeaders.push(header);
    const batch = batchById.get(row.batchId);
    if (coverageHeads && batch && (!row.workspaceId || row.workspaceId === ledger.workspaceId) && (!batch.workspaceId || batch.workspaceId === ledger.workspaceId)) {
      setCoverageHead(coverageHeads, row, batch.status === 'published', ledger.period, verifiedCost);
    }
  }
  if (actionSales && prepareCoverage) {
    await readActionCostRows(ledger, ({header, canonicalPlatformSku, publishedAt, coverage}) =>
      collect({...header,canonicalPlatformSku,publishedAt}, header, coverage));
  } else {
    await forEachLedgerChunk(db.erpCostRows, ledgerId, 16, row => collect(row, adoptionCostHeader(row)), { newestFirst: true });
  }
  costHeaders.reverse(); // Retain the original primary-key order for legacy resolutions.
  const value = { salesRows: actionSales ?? [...salesByIdentity.values()], approvals, batchById, costHeaders, coverageHeads };
  if (readScope && key === JSON.stringify([ledgerId, needsImportDates, sourceRevision()])) readScope.adoptionInputs = { key, value };
  return value;
}

async function processErpCostInboxAdoptionOnce({ inboxId, resolutions, ignoreAction = null, inspectOnly = false, readScope = null, actionInputs = null }) {
  const member = await getActiveMemberContext();
  return db.transaction(inspectOnly ? 'r' : 'rw', db.settings, db.ledgers, db.importBatches, db.salesRows, db.erpCostRequests, db.erpCostInbox, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.auditEvents, async () => {
    const inbox = await db.erpCostInbox.get(inboxId);
    if (!inbox || inbox.workspaceId !== member.workspaceId) throw new Error('ERP 收件不属于当前工作区。');
    // Recheck the current identity inside the transaction, including the same
    // local default used elsewhere when no explicit member setting is stored.
    const active = await getActiveMemberContext();
    if (active.workspaceId !== member.workspaceId || !['admin', 'finance'].includes(active.role)) throw new Error('当前成员无此账本的财务写权限。');
    if (['rejected', 'voided'].includes(inbox.status) || inbox.status === 'applied' && !ignoreAction) return { id: inbox.id, inboxId: inbox.id, batchId: inbox.appliedBatchId, status: inbox.status, adoption: inbox.adoption, idempotent: true };
    const ledger = operatingLedger(await db.ledgers.get(inbox.ledgerId)), request = await db.erpCostRequests.get(inbox.requestId);
    if (ledger && resolutions.length) await assertCachedLedgerCostEditingReady(ledger);
    const now = new Date().toISOString();
    let costResolutions = inbox.costResolutions ?? [];
    const persistResult = async (items, state, reason = null, batchId = inbox.appliedBatchId) => {
      const summary = summarizeErpAdoption(items);
      const adoption = { version: ERP_ADOPTION_VERSION, state, items, summary, reason };
      const changed = Boolean(inbox.adoptionPending || inbox.adoptionFailure)
        || JSON.stringify(inbox.costResolutions ?? []) !== JSON.stringify(costResolutions)
        || JSON.stringify(inbox.adoption && { ...inbox.adoption, processedAt: undefined }) !== JSON.stringify(adoption);
      if (changed && inspectOnly) return { needsWrite: true };
      if (changed) {
        const saved = { ...inbox, ...(batchId ? { appliedBatchId: batchId } : {}), ...(costResolutions.length || inbox.costResolutions ? { costResolutions } : {}), status: state === 'applied' ? 'applied' : inbox.status, adoptionPending: false, adoptionFailure: null, adoption: { ...adoption, processedAt: now }, updatedAt: now };
        await db.erpCostInbox.put(saved);
        await db.auditEvents.add({ workspaceId: inbox.workspaceId, objectType: 'erp_cost_inbox', objectId: inbox.id, action: 'adoption_processed', actorId: member.memberId, createdAt: now, before: { adoption: inbox.adoption ?? null }, after: { adoption, costResolutions, requestId: inbox.requestId, batchId: inbox.batchId, adoptionMethod: resolutions.length ? 'exception_retry' : 'automatic', systemSource: 'erp-auto-adoption', snapshot: saved } });
      }
      return { id: inbox.id, inboxId: inbox.id, batchId, status: state === 'applied' ? 'applied' : inbox.status, adoption: { ...adoption, processedAt: changed ? now : inbox.adoption?.processedAt }, ...summary, matchedCount: summary.adoptedCount, idempotent: !changed };
    };
    const ledgerVersion = ledger ? erpLedgerVersion(await db.importBatches.where('ledgerId').equals(ledger.id).toArray()) : null;
    const scopeIssue = erpAdoptionScopeIssue(inbox, ledger, request, ledgerVersion);
    if (scopeIssue) return persistResult([], 'blocked', scopeIssue);
    let inputs = actionInputs?.current;
    if (!inputs) {
      const actionSales = ignoreAction ? await readCostSaleIdentities(ledger, !request.expectedSkus?.length || actionInputs?.legacy) : null;
      const wanted = actionInputs?.singleReceipt && uncoveredAnomalySkus(inbox, request, new Set());
      inputs = await readAdoptionLedgerInputs(ledger, !request.expectedSkus?.length, inspectOnly ? readScope : null,
        ignoreAction ? ignoreAction.action === 'ignore' : !inspectOnly && !inbox.appliedBatchId, actionSales,
        wanted?.length ? { skus: new Set(wanted), sourceBatch: inbox.batchId, appliedBatchId: inbox.appliedBatchId } : null);
      if (actionInputs) actionInputs.current = inputs;
    }
    const { salesRows, approvals, batchById, costHeaders, coverageHeads } = inputs;
    const ownedSales = salesRows.filter(row => row.workspaceId === ledger.workspaceId);
    const identities = buildLedgerSkuIdentityIndex(ownedSales);
    const { validated, batch, expected, reason } = readAdoptionEvidence(inbox, ledger, request, ownedSales);
    if (reason) return persistResult([], 'blocked', reason);
    const boundary = erpBatchAdoptionBoundary(batch);
    const expectedSkuKeys = new Set(expected.map(row => canonicalPlatformSku(row.platformSku)));
    const allRows = costHeaders.filter(row => {
      if (row.sourceEnvelopeBatchId === batch.batchId || !row.platformSku) return true;
      try { return expectedSkuKeys.has(canonicalPlatformSku(row.platformSku)); }
      catch { return true; } // Preserve the existing handling of malformed historical rows.
    });
    const order = erpSourceOrder(request, batch);
    let existingRows = allRows.filter(row => row.sourceEnvelopeBatchId === batch.batchId && batchById.get(row.batchId)?.status === 'published');
    if (inbox.appliedBatchId && batchById.get(inbox.appliedBatchId)?.status !== 'published') throw new Error('已采用成本批次关联失效，请核对历史记录。');
    let mergedResolutions = [...existingRows.flatMap(row => row.resolutions ?? []), ...costResolutions, ...resolutions].reduce(upsertCostResolution, []);
    const reused = !ignoreAction && !boundary.globalReasons.length
      ? await reusableErpAnomalyIgnores({ inbox, batch, ledger, ledgerVersion, salesRows: ownedSales, resolutions: mergedResolutions, readScope: inspectOnly ? readScope : null })
      : { resolutions: [], sources: [] };
    if (reused.resolutions.length) mergedResolutions = [...reused.resolutions, ...mergedResolutions].reduce(upsertCostResolution, []);
    if (ignoreAction) {
      const selectedWarehouses = ignoreAction.warehouseSkus ? new Set(ignoreAction.warehouseSkus.map(canonicalWarehouseSku)) : null;
      const inScope = item => selectedWarehouses ? selectedWarehouses.has(canonicalWarehouseSku(item.warehouseSku))
        : !ignoreAction.warehouseSku || canonicalWarehouseSku(item.warehouseSku) === canonicalWarehouseSku(ignoreAction.warehouseSku);
      const before = mergedResolutions;
      if (ignoreAction.action === 'revoke') {
        mergedResolutions = before.filter(item => item.action !== 'ignore_anomaly' || !inScope(item));
      } else {
        const preview = reconcileErpCostRows({ workspaceId: ledger.workspaceId, period: ledger.period, expectedSkus: expected, costRows: validated.rows, resolutions: before });
        const ignores = preview.matches.flatMap(row => row.costDecision?.anomalies ?? [])
          .filter(item => ignorableErpPriceAnomaly(item) && inScope(item))
          .map(item => ({ warehouseSku: item.warehouseSku, recordId: item.recordId, action: 'ignore_anomaly', originalUnitPrice: item.originalUnitPrice,
            resolvedUnitPrice: item.originalUnitPrice, reason: '用户忽略异常，保留原价参与核算', resolvedBy: member.memberId, resolvedAt: now }));
        mergedResolutions = ignores.reduce(upsertCostResolution, before);
      }
      if (JSON.stringify(before) === JSON.stringify(mergedResolutions)) return { inboxId, idempotent: true, changedCount: 0 };
      const retained = new Set(mergedResolutions.map(item => JSON.stringify([item.warehouseSku, item.recordId, item.action])));
      const removed = before.filter(item => !retained.has(JSON.stringify([item.warehouseSku, item.recordId, item.action])));
      const affected = existingRows.filter(row => removed.some(item => canonicalWarehouseSku(item.warehouseSku) === canonicalWarehouseSku(row.warehouseSku)));
      // Only this receipt's derived costs are withdrawn. The immutable receipt,
      // other sources, manual overrides and frozen reports remain untouched.
      if (affected.length) await db.erpCostRows.bulkDelete(affected.map(row => row.id));
      existingRows = existingRows.filter(row => !affected.includes(row));
      costResolutions = mergedResolutions;
      inbox.status = 'pending';
      inbox.adoptionPending = true;
      await db.erpCostInbox.update(inboxId, { status: 'pending', costResolutions, adoptionPending: true });
      await db.auditEvents.add({ workspaceId: ledger.workspaceId, objectType: 'erp_cost_inbox', objectId: inboxId,
        action: ignoreAction.action === 'revoke' ? 'anomaly_ignore_revoked' : 'anomalies_ignored', actorId: member.memberId, createdAt: now,
        before: { costResolutions: before, withdrawnRows: affected }, after: { costResolutions } });
    }
    const reconciliation = reconcileErpCostRows({ workspaceId: ledger.workspaceId, period: ledger.period, expectedSkus: expected, costRows: validated.rows, resolutions: mergedResolutions });
    const verifiedResolutions = reconciliation.matches.flatMap(row => row.resolutions ?? []).reduce(upsertCostResolution, []);
    const sameResolution = (left, right) => canonicalWarehouseSku(left.warehouseSku) === canonicalWarehouseSku(right.warehouseSku)
      && left.recordId === right.recordId && left.action === right.action
      && left.originalUnitPrice === right.originalUnitPrice && left.resolvedUnitPrice === right.resolvedUnitPrice;
    for (const resolution of resolutions) {
      if (!verifiedResolutions.some(verified => sameResolution(verified, resolution))) throw new Error('采购核价与本批原始记录不一致，请重新查看采购证据。');
      const adopted = existingRows.find(row => canonicalWarehouseSku(row.sourceWarehouseSku ?? row.warehouseSku) === canonicalWarehouseSku(resolution.warehouseSku));
      if (adopted && !(adopted.resolutions ?? []).some(verified => sameResolution(verified, resolution))) throw new Error('本笔采购已用于正式成本，请使用人工更正调整。');
    }
    costResolutions = verifiedResolutions;
    if (reused.resolutions.length) {
      if (inspectOnly) return { needsWrite: true };
      await db.auditEvents.add({ workspaceId: ledger.workspaceId, objectType: 'erp_cost_inbox', objectId: inbox.id,
        action: 'anomaly_ignores_reused', actorId: member.memberId, createdAt: now,
        after: { ledgerId: ledger.id, batchId: inbox.batchId, sources: reused.sources, resolutionCount: reused.resolutions.length } });
    }
    const storesBySku = new Map(), manualFor = createManualOverrideLookup(accountingApprovals(approvals));
    for (const sale of ownedSales) {
      if (!sale.platformSkc) continue;
      const sku = canonicalPlatformSku(sale.platformSku ?? sale.sku), skc = canonicalPlatformSkc(sale.platformSkc);
      if (!storesBySku.has(sku)) storesBySku.set(sku, new Map());
      const pairs = storesBySku.get(sku);
      if (!pairs.has(skc)) pairs.set(skc, new Set());
      pairs.get(skc).add(storeIdentity(sale.store));
    }
    const candidates = [], items = [];
    for (const row of reconciliation.matches) {
      const sku = canonicalPlatformSku(row.platformSku);
      const item = { platformSku: row.platformSku, canonicalPlatformSku: sku };
      const stores = [...(storesBySku.get(sku)?.get(canonicalPlatformSkc(row.platformSkc)) ?? [])];
      const manualStores = stores.filter(store => manualFor({ workspaceId: ledger.workspaceId, ledgerId: ledger.id, store, platformSku: sku }));
      item.manualStores = manualStores;
      const previous = existingRows.find(cost => canonicalPlatformSku(cost.platformSku) === sku);
      if (previous) { items.push({ ...item, state: manualStores.length ? 'manual_effective' : 'adopted', costRowId: previous.id }); continue; }
      const identityIssue = ledgerCostIdentityIssue(identities.get(sku), row, { requireSkc: true });
      if (identityIssue) { items.push({ ...item, state: 'evidence_incomplete', reason: identityIssue.code, identityIssue }); continue; }
      if (!stores.length) { items.push({ ...item, state: 'evidence_incomplete', reason: 'sku_not_in_ledger' }); continue; }
      if (boundary.globalReasons.length) { items.push({ ...item, state: 'evidence_incomplete', reason: boundary.globalReasons.join(',') }); continue; }
      const newer = allRows.some(cost => cost.workspaceId === ledger.workspaceId && canonicalPlatformSku(cost.platformSku) === sku && cost.sourceEnvelopeBatchId !== batch.batchId && compareErpSourceOrder(cost.sourceOrder ?? batchById.get(cost.batchId)?.sourceOrder ?? [Date.parse(batchById.get(cost.batchId)?.publishedAt) || 0, 0, cost.batchId], order) > 0);
      if (newer) { items.push({ ...item, state: 'superseded', reason: 'newer_source_exists' }); continue; }
      if (boundary.blockedSkus.has(sku) || (row.sourceWarehouseSku && boundary.blockedWarehouses.has(canonicalWarehouseSku(row.sourceWarehouseSku))) || (row.status !== 'missing' && !row.evidenceComplete)) { items.push({ ...item, state: 'evidence_incomplete', reason: 'item_evidence_incomplete' }); continue; }
      if (row.status !== 'matched') { items.push({ ...item, state: row.status === 'missing' ? 'missing' : 'anomaly_pending', reason: row.status }); continue; }
      candidates.push(row); items.push({ ...item, state: manualStores.length ? 'manual_effective' : 'adopted' });
    }
    let appliedBatchId = inbox.appliedBatchId;
    if (candidates.length) {
      if (inspectOnly) return { needsWrite: true };
      const candidateSkus = new Set(candidates.map(row => canonicalPlatformSku(row.platformSku)));
      const previousCosts = coverageHeads ? await previousAdoptionCosts(coverageHeads, candidates)
        : (await getLatestLedgerCosts(ledger.id)).filter(cost => candidateSkus.has(canonicalPlatformSku(cost.platformSku)));
      const saved = await publishVerifiedErpCostBatch({ ledgerId: ledger.id, workspaceId: ledger.workspaceId, requestId: request.id, sourceEnvelope: batch, inboxId: inbox.id, sourceName: 'ERP 自动回传', reconciliation: { ...reconciliation, matches: candidates }, adoptionContext: { batchId: appliedBatchId, sourceOrder: order, method: resolutions.length ? 'exception_retry' : 'automatic', previousCosts } },
        { transaction: Dexie.currentTransaction, ledgerId: ledger.id, workspaceId: ledger.workspaceId, salesRows, coverageHeads, actionInputs });
      appliedBatchId = saved.batchId;
      for (const item of items) if (['adopted', 'manual_effective'].includes(item.state)) item.costRowId = saved.rowIds.get(item.canonicalPlatformSku);
    }
    const summary = summarizeErpAdoption(items);
    const state = summary.remainingCount === 0 && items.length ? 'applied' : summary.adoptedCount ? 'partial' : summary.protectedCount ? 'protected' : boundary.globalReasons.length ? 'blocked' : 'pending';
    const result = await persistResult(items, state, boundary.globalReasons.join(',') || null, appliedBatchId);
    if (result.needsWrite) return result;
    // Pending exceptions are checked again while the app is idle. Rewriting an
    // identical adoption invalidates every finance-derived live reader and
    // repeatedly clones/recomputes the complete reference evidence. Keep the
    // batch metadata aligned, including legacy missing metadata, only on change.
    if (appliedBatchId && JSON.stringify(batchById.get(appliedBatchId)?.adoption) !== JSON.stringify(result.adoption)) {
      if (inspectOnly) return { needsWrite: true };
      await db.erpCostBatches.update(appliedBatchId, { adoption: result.adoption });
    }
    if (ignoreAction && (!candidates.length || !coverageHeads)) {
      const coverage = coverageHeads ? calculateLedgerCostCoverage({ salesRows, approvals, workspaceId: ledger.workspaceId, ledgerId: ledger.id, period: ledger.period,
        erpCosts: [...coverageHeads.values()].flatMap(head => head.cost ? [head.cost] : []) }, cost => cost.withinPeriod) : await readLedgerCostCoverage(ledger.id, { ledger, salesRows });
      await db.ledgers.update(ledger.id, buildLedgerCoveragePatch(ledger, coverage, now));
    }
    return result;
  });
}

const anomalySourceTables = ['settings', 'ledgers', 'importBatches', 'salesRows', 'erpCostRequests', 'erpCostInbox', 'erpCostBatches', 'erpCostRows', 'costApprovals'];
let activeProfitReads = 0;
async function withProfitRead(read) {
  activeProfitReads++;
  try { return await read(); }
  finally { activeProfitReads--; }
}
const anomalySourceReaders = anomalySourceTables.map(tableRevisionReader);
function anomalyReviewRevision() {
  const revisions = anomalySourceReaders.map(read => read());
  return revisions.every(Boolean) ? JSON.stringify(revisions) : sourceRevision();
}

const reviewedReceipts = new Map();
async function readAnomalyReview(ledger, suppliedInboxes, { signal, onProgress, warehouseSku } = {}) {
  signal?.throwIfAborted();
  const headers = suppliedInboxes ?? await listErpCostInbox({ ledgerId: ledger.id, statuses: ['pending', 'loaded', 'applied', 'rejected', 'voided'], displayOnly: true });
  const active = headers.filter(inbox => inbox.ledgerId === ledger.id && inbox.workspaceId === ledger.workspaceId && activeAnomalyReceipt(inbox));
  const review = createAnomalyReview();
  if (!active.length) return review.result();
  const requests = await db.erpCostRequests.bulkGet([...new Set(active.map(inbox => inbox.requestId))]);
  const byId = new Map(requests.filter(Boolean).map(request => [request.id, request]));
  const ledgerVersion = requests.some(request => request?.ledgerVersion != null)
    ? erpLedgerVersion(await db.importBatches.where('ledgerId').equals(ledger.id).toArray()) : null;
  const candidates = active.filter(inbox => !erpAdoptionScopeIssue(inbox, ledger, byId.get(inbox.requestId), ledgerVersion));
  if (!candidates.length) return review.result();

  // A warehouse can serve several platform SKUs across receipts. Include all
  // of them, then let newer validated queries supersede each SKU as usual.
  // Older request formats can lack these mappings and use the full review.
  let targetSkus = null;
  if (warehouseSku && candidates.every(header => byId.get(header.requestId).expectedSkus?.length)) {
    const warehouse = canonicalWarehouseSku(warehouseSku);
    targetSkus = new Set();
    function includeRows(rows) {
      for (const row of rows) {
        if (row.warehouseSku && canonicalWarehouseSku(row.warehouseSku) === warehouse && row.platformSku) targetSkus.add(canonicalPlatformSku(row.platformSku));
      }
    }
    for (const requestId of new Set(candidates.map(header => header.requestId))) includeRows(byId.get(requestId).expectedSkus);
    for (const header of candidates) includeRows(header.envelope?.batch?.rows ?? []);
    if (!targetSkus.size) targetSkus = null;
  }
  const sales = [];
  if (candidates.some(inbox => !byId.get(inbox.requestId).expectedSkus?.length)) {
    await forEachLedgerChunk(db.salesRows, ledger.id, 1000, ({ workspaceId, platformSku, platformSkc, importedAt }) => {
      if (workspaceId === ledger.workspaceId) sales.push({ workspaceId, platformSku, platformSkc, importedAt });
    });
  }
  const cached = recentResolutionIndex;
  let index = !Dexie.currentTransaction && cached?.workspaceId === ledger.workspaceId && cached.ledgerId === ledger.id && cached.revision === publishedCostRevision()
    ? cached.value : (await scanProfitPageCosts(ledger, false)).resolutionIndex;
  const published = new Set(index.publishedIds), sources = new Set(candidates.map(inbox => inbox.batchId));
  async function readResolutions() {
    if (index.unchecked?.length) {
      const partial = index, revision = publishedCostRevision();
      index = signal ? await completeProfitResolutionIndex(ledger, partial, signal)
        : await cachedDerived({scope:[ledger.workspaceId,ledger.id], formula:'profit-page-resolutions@1', revisionReader:publishedCostRevision, revision,
          compute:() => completeProfitResolutionIndex(ledger, partial)});
      signal?.throwIfAborted();
      assertSourceRevision(revision, publishedCostRevision);
      recentResolutionIndex = {workspaceId:ledger.workspaceId, ledgerId:ledger.id, revision, value:index};
    }
    const result = new Map(), batches = new Map();
    for (const row of index.resolutions) {
      if (!sources.has(row.sourceEnvelopeBatchId)) continue;
      if (!batches.has(row.batchId)) batches.set(row.batchId, (await db.erpCostBatches.get(row.batchId))?.sourceContract?.batchId);
      const owner = batches.get(row.batchId);
      if (owner && !sources.has(owner)) continue;
      if (!result.has(row.sourceEnvelopeBatchId)) result.set(row.sourceEnvelopeBatchId, []);
      result.get(row.sourceEnvelopeBatchId).push(...row.resolutions);
    }
    return result;
  }
  const context = { id: ledger.id, workspaceId: ledger.workspaceId, period: ledger.period };
  const ordered = newestAnomalyReceipts(candidates.map(inbox => ({ inbox, request: byId.get(inbox.requestId) })));
  let resolutions;
  async function check({header, request, wanted, alreadyCovered}, decisions) {
    signal?.throwIfAborted();
    const version = header.displayOnly && !Dexie.currentTransaction && inboxRowVersion(header.id);
    const requestVersion = tableRevisionReader('erpCostRequests')();
    const salesVersion = request.expectedSkus?.length ? true : tableRevisionReader('salesRows')();
    const key = version && requestVersion && salesVersion && JSON.stringify([version, requestVersion, salesVersion, context,
      header.batchId, request.id, wanted, alreadyCovered, decisions?.get(header.batchId) ?? []]);
    const cached = reviewedReceipts.get(header.id);
    if (key && cached?.key === key) return cached.checked;
    const original = header.displayOnly ? await db.erpCostInbox.get(header.id) : header;
    if (!original || original.batchId !== header.batchId || original.requestId !== request.id || original.ledgerId !== ledger.id
      || original.workspaceId !== ledger.workspaceId || !activeAnomalyReceipt(original)) return null;
    const input = { ledger: context, request, inbox: { id: original.id, requestId: original.requestId, batchId: original.batchId, envelope: original.envelope },
      resolutions: [...(decisions?.get(original.batchId) ?? []), ...(original.costResolutions ?? [])],
      sales: request.expectedSkus?.length ? [] : sales, wanted, alreadyCovered };
    const checked = Dexie.currentTransaction ? reviewErpAnomalyReceipt(input) : await runDerivedComputation('erp-anomaly-receipt', input, {signal});
    if (key && checked && inboxRowVersion(header.id) === version && !signal?.aborted) {
      reviewedReceipts.set(header.id, { key, checked });
      if (reviewedReceipts.size > 100) reviewedReceipts.delete(reviewedReceipts.keys().next().value);
    }
    return checked;
  }
  const pieces = [];
  let delivered = 0;
  async function appendReady() {
    if (!resolutions) return;
    let changed = false;
    while (delivered < pieces.length) {
      const {part,checked,usedHistory} = pieces[delivered++];
      const final = !usedHistory && resolutions.has(part.header.batchId) ? await check(part,resolutions) : checked;
      review.append(final);
      changed ||= Boolean(final?.items.length);
    }
    if (changed && onProgress) {
      signal?.throwIfAborted();
      const view = review.result();
      onProgress({pending: [...view.pending], ignored: view.ignored});
    }
  }
  async function checkReceipts() {
    const covered = new Set();
    for (const { inbox: header, request } of ordered) {
      signal?.throwIfAborted();
      if (header.appliedBatchId && !published.has(header.appliedBatchId)) throw new Error('已采用成本批次关联失效，请核对历史记录。');
      let wanted = uncoveredAnomalySkus(header, request, covered);
      if (targetSkus && wanted) wanted = wanted.filter(sku => targetSkus.has(sku));
      if (wanted?.length === 0) continue;
      const part = {header,request,wanted,alreadyCovered:wanted ? [] : [...covered]}, decisions = resolutions;
      const checked = await check(part,decisions);
      if (!checked) continue;
      // Coverage comes solely from the validated query, independently of price
      // decisions. Keep only its small result, never an entire set of envelopes.
      for (const sku of checked.skus) covered.add(sku);
      pieces.push({part,checked,usedHistory:Boolean(decisions)});
      await appendReady();
    }
  }
  if (index.unchecked?.length && !Dexie.currentTransaction) {
    await Promise.all([readResolutions().then(value=>{resolutions=value;}),checkReceipts()]);
  } else { resolutions = await readResolutions(); await checkReceipts(); }
  await appendReady();
  const result = review.result();
  if (warehouseSku) result.noPriorIgnores = !active.some(row => row.costResolutions?.some(item => item.action === 'ignore_anomaly'))
    && !index.resolutions.some(row => row.resolutions.some(item => item.action === 'ignore_anomaly'));
  return result;
}

export async function listErpCostAnomalyReview(ledgerId, suppliedInboxes, options = {}) {
  if (suppliedInboxes?.length === 0) return { pending: [], ignored: [] };
  const supplied = suppliedInboxes?.some(inbox => inbox.displayOnly) ? undefined : suppliedInboxes;
  return withProfitRead(() => retrySourceRead(async () => {
    if (!Dexie.currentTransaction) await Promise.all(anomalySourceTables.flatMap(table => [db.table(table).count(), observeTableRevision(table)]));
    const revision = anomalyReviewRevision();
    const member = await getActiveMemberContext(), ledger = await db.ledgers.get(ledgerId);
    if (!ledger || ledger.workspaceId !== member.workspaceId) return { pending: [], ignored: [] };
    if (Dexie.currentTransaction) return readAnomalyReview(ledger, supplied, options);
    if (supplied || options.signal || options.onProgress || options.warehouseSku) {
      const result = await readAnomalyReview(ledger, supplied, options);
      assertSourceRevision(revision, anomalyReviewRevision);
      return options.warehouseSku ? { ...result, revision } : result;
    }
    return cachedDerived({ scope: [member.workspaceId, ledger.id, member.memberId, member.role], formula: 'erp-anomaly-review@1',
      revisionReader: anomalyReviewRevision, revision, compute: () => readAnomalyReview(ledger) });
  }));
}

export async function listPendingErpCostAnomalies(ledgerId, suppliedInboxes) {
  return (await listErpCostAnomalyReview(ledgerId, suppliedInboxes)).pending;
}

export async function listIgnoredErpCostAnomalies(ledgerId) {
  return (await listErpCostAnomalyReview(ledgerId)).ignored;
}

// One user action covers the month. Each affected receipt is revalidated in
// the same transaction, so a failure cannot leave a half-revoked cost state.
export async function setErpCostAnomaliesIgnored({ ledgerId, ignored = true, inboxId = null, warehouseSku = null, selectedItems, expectedReviewRevision } = {}) {
  await assertLedgerCostEditingReady(ledgerId);
  return db.transaction('rw', db.settings, db.ledgers, db.importBatches, db.salesRows, db.erpCostRequests, db.erpCostInbox, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.auditEvents, async () => {
    const member = await getActiveMemberContext();
    const ledger = await db.ledgers.get(ledgerId);
    if (!ledger || ledger.workspaceId !== member.workspaceId || !['admin', 'finance'].includes(member.role)) throw new Error('当前成员无此账本的财务写权限。');
    await assertCachedLedgerCostEditingReady(ledger);
    if (expectedReviewRevision && anomalyReviewRevision() !== expectedReviewRevision) throw new Error('采购记录已变化，请查看最新价格后再处理。');
    // Current ledgers remain editable, including legacy finalized/locked data.
    // Saved report files are separate immutable snapshots, never rewritten here.
    if (selectedItems !== undefined && (!Array.isArray(selectedItems) || inboxId || warehouseSku)) throw new Error('异常选择范围无效，请重新选择。');
    const ids = ignored && (selectedItems !== undefined ? [...new Set(selectedItems.map(item => item?.inboxId))] : inboxId ? [inboxId] : null);
    if (ids && ids.some(id => !id)) throw new Error('异常选择范围无效，请重新选择。');
    const ownedReceipts = (ids ? await db.erpCostInbox.bulkGet(ids) : await db.erpCostInbox.where('ledgerId').equals(ledgerId).toArray())
      .filter(row => row && row.ledgerId === ledgerId && row.workspaceId === member.workspaceId && activeAnomalyReceipt(row));
    let receipts = ownedReceipts.filter(row => !inboxId || row.id === inboxId);
    // An explicit empty selection means no action, never the whole month.
    // Validate every selected receipt before changing any costs; one selection
    // may span several receipts and several warehouse products in one receipt.
    let selection = null;
    if (selectedItems !== undefined) {
      selection = new Map();
      const receiptById = new Map(receipts.map(row => [row.id, row]));
      for (const item of selectedItems) {
        const receipt = receiptById.get(item?.inboxId);
        if (!receipt || !String(item?.warehouseSku ?? '').trim()) throw new Error('所选异常不属于当前账本或已经失效，请刷新后重选。');
        if (!selection.has(receipt.id)) selection.set(receipt.id, new Set());
        selection.get(receipt.id).add(canonicalWarehouseSku(item.warehouseSku));
      }
      for (const [id, warehouses] of selection) {
        const receipt = receiptById.get(id);
        const candidates = [...(receipt.envelope?.batch?.rows ?? []), ...(receipt.costResolutions ?? [])];
        const known = new Set(candidates.filter(row => row.warehouseSku).map(row => canonicalWarehouseSku(row.warehouseSku)));
        for (const sku of warehouses) if (!known.has(sku)) throw new Error('所选商品不属于当前回传，请刷新后重选。');
        const checked = selectedItems.filter(item => item.inboxId === id && item.evidenceKey);
        if (checked.length) {
          const evidence = indexErpAnomalyEvidence(receipt.envelope?.batch, ledger.period, warehouses);
          if (checked.some(item => evidence.get(canonicalWarehouseSku(item.warehouseSku))?.key !== item.evidenceKey)) throw new Error('采购证据已变化，请核对最新采购价。');
        }
      }
    }
    if (!ignored) {
      // Revoke the decision for all identical evidence copies; otherwise an
      // older ignored copy could immediately re-authorize the current receipt.
      selection ??= new Map(receipts.map(row => [row.id, new Set((row.costResolutions ?? [])
        .filter(item => item.action === 'ignore_anomaly' && (!warehouseSku || canonicalWarehouseSku(item.warehouseSku) === canonicalWarehouseSku(warehouseSku)))
        .map(item => canonicalWarehouseSku(item.warehouseSku)))]));
      const keys = new Set(), indices = new Map();
      for (const receipt of ownedReceipts) {
        try { indices.set(receipt.id, indexErpAnomalyEvidence(receipt.envelope.batch, ledger.period)); }
        catch { continue; }
        for (const warehouse of selection.get(receipt.id) ?? []) {
          const key = indices.get(receipt.id).get(warehouse)?.key;
          if (key) keys.add(key);
        }
      }
      for (const receipt of ownedReceipts) {
        for (const resolution of receipt.costResolutions ?? []) {
          const warehouse = canonicalWarehouseSku(resolution.warehouseSku);
          if (resolution.action !== 'ignore_anomaly' || !keys.has(indices.get(receipt.id)?.get(warehouse)?.key)) continue;
          if (!selection.has(receipt.id)) selection.set(receipt.id, new Set());
          selection.get(receipt.id).add(warehouse);
        }
      }
      receipts = ownedReceipts;
    }
    const targets = receipts.filter(row => !selection || selection.has(row.id));
    const requests = await db.erpCostRequests.bulkGet([...new Set(targets.map(row => row.requestId))]);
    const actionInputs = ignored ? { current: null, singleReceipt: targets.length === 1, legacy: requests.some(request => !request?.expectedSkus?.length) } : null;
    const results = [];
    for (const row of targets) {
      results.push(await processErpCostInboxAdoptionOnce({ inboxId: row.id, resolutions: [], actionInputs, ignoreAction: {
        action: ignored ? 'ignore' : 'revoke', warehouseSku, ...(selection ? { warehouseSkus: [...selection.get(row.id)] } : {}),
      } }));
    }
    return { results, changedCount: results.filter(result => !result.idempotent).length };
  });
}

let lastStableErpRecovery = null;

export async function recoverErpCostInboxAdoptions({ workspaceId, ledgerId = null, background = false, shouldStop, deferReviewed } = {}) {
  const member = await getActiveMemberContext();
  if (!workspaceId || workspaceId !== member.workspaceId) throw new Error('恢复 ERP 收件必须限定当前工作区。');
  const revision = selectionFactsRevision();
  const key = JSON.stringify([workspaceId, ledgerId, member.memberId, member.role, revision]);
  // A completed check remains valid until a financial/context source changes.
  // Keep one small, process-local result; failures always retry, and startup
  // still checks durable receipts. Never cache a pass that wrote/changed data.
  if (lastStableErpRecovery?.key === key) return structuredClone(lastStableErpRecovery.results);
  lastStableErpRecovery = null;
  await loadErpRecoveryMemo(member);
  // Intersect index keys before reading any multi-megabyte receipt body.
  const [pendingIds, workspaceIds, ledgerIds] = await Promise.all([
    db.erpCostInbox.where('status').anyOf(['pending', 'loaded']).primaryKeys(),
    db.erpCostInbox.where('workspaceId').equals(workspaceId).primaryKeys(),
    ledgerId ? db.erpCostInbox.where('ledgerId').equals(ledgerId).primaryKeys() : null,
  ]);
  const owned = new Set(workspaceIds), scoped = ledgerIds ? new Set(ledgerIds) : null;
  const inboxIds = pendingIds.filter(id => owned.has(id) && (!scoped || scoped.has(id))).sort();
  const results = [];
  let yieldedAt = performance.now();
  const readScope = { shouldStop, deferReviewed: background ? () => activeProfitReads > 0 || hasOpenCostReview() || deferReviewed?.() : null };
  const reviewed = new Map();
  if (inboxIds.length && readScope.deferReviewed?.()) {
    const revision = inboxRevision();
    const states = await listErpCostAdoptionStates({workspaceId}).catch(() => []);
    if (revision && revision === inboxRevision()) for (const row of states) {
      if (row.adoption?.processedAt && !row.adoptionPending && !row.adoptionFailure) reviewed.set(row.id, inboxRowVersion(row.id));
    }
  }
  let deferred = false;
  for (const inboxId of inboxIds) {
    if (shouldStop?.()) return results;
    if (reviewed.get(inboxId) && readScope.deferReviewed() && reviewed.get(inboxId) === inboxRowVersion(inboxId)) {
      deferred = true;
      continue;
    }
    let probe;
    try {
      try { probe = await readErpRecoveryProbe({ inboxId, workspaceId, ledgerId, getContext: getActiveMemberContext, readScope }); }
      catch { /* Optional read cache failures retain the authoritative path. */ }
      if (shouldStop?.()) return results;
      if (probe?.deferred) { deferred = true; continue; }
      if (probe?.ignored) continue;
      const cached = probe && cachedErpRecoveryResult(probe);
      // Rechecking a processed, partial receipt usually changes nothing. Readers can
      // proceed during that check. Any mutation revalidates inside the write transaction.
      let checked = cached;
      if (!checked && probe?.result && !probe.hasPreviousCheck) {
        try { checked = await processErpCostInboxAdoptionOnce({ inboxId, resolutions: [], inspectOnly: true, readScope }); }
        catch { /* The write path preserves diagnostic and retry handling. */ }
      }
      if (shouldStop?.()) return results;
      const result = checked && !checked.needsWrite ? checked : await processErpCostInboxAdoption({ inboxId });
      if (!cached && probe) rememberErpRecoveryResult(probe, result);
      results.push(result);
    } catch (error) { results.push({ id: inboxId, status: probe?.metadata?.status ?? 'pending', error: error.message }); }
    if (performance.now() - yieldedAt > 25) {
      if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
      else await new Promise(resolve => setTimeout(resolve, 0));
      yieldedAt = performance.now();
    }
  }
  if (!deferred && selectionFactsRevision() === revision && !results.some(result => result.error)) {
    lastStableErpRecovery = { key, results: structuredClone(results) };
    await persistErpRecoveryMemo(member);
  }
  return results;
}

// Background task reporting needs adoption state, not multi-megabyte purchase
// envelopes. Reuse this tiny projection while its financial sources are stable.
export async function listErpCostAdoptionStates({ workspaceId = null } = {}) {
  return retrySourceRead(async () => {
    // Every consumer must observe source changes, even when another consumer
    // populated the metadata cache. A cache hit alone has no inbox dependency.
    await Promise.all([db.erpCostInbox.count(), observeTableRevision('erpCostInbox')]);
    const reader = inboxRevision() ? inboxRevision : sourceRevision;
    const revision = reader();
    const member = await getActiveMemberContext();
    if (workspaceId && workspaceId !== member.workspaceId) throw new Error('ERP 采用状态必须限定当前工作区。');
    assertSourceRevision(revision, reader);
    const compute = () => readReceiptStates('workspaceId', member.workspaceId);
    return cachedDerived({ scope: [member.workspaceId, member.memberId, member.role], formula: 'erp-cost-adoption-states@3-inbox',
      revision, revisionReader: reader, compute });
  });
}


async function publishVerifiedErpCostBatch({
  ledgerId,
  reconciliation,
  inboxId = null,
  sourceName = "clipboard.tsv",
  inputHash = null,
  requestId = null,
  sourceEnvelope = null,
  workspaceId = DEFAULT_WORKSPACE_ID,
  publishedBy = "local-user",
  adoptionContext = null,
}, transactionReads = null) {
  // Only our enclosing adoption transaction can supply this snapshot. The
  // public/UI argument object cannot provide it, and no sales writes occur
  // between these reads and publication/coverage within this transaction.
  const sharedSales = transactionReads?.transaction === Dexie.currentTransaction
    && Dexie.currentTransaction?.mode === 'readwrite'
    && transactionReads?.ledgerId === ledgerId && transactionReads?.workspaceId === workspaceId
    ? transactionReads.salesRows : null;
  const batchId = adoptionContext?.batchId ?? makeId("COST");
  const publishedAt = new Date().toISOString();
  const auditActor = await resolveProfitAuditActor(publishedBy);
  const effectiveRequestId = String(sourceEnvelope?.requestId ?? requestId ?? "").trim() || null;
  if (!effectiveRequestId) {
    throw new Error("发布 ERP 成本前必须关联已记录的平台 SKC 查询请求。");
  }
  if (!sourceEnvelope) {
    throw new Error("发布 ERP 正式成本必须使用包含完整采购证据的 v2 批次；TSV、旧批次和页面汇总只能预览。");
  }
  const targetLedger = await db.ledgers.get(ledgerId);
  if (!targetLedger || targetLedger.workspaceId !== workspaceId) throw new Error("找不到当前工作区的月度账本。");
  const costPeriod = normalizeLedgerPeriod(targetLedger.period);
  const recordedRequest = await db.erpCostRequests.get(effectiveRequestId);
  if (!recordedRequest
    || String(recordedRequest.ledgerId ?? "") !== String(ledgerId)
    || String(recordedRequest.workspaceId ?? "") !== String(workspaceId)) {
    throw new Error("找不到与当前账本和工作区匹配的 ERP 成本请求，不能发布正式成本。");
  }
  const legacyScope = adoptionContext && !recordedRequest.expectedSkus?.length
    ? legacyExpectedSkusForRequest({ request: recordedRequest, salesRows: sharedSales ?? await db.salesRows.where('ledgerId').equals(ledgerId).toArray(), workspaceId })
    : null;
  if (legacyScope?.reason) throw new Error(`旧 ERP 请求范围无法安全恢复：${legacyScope.reason}`);
  const verifiedExpectedSkus = Array.isArray(recordedRequest.expectedSkus) && recordedRequest.expectedSkus.length > 0
    ? recordedRequest.expectedSkus
    : legacyScope?.expectedSkus ?? null;
  if (!verifiedExpectedSkus) {
    throw new Error("已记录的 ERP 成本请求缺少精确 expected SKU 范围，只能预览，不能发布正式成本。");
  }
  const validatedSource = validateErpCostBatchEnvelope(sourceEnvelope, {
    expectedWorkspaceId: workspaceId,
    expectedLedgerId: ledgerId,
    expectedRequestId: effectiveRequestId,
    expectedPlatformSkcs: recordedRequest.platformSkcs,
    expectedSkus: verifiedExpectedSkus,
    expectedHistoryMappings: recordedRequest.historyMappings ?? [],
  });
  const verifiedSourceEnvelope = validatedSource.envelope;
  if (verifiedSourceEnvelope.formatVersion !== ERP_COST_BATCH_VERSION || (!adoptionContext && verifiedSourceEnvelope.evidenceStatus !== "complete")) {
    throw new Error("发布 ERP 正式成本必须使用包含完整采购证据的 v2 批次；TSV、旧批次和页面汇总只能预览。");
  }
  const matchedRows = reconciliation.matches.filter((row) => row.status === "matched");
  // Rebuild the full incoming request scope: hiding an unresolved row in the
  // page filter (or omitting it from submitted matches) must not approve it.
  const authoritativeReconciliation = reconcileErpCostRows({
    workspaceId, period: costPeriod, expectedSkus: verifiedExpectedSkus,
    costRows: validatedSource.rows,
    resolutions: reconciliation.matches.flatMap(row => row.resolutions ?? []),
  });
  const sourceEvidenceByWarehouseSku = new Map(verifiedSourceEnvelope.warehouseEvidence.map((entry) => [
    canonicalWarehouseSku(entry.warehouseSku),
    entry,
  ]));
  const expectedSourceRowsBySku = new Map(validatedSource.rows
    .filter((row) => row.ledgerScopeRole === "expected" && row.canonicalPlatformSku)
    .map((row) => [row.canonicalPlatformSku, row]));
  const verifiedRows = matchedRows.map((row) => {
    if (row.ledgerScopeRole !== "expected") {
      throw new Error(`平台 SKU ${row.platformSku || "未知"} 不是当前账本 expected 范围，不能发布正式成本。`);
    }
    const sourceRow = expectedSourceRowsBySku.get(canonicalPlatformSku(row.platformSku));
    if (!sourceRow
      || !sourceRow.warehouseSku
      || !row.sourceWarehouseSku
      || canonicalWarehouseSku(sourceRow.warehouseSku) !== canonicalWarehouseSku(row.sourceWarehouseSku)
      || sourceRow.evidenceComplete !== true) {
      throw new Error(`平台 SKU ${row.platformSku || "未知"} 未通过当前账本 expected 证据独立校验。`);
    }
    if (!row.platformSkc || canonicalPlatformSkc(row.platformSkc) !== canonicalPlatformSkc(sourceRow.platformSkc)) {
      throw new Error(`平台 SKU ${row.platformSku} 的页面 SKC 与 ERP 原始证据不一致，请重新核对来源。`);
    }
    const sourceEvidence = row.sourceWarehouseSku
      ? sourceEvidenceByWarehouseSku.get(canonicalWarehouseSku(row.sourceWarehouseSku))
      : null;
    if (sourceEvidence?.evidenceRef !== sourceRow.evidenceRef || sourceEvidence?.evidenceComplete !== true) {
      throw new Error(`平台 SKU ${row.platformSku || "未知"} 的证据引用与仓库证据不一致。`);
    }
    const purchaseRecords = sourceEvidence?.purchaseRecords ?? row.purchaseRecords;
    if (hasLegacyMonthExclusions({ ...sourceEvidence, sourceMeta: verifiedSourceEnvelope.sourceMeta }, costPeriod)) {
      throw new Error(`${costPeriod} 及以前的采购曾被旧版当月排除规则遗漏，请重新采集或填写人工成本。`);
    }
    const evidenceComplete = sourceEvidence?.evidenceComplete ?? row.evidenceComplete;
    const decision = calculateWarehouseCostDecision({
      warehouseSku: row.sourceWarehouseSku,
      purchaseRecords,
      resolutions: row.resolutions,
      evidenceComplete,
      period: costPeriod,
    });
    if (decision.unitCost === 0 && decision.selectedRecords.every((record) => record.effectiveUnitPrice > 0)) {
      throw new Error("正式 ERP 单价小于 0.0001 元，超出当前四位小数精度，不能发布。请保留真实采购价格。");
    }
    if (decision.resolutionStatus !== "resolved" || decision.unresolvedAnomalyCount > 0 || decision.formalUnitCost == null || decision.formalUnitCost < 0) {
      throw new Error(`仓库 SKU ${row.sourceWarehouseSku || "未知"} 在 ${costPeriod} 及以前的采购证据或异常处置尚未满足正式成本要求。`);
    }
    if (!Number.isFinite(Number(row.unitCost)) || Math.abs(Number(row.unitCost) - decision.formalUnitCost) > 0.00005) {
      throw new Error(`仓库 SKU ${row.sourceWarehouseSku || "未知"} 的页面成本与仓储层独立复算结果不一致。`);
    }
    return {
      ...row,
      evidenceRef: sourceRow.evidenceRef,
      evidenceComplete: sourceRow.evidenceComplete === true && sourceEvidence?.evidenceComplete === true,
      unitCost: decision.formalUnitCost,
      formalUnitCost: decision.formalUnitCost,
      totalQuantity: decision.totalQuantity,
      totalPrice: decision.totalPrice,
      calculationCount: decision.calculationCount,
      selectedRecordIds: decision.selectedRecordIds,
      purchaseRecords: decision.purchaseRecords,
      excludedRecords: sourceEvidence?.excludedRecords ?? row.excludedRecords ?? [],
      sourceWarnings: sourceEvidence?.sourceWarnings ?? row.sourceWarnings ?? [],
      costDecision: decision,
      costPeriod,
      ...purchaseOrderSummary(decision.selectedRecords),
      dateRange: `${decision.selectedRecords.at(-1).purchaseDate} ~ ${decision.selectedRecords[0].purchaseDate}`,
      resolutionStatus: decision.resolutionStatus,
      unresolvedAnomalyCount: decision.unresolvedAnomalyCount,
      resolvedAnomalyCount: decision.resolvedAnomalyCount,
      anomalyCount: decision.anomalyCount,
      anomalies: decision.anomalies,
      resolutions: decision.resolutions,
      baseline: decision.baseline,
    };
  });
  const manualDeliveryId = `ERP-MANUAL-${verifiedSourceEnvelope.batchId}`;
  let appliedInboxId = null;
  let adoptionSummary = null;
  let rowIds;
  await db.transaction("rw", db.ledgers, db.salesRows, db.erpCostRequests, db.erpCostInbox, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.auditEvents, async () => {
    const ledger = operatingLedger(await db.ledgers.get(ledgerId));
    if (!ledger) throw new Error("找不到对应的月度账本。");
    if (ledger.period !== costPeriod) throw new Error("账本月份已变化，请重新核对 ERP 成本。");
    if (String(workspaceId) !== String(ledger.workspaceId)) throw new Error("ERP 成本发布工作区与账本不一致。");
    const [salesRows, approvals] = await Promise.all([
      sharedSales ?? db.salesRows.where("ledgerId").equals(ledgerId).toArray(),
      db.costApprovals.where("ledgerId").equals(ledgerId).toArray(),
    ]);
    const identities = buildLedgerSkuIdentityIndex(salesRows);
    for (const row of verifiedRows) {
      const identity = identities.get(canonicalPlatformSku(row.platformSku));
      // Request-scoped publication can precede the first sales import. Its
      // envelope already proves the requested identity; compare live targets
      // when present, and recheck them on every later import/report write.
      const issue = identity && ledgerCostIdentityIssue(identity, row, { requireSkc: true });
      if (issue) throw new Error(describeLedgerCostIdentityIssue(issue));
    }
    const readiness = erpAdoptionReadiness({ ledger, salesRows, approvals: accountingApprovals(approvals), reconciliation: authoritativeReconciliation });
    if (!adoptionContext && readiness.blockedRows.length) {
      if (readiness.blockedRows.some(row => row.costDecision?.unitCost === 0 && row.costDecision?.selectedRecords?.length && row.costDecision.selectedRecords.every(record => record.effectiveUnitPrice > 0))) {
        throw new Error("正式 ERP 单价小于 0.0001 元，超出当前四位小数精度，不能发布。请保留真实采购价格。");
      }
      throw new Error("仍有采购成本异常或不完整证据未在 Lworkstation 完成处置；人工更正须覆盖该 SKU 在本月的全部店铺，不能发布为 ERP 正式成本。");
    }
    if (!verifiedRows.length) throw new Error("当前批次没有可采用的正式 ERP 成本。");
    adoptionSummary = { ...authoritativeReconciliation.summary, ...readiness.summary, matchedCount: verifiedRows.length, manuallyCovered: readiness.manuallyCovered };
    const request = await db.erpCostRequests.get(effectiveRequestId);
    if (!request || String(request.ledgerId ?? "") !== String(ledgerId) || String(request.workspaceId ?? "") !== String(ledger.workspaceId)) {
      throw new Error("找不到与当前账本和工作区匹配的 ERP 成本请求，不能发布正式成本。");
    }
    const normalizedInboxId = String(inboxId ?? "").trim() || null;
    const sourceInboxRecords = await db.erpCostInbox.where("batchId").equals(verifiedSourceEnvelope.batchId).primaryKeys();
    if (sourceInboxRecords.length > 1) {
      throw new Error("ERP 源批次关联了多个收件记录，不能发布正式成本。");
    }
    const sourceInboxId = sourceInboxRecords[0] ?? null;
    if (sourceInboxId && !normalizedInboxId) {
      throw new Error("该 ERP 源批次已有收件记录，必须从当前已载入的收件批次发布。");
    }
    let linkedInbox = normalizedInboxId ? await db.erpCostInbox.get(normalizedInboxId) : null;
    if (normalizedInboxId && (!linkedInbox
      || !(adoptionContext ? ["pending", "loaded"].includes(linkedInbox.status) : linkedInbox.status === "loaded")
      || linkedInbox.ledgerId !== ledgerId
      || linkedInbox.workspaceId !== workspaceId
      || linkedInbox.requestId !== effectiveRequestId
      || linkedInbox.batchId !== verifiedSourceEnvelope.batchId
      || (sourceInboxId && sourceInboxId !== linkedInbox.id))) {
      throw new Error("当前 ERP 收件批次状态或请求范围已变化，请重新载入后再发布。");
    }
    const manualInbox = !sourceInboxId && !linkedInbox;
    if (manualInbox) {
      linkedInbox = {
        id: `INBOX-${manualDeliveryId}`,
        deliveryId: manualDeliveryId,
        batchId: verifiedSourceEnvelope.batchId,
        workspaceId,
        ledgerId,
        requestId: effectiveRequestId,
        status: "applied",
        receivedVia: "manual-v2-import",
        sentAt: publishedAt,
        receivedAt: publishedAt,
        envelope: buildErpCostInboxEnvelope({ batch: verifiedSourceEnvelope, deliveryId: manualDeliveryId, sentAt: publishedAt, transport: "manual-v2-import" }, {
          expectedWorkspaceId: workspaceId, expectedLedgerId: ledgerId, expectedRequestId: effectiveRequestId,
          expectedPlatformSkcs: recordedRequest.platformSkcs, expectedSkus: verifiedExpectedSkus,
        }),
      };
    }

    const sourceContract = {
      format: verifiedSourceEnvelope.format,
      formatVersion: verifiedSourceEnvelope.formatVersion,
      batchId: verifiedSourceEnvelope.batchId,
      requestId: verifiedSourceEnvelope.requestId,
      generatedAt: verifiedSourceEnvelope.generatedAt,
      complete: verifiedSourceEnvelope.complete,
      baseline: verifiedSourceEnvelope.baseline,
      algorithmVersion: verifiedSourceEnvelope.algorithmVersion,
      resolutionVersion: ERP_COST_RESOLUTION_VERSION,
      costPeriod,
      query: verifiedSourceEnvelope.query,
      summary: verifiedSourceEnvelope.summary,
      sourceMeta: verifiedSourceEnvelope.sourceMeta,
      evidenceStatus: verifiedSourceEnvelope.evidenceStatus,
      warehouseEvidence: verifiedSourceEnvelope.warehouseEvidence,
      catalogRows: erpProductCatalogRowsFromEnvelope(verifiedSourceEnvelope, { batchId, publishedAt }),
      ...(verifiedSourceEnvelope.catalogCoverage ? { catalogCoverage: verifiedSourceEnvelope.catalogCoverage, catalogVersion: 1 } : {}),
    };
    const savedBatch = {
      id: batchId,
      workspaceId,
      ledgerId,
      requestId: effectiveRequestId,
      sourceName,
      inputHash,
      ...(adoptionContext ? { sourceOrder: adoptionContext.sourceOrder, adoptionVersion: ERP_ADOPTION_VERSION } : {}),
      status: "published",
      currency: "CNY",
      publishedBy: auditActor,
      publishedAt,
      summary: adoptionSummary,
      invalidRows: authoritativeReconciliation.invalidRows,
      overrides: authoritativeReconciliation.overrides,
      sourceContract,
    };
    if (adoptionContext?.batchId) await db.erpCostBatches.put(savedBatch);
    else await db.erpCostBatches.add(savedBatch);

    const storedRows = verifiedRows.map((row) => ({
      batchId,
      ledgerId,
      workspaceId,
      platformSku: row.platformSku,
      canonicalPlatformSku: row.canonicalPlatformSku,
      platformSkc: row.platformSkc ?? null,
      canonicalPlatformSkc: row.canonicalPlatformSkc ?? null,
      warehouseSku: row.sourceWarehouseSku,
      evidenceRef: row.evidenceRef,
      evidenceComplete: row.evidenceComplete,
      unitCost: row.unitCost,
      costPeriod,
      currency: row.currency,
      orderNumber: row.orderNumber,
      orderType: row.orderType,
      productName: expectedSourceRowsBySku.get(canonicalPlatformSku(row.platformSku))?.productName,
      ...normalizeErpCatalogFields(expectedSourceRowsBySku.get(canonicalPlatformSku(row.platformSku))),
      catalogQuerySkcs: verifiedSourceEnvelope.query.platformSkcs.map((item) => item.platformSkc),
      calculationCount: row.calculationCount,
      dateRange: row.dateRange,
      totalQuantity: row.totalQuantity,
      totalPrice: row.totalPrice,
      supplierName: expectedSourceRowsBySku.get(canonicalPlatformSku(row.platformSku))?.supplierName,
      supplier1688Url: expectedSourceRowsBySku.get(canonicalPlatformSku(row.platformSku))?.supplier1688Url,
      selectedRecordIds: row.selectedRecordIds,
      purchaseRecords: row.purchaseRecords,
      excludedRecords: row.excludedRecords,
      sourceWarnings: row.sourceWarnings,
      costDecision: row.costDecision,
      resolutionStatus: row.resolutionStatus,
      unresolvedAnomalyCount: row.unresolvedAnomalyCount,
      resolvedAnomalyCount: row.resolvedAnomalyCount,
      anomalyCount: row.anomalyCount,
      anomalies: row.anomalies,
      resolutions: row.resolutions,
      baseline: row.baseline,
      evidence: {
        purchaseRecords: row.purchaseRecords,
        excludedRecords: row.excludedRecords,
        sourceWarnings: row.sourceWarnings,
        costDecision: row.costDecision,
        sourceMeta: verifiedSourceEnvelope.sourceMeta,
        evidenceStatus: verifiedSourceEnvelope.evidenceStatus,
      },
      matchMethod: row.matchMethod,
      mappingFallback: row.mappingFallback,
      ...(adoptionContext ? { sourceOrder: adoptionContext.sourceOrder, adoptionVersion: ERP_ADOPTION_VERSION } : {}),
      sourceEnvelopeBatchId: verifiedSourceEnvelope.batchId,
      sourceAlgorithmVersion: verifiedSourceEnvelope.algorithmVersion,
      sourceBaselineSha256: verifiedSourceEnvelope.baseline?.releaseSha256 ?? null,
      publishedAt,
    }));
    const keys = await db.erpCostRows.bulkAdd(storedRows, { allKeys: true });
    const added = storedRows.map((row, i) => ({ ...row, id: keys[i] }));
    const sharedInputs = sharedSales && transactionReads.actionInputs?.current;
    if (sharedInputs) {
      sharedInputs.batchById.set(batchId, adoptionBatchHeader(savedBatch));
      for (const row of added) sharedInputs.costHeaders.push(adoptionCostHeader(row));
    }
    const heads = sharedSales && transactionReads.coverageHeads;
    let coverage;
    if (heads) {
      for (const row of added) setCoverageHead(heads, row, true, costPeriod);
      coverage = calculateLedgerCostCoverage({ salesRows, approvals: accountingApprovals(approvals), workspaceId, ledgerId, period: costPeriod,
        erpCosts: [...heads.values()].flatMap(head => head.cost ? [head.cost] : []) }, row => row.withinPeriod);
    } else coverage = await readLedgerCostCoverage(ledgerId, { ledger, salesRows });
    const savedLedger = {
      ...ledger,
      ...buildLedgerCoveragePatch(
      ledger,
      coverage,
      publishedAt,
      adoptionSummary,
      ),
    };
    await db.ledgers.put(savedLedger);
    const persistedRows = adoptionContext?.batchId ? await db.erpCostRows.where("batchId").equals(batchId).toArray() : added;
    if (sharedSales) {
      rowIds = new Map();
      for (const row of persistedRows) {
        const sku = canonicalPlatformSku(row.platformSku);
        if (!rowIds.has(sku)) rowIds.set(sku, row.id);
      }
    }
    let appliedInbox = null;
    if (linkedInbox) {
      appliedInbox = {
        ...linkedInbox,
        status: "applied",
        appliedBatchId: batchId,
        appliedAt: publishedAt,
        updatedAt: publishedAt,
      };
      if (manualInbox) await db.erpCostInbox.add(appliedInbox);
      else await db.erpCostInbox.put(appliedInbox);
      appliedInboxId = appliedInbox.id;
    }

    await db.auditEvents.add({
      workspaceId,
      objectType: "erp_cost_batch",
      objectId: batchId,
      action: "published",
      actorId: auditActor,
      createdAt: publishedAt,
      after: {
        ledgerId,
        sourceName,
        ...adoptionSummary,
        ...(adoptionContext ? { adoptionMethod: adoptionContext.method, systemSource: "erp-auto-adoption", previousCosts: adoptionContext.previousCosts } : {}),
        snapshot: {
          ...savedBatch,
          costBatch: savedBatch,
          rows: persistedRows,
          inbox: appliedInbox,
          ledger: savedLedger,
        },
      },
    });
    if (manualInbox && appliedInbox) {
      await db.auditEvents.add({
        workspaceId,
        objectType: "erp_cost_inbox",
        objectId: appliedInbox.id,
        action: "manual_v2_import_applied",
        actorId: auditActor,
        createdAt: publishedAt,
        after: {
          batchId: verifiedSourceEnvelope.batchId,
          appliedBatchId: batchId,
          ledgerId,
          requestId: effectiveRequestId,
          snapshot: appliedInbox,
        },
      });
    }
  });

  return { batchId, inboxId: appliedInboxId, ...adoptionSummary, matchedCount: verifiedRows.length, ...(rowIds ? { rowIds } : {}) };
}

export async function saveApproved1688Fallback({
  ledgerId,
  platformSku,
  unitCost,
  reason,
  approvedBy,
  referenceSource = "人工录入",
  referenceOrderNumber = "",
}) {
  const normalizedSku = normalizePlatformSku(platformSku);
  const canonicalSku = canonicalPlatformSku(normalizedSku);
  const amount = Number(unitCost);
  const normalizedReason = String(reason ?? "").trim();
  const requestedActor = String(approvedBy ?? "").trim();
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("1688 参考单件成本必须大于 0。");
  if (!normalizedReason) throw new Error("审批原因不能为空。");
  if (!requestedActor) throw new Error("复核人不能为空。");
  const normalizedActor = await resolveProfitAuditActor(requestedActor);

  const approvedAt = new Date().toISOString();
  const referenceCostId = makeId("REF-1688");
  const approvalId = makeId("APPROVAL");
  let savedApproval = null;

  await db.transaction(
    "rw",
    db.ledgers,
    db.salesRows,
    db.erpCostBatches,
    db.erpCostRows,
    db.costApprovals,
    db.auditEvents,
    async () => {
      const ledger = operatingLedger(await db.ledgers.get(ledgerId));
      if (!ledger) throw new Error("找不到对应的月度账本。");

      const ledgerRows = await db.salesRows.where("ledgerId").equals(ledgerId).toArray();
      if (!ledgerRows.some((row) => canonicalPlatformSku(row.platformSku ?? row.sku) === canonicalSku)) {
        throw new Error("该平台 SKU 不属于当前月度账本。");
      }

      const erpRows = await getLatestLedgerCosts(ledgerId);
      if (erpRows.some((row) => canonicalPlatformSku(row.platformSku) === canonicalSku && Number(row.unitCost) > 0)) {
        throw new Error("该平台 SKU 已有 ERP 正式成本，无需使用 1688 兜底。");
      }

      const activeApprovals = (await db.costApprovals.where("ledgerId").equals(ledgerId).toArray())
        .filter((item) => manualSnapshot(item)?.kind !== "manual_override" && item.status === "approved" && canonicalPlatformSku(item.platformSku) === canonicalSku);
      for (const item of activeApprovals) {
        const revokedApproval = {
          ...item,
          status: "revoked",
          revokedAt: approvedAt,
          revokedBy: normalizedActor,
          revokeReason: "已由新的审批记录替换",
        };
        await db.costApprovals.put(revokedApproval);
        await db.auditEvents.add({
          workspaceId: ledger.workspaceId,
          objectType: "cost_approval",
          objectId: item.id,
          action: "revoked",
          actorId: normalizedActor,
          createdAt: approvedAt,
          before: { status: item.status },
          after: {
            status: "revoked",
            reason: revokedApproval.revokeReason,
            snapshot: revokedApproval,
          },
        });
      }

      const normalizedSource = String(referenceSource ?? "").trim() || "人工录入";
      const normalizedOrderNumber = String(referenceOrderNumber ?? "").trim() || null;
      const referenceCost = {
        id: referenceCostId,
        kind: "supplier_landed",
        platformSku: normalizedSku,
        unitCost: amount,
        amount,
        currency: "CNY",
        source: normalizedSource,
        orderNumber: normalizedOrderNumber,
        calculatedAt: approvedAt,
        inputSnapshot: {
          source: normalizedSource,
          orderNumber: normalizedOrderNumber,
          approvedUnitCost: amount,
        },
      };
      const approval = {
        id: approvalId,
        workspaceId: ledger.workspaceId,
        ledgerId,
        platformSku: normalizedSku,
        canonicalPlatformSku: canonicalSku,
        referenceCostId,
        approvedAmount: amount,
        currency: "CNY",
        reason: normalizedReason,
        approvedBy: normalizedActor,
        approvedAt,
        status: "approved",
        referenceCost,
      };
      const decision = resolveFormalCostDecision({
        ledgerId,
        platformSku: normalizedSku,
        reference1688Cost: referenceCost,
        approval,
      });
      if (decision.status !== "manual_fallback" || decision.source !== "approved_1688" || decision.eligibleForExactProfit) {
        throw new Error(`审批记录未通过人工参考成本规则：${decision.reasons.join(", ") || "未知原因"}`);
      }

      await db.costApprovals.add(approval);
      const coverage = await readLedgerCostCoverage(ledgerId);
      const savedLedger = { ...ledger, ...buildLedgerCoveragePatch(ledger, coverage, approvedAt) };
      await db.ledgers.put(savedLedger);
      await db.auditEvents.add({
        workspaceId: ledger.workspaceId,
        objectType: "cost_approval",
        objectId: approvalId,
        action: "approved_1688_fallback",
        actorId: normalizedActor,
        createdAt: approvedAt,
        after: {
          ledgerId,
          platformSku: normalizedSku,
          approvedAmount: amount,
          currency: "CNY",
          referenceCostId,
          reason: normalizedReason,
          missingCount: coverage.missingCount,
          snapshot: { ...approval, ledger: savedLedger },
        },
      });
      savedApproval = approval;
    },
  );

  return savedApproval;
}

export async function revokeApproved1688Fallback({
  ledgerId,
  approvalId,
  reason,
  revokedBy,
}) {
  const normalizedReason = String(reason ?? "").trim();
  const requestedActor = String(revokedBy ?? "").trim();
  if (!normalizedReason) throw new Error("撤销原因不能为空。");
  if (!requestedActor) throw new Error("操作人不能为空。");
  const normalizedActor = await resolveProfitAuditActor(requestedActor);
  const revokedAt = new Date().toISOString();

  await db.transaction(
    "rw",
    db.ledgers,
    db.salesRows,
    db.erpCostBatches,
    db.erpCostRows,
    db.costApprovals,
    db.auditEvents,
    async () => {
      const ledger = operatingLedger(await db.ledgers.get(ledgerId));
      if (!ledger) throw new Error("找不到对应的月度账本。");
      const approval = await db.costApprovals.get(approvalId);
      if (!approval || approval.ledgerId !== ledgerId) throw new Error("找不到对应的成本审批记录。");
      if (manualSnapshot(approval)?.kind === "manual_override") throw new Error("人工更正须通过逐店成本更正入口撤销。");
      if (approval.status !== "approved") throw new Error("该成本审批已经失效。");

      const revokedApproval = {
        ...approval,
        status: "revoked",
        revokedAt,
        revokedBy: normalizedActor,
        revokeReason: normalizedReason,
      };
      await db.costApprovals.put(revokedApproval);
      const coverage = await readLedgerCostCoverage(ledgerId);
      const savedLedger = { ...ledger, ...buildLedgerCoveragePatch(ledger, coverage, revokedAt) };
      await db.ledgers.put(savedLedger);
      await db.auditEvents.add({
        workspaceId: ledger.workspaceId,
        objectType: "cost_approval",
        objectId: approvalId,
        action: "revoked",
        actorId: normalizedActor,
        createdAt: revokedAt,
        before: {
          ledgerId,
          platformSku: approval.platformSku,
          approvedAmount: approval.approvedAmount,
          status: approval.status,
        },
        after: {
          status: "revoked",
          reason: normalizedReason,
          missingCount: coverage.missingCount,
          snapshot: { ...revokedApproval, ledger: savedLedger },
        },
      });
    },
  );
}

export async function saveErpCostRequest(request) {
  const createdAt = request.requestedAt ?? new Date().toISOString();
  const auditActor = await resolveProfitAuditActor(request.requestedBy);
  const savedRequest = { ...request, requestedBy: auditActor };
  await db.transaction("rw", db.ledgers, db.importBatches, db.erpCostRequests, db.auditEvents, async () => {
    const ledger = request.ledgerId ? await db.ledgers.get(request.ledgerId) : null;
    if (request.ledgerId && !ledger) throw new Error("找不到对应的月度账本。");
    if (ledger && ledger.workspaceId !== request.workspaceId) throw new Error("账本工作区不匹配，不能登记核算请求。");
    const ledgerPeriod = ledger?.period ?? request.ledgerPeriod ?? null;
    if (ledgerPeriod != null && (typeof ledgerPeriod !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ledgerPeriod))) throw new Error("ERP 请求核算月份必须为 YYYY-MM。");
    if (request.ledgerPeriod != null && request.ledgerPeriod !== ledgerPeriod) throw new Error("ERP 请求核算月份与月度账本不匹配。");
    savedRequest.ledgerPeriod = ledgerPeriod;
    if (request.ledgerVersion != null && ledger && request.ledgerVersion !== erpLedgerVersion(await db.importBatches.where('ledgerId').equals(ledger.id).toArray())) throw new Error('台账导入已变化，请重新准备 ERP 请求。');
    const existing = await db.erpCostRequests.get(request.id);
    if (existing) {
      if (existing.workspaceId !== request.workspaceId || existing.ledgerId !== request.ledgerId || (existing.ledgerPeriod ?? null) !== ledgerPeriod || (existing.ledgerVersion ?? null) !== (request.ledgerVersion ?? null) || JSON.stringify(existing.platformSkcs) !== JSON.stringify(request.platformSkcs) || JSON.stringify(existing.expectedSkus ?? []) !== JSON.stringify(request.expectedSkus ?? [])
        || JSON.stringify(existing.historyMappings ?? []) !== JSON.stringify(request.historyMappings ?? [])) throw new Error("ERP 请求 ID 已被不同范围使用。");
      return;
    }

    await db.erpCostRequests.put({
      ...savedRequest,
      status: "draft",
      createdAt,
      updatedAt: createdAt,
    });
    await db.auditEvents.add({
      workspaceId: request.workspaceId,
      objectType: "erp_cost_request",
      objectId: request.id,
      action: "request_prepared",
      actorId: auditActor,
      createdAt,
      after: {
        ledgerId: request.ledgerId,
        platformSkcCount: request.platformSkcs.length,
        snapshot: { ...savedRequest, status: "draft", createdAt, updatedAt: createdAt },
      },
    });
  });
  return request.id;
}

export async function receiveErpCostInboxEnvelope({ envelope, receivedVia = 'browser-message' } = {}) {
  const member = await getActiveMemberContext();
  let result;
  await db.transaction('rw', db.erpCostRequests, db.erpCostInbox, db.auditEvents, async () => {
    const request = await db.erpCostRequests.get(String(envelope?.batch?.requestId ?? ''));
    const validated = validateErpCostInboxEnvelope(envelope, request ? { expectedWorkspaceId: request.workspaceId, expectedLedgerId: request.ledgerId, expectedRequestId: request.id, expectedPlatformSkcs: request.platformSkcs, expectedSkus: request.expectedSkus?.length ? request.expectedSkus : null, expectedHistoryMappings: request.historyMappings ?? [] } : {});
    const batch = validated.batch;
    if (batch.workspaceId !== member.workspaceId) throw new Error('ERP 收件不属于当前工作区。');
    const byDelivery = await db.erpCostInbox.where('deliveryId').equals(validated.deliveryId).first();
    const byBatch = await db.erpCostInbox.where('batchId').equals(batch.batchId).first();
    const existing = byDelivery ?? byBatch;
    if (existing) {
      if (byDelivery && byBatch && byDelivery.id !== byBatch.id) throw new Error('ERP 投递和源批次标识冲突。');
      const previous = validateErpCostInboxEnvelope(existing.envelope, request ? { expectedWorkspaceId: request.workspaceId, expectedLedgerId: request.ledgerId, expectedRequestId: request.id, expectedPlatformSkcs: request.platformSkcs, expectedSkus: request.expectedSkus?.length ? request.expectedSkus : null, expectedHistoryMappings: request.historyMappings ?? [] } : {}).batch;
      if (JSON.stringify(previous) !== JSON.stringify(batch)) throw new Error('ERP 投递或源批次 ID 已被不同证据使用。');
      result = { id: existing.id, deliveryId: existing.deliveryId, batchId: existing.batchId, status: existing.status, idempotent: true };
      return;
    }
    const receivedAt = new Date().toISOString(), id = `INBOX-${validated.deliveryId}`;
    // The receipt commits before adoption. Do not expose this brief interval as
    // a legacy draft eligible for page auto-load.
    const saved = { id, deliveryId: validated.deliveryId, batchId: batch.batchId, workspaceId: batch.workspaceId, ledgerId: batch.ledgerId, requestId: batch.requestId, status: 'pending', adoptionPending: true, receivedVia: String(receivedVia || validated.envelope.transport), sentAt: validated.envelope.sentAt, receivedAt, envelope: validated.envelope };
    await db.erpCostInbox.add(saved);
    await db.auditEvents.add({ workspaceId: batch.workspaceId, objectType: 'erp_cost_inbox', objectId: id, action: 'received', actorId: member.memberId, createdAt: receivedAt, after: { batchId: batch.batchId, ledgerId: batch.ledgerId, requestId: batch.requestId, deliveryId: validated.deliveryId, receivedVia: saved.receivedVia, outputRowCount: batch.summary.outputRowCount } });
    result = { id, deliveryId: validated.deliveryId, batchId: batch.batchId, status: 'pending', idempotent: false };
  });
  // Receipt is durable before processing. A failed adoption transaction may be
  // acknowledged by transport because startup recovery retains the full inbox.
  try {
    const adoption = await processErpCostInboxAdoption({ inboxId: result.id });
    return { ...result, status: adoption.status, adoption: adoption.adoption };
  } catch (error) { return { ...result, adoptionError: error.message }; }
}

export async function getLatestErpCostInbox(ledgerId = null) {
  const rows = ledgerId
    ? await db.erpCostInbox.where("ledgerId").equals(ledgerId).toArray()
    : await db.erpCostInbox.toArray();
  return rows
    .filter((row) => ["pending", "loaded"].includes(row.status))
    .toSorted((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))[0] ?? null;
}

export async function getErpCostInbox(id) {
  const key = String(id ?? "").trim();
  return key ? db.erpCostInbox.get(key) : null;
}

const inboxRevision = tableRevisionReader('erpCostInbox');
const decodedInboxSummaries = new WeakMap();
const packedInboxRows = new Map();
async function packDisplayInboxes(query, parents) {
  const ids = await query.primaryKeys(), packed = [];
  for (let i = 0; i < ids.length; i += 4) {
    const group = ids.slice(i, i + 4).map(id => {
      const version = inboxRowVersion(id), saved = packedInboxRows.get(id);
      if (version && saved?.version === version) {
        const parent = parents.get(saved.ledgerId);
        if (parent?.workspaceId === saved.workspaceId && parent.period === saved.period) return {id,version,part:saved.part};
      }
      return {id,version};
    });
    const missing = group.filter(entry => !entry.part);
    const originals = missing.length ? await db.erpCostInbox.bulkGet(missing.map(entry => entry.id)) : [];
    const byId = new Map(originals.filter(Boolean).map(row => [row.id,row]));
    const pieces = await Promise.all(group.map(async ({id, version, part: cached}) => {
      if (cached) return cached;
      const row = byId.get(id);
      if (!row) return null;
      const parent = parents.get(row.ledgerId), period = parent?.workspaceId === row.workspaceId ? parent.period : null;
      const header = await indexedErpInboxSummary(row, period);
      let part = header;
      if (globalThis.CompressionStream && globalThis.DecompressionStream && globalThis.Blob?.prototype.stream) {
        const stream = new Blob([JSON.stringify(header)]).stream().pipeThrough(new CompressionStream('gzip'));
        part = await new Response(stream).arrayBuffer();
      }
      if (version && version === inboxRowVersion(id) && part instanceof ArrayBuffer && part.byteLength <= 1024 * 1024) {
        packedInboxRows.set(id, { version, ledgerId: row.ledgerId, workspaceId: row.workspaceId, period, part });
        if (packedInboxRows.size > 128) packedInboxRows.delete(packedInboxRows.keys().next().value);
      }
      return part;
    }));
    packed.push(...pieces.filter(Boolean));
  }
  return packed;
}
async function unpackDisplayInboxes(parts) {
  const prior = decodedInboxSummaries.get(parts)?.deref();
  if (prior) return prior;
  const rows = [];
  for (const part of parts) {
    rows.push(part instanceof ArrayBuffer ? await new Response(new Blob([part]).stream().pipeThrough(new DecompressionStream('gzip'))).json() : part);
  }
  if (typeof WeakRef !== 'undefined') decodedInboxSummaries.set(parts, new WeakRef(rows));
  return rows;
}
export async function listErpCostInbox({ ledgerId = null, statuses = ["pending", "loaded"], displayOnly = false } = {}) {
  const allowed = new Set(["pending", "loaded", "applied", "rejected", "voided"]);
  const statusSet = new Set((Array.isArray(statuses) ? statuses : []).filter((status) => allowed.has(status)));
  const query = ledgerId ? db.erpCostInbox.where("ledgerId").equals(ledgerId) : db.erpCostInbox.toCollection();
  let rows;
  if (displayOnly) {
    const read = async () => {
      const summaries = [];
      await query.each(row => { if (!statusSet.size || statusSet.has(row.status)) summaries.push(erpInboxSummary(row)); });
      return summaries;
    };
    rows = Dexie.currentTransaction ? await read() : await retrySourceRead(async () => {
      await Promise.all([db.erpCostInbox.count(), observeTableRevision('erpCostInbox')]);
      const reader = inboxRevision() ? inboxRevision : sourceRevision, revision = reader();
      const ledgers = ledgerId ? [await db.ledgers.get(ledgerId)].filter(Boolean) : await db.ledgers.toArray();
      const parents = new Map(ledgers.map(ledger => [ledger.id, ledger]));
      const packed = await cachedDerived({ scope: [ledgerId, ledgers.map(row => [row.workspaceId, row.id, row.period])], formula: 'erp-inbox-display@4', revisionReader: reader, revision, compute: () => packDisplayInboxes(query, parents) });
      const summaries = await unpackDisplayInboxes(packed);
      assertSourceRevision(revision, reader);
      return summaries;
    });
  } else rows = await query.toArray();
  return rows
    .filter((row) => statusSet.size === 0 || statusSet.has(row.status))
    .toSorted((left, right) => String(left.sentAt ?? left.receivedAt ?? "").localeCompare(String(right.sentAt ?? right.receivedAt ?? "")));
}

export async function markErpCostInboxStatus(id, status, metadata = {}) {
  const allowed = new Set(["pending", "loaded"]);
  if (!allowed.has(status)) throw new Error("ERP 收件状态无效。");
  const current = await db.erpCostInbox.get(id);
  if (!current) throw new Error("找不到 ERP 收件批次。");
  if (!["pending", "loaded"].includes(current.status)) {
    throw new Error("已处理的 ERP 收件批次不能重新进入待处理状态。");
  }
  await db.erpCostInbox.put({ ...current, ...metadata, status, updatedAt: new Date().toISOString() });
  return { ...current, ...metadata, status };
}

export async function rejectErpCostInboxBatches({ ids, rejectedBy = "local-user" } = {}) {
  const inboxIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (inboxIds.length === 0) throw new Error("请选择要删除的 ERP 收件批次。");
  const targetLedgers = new Set((await db.erpCostInbox.bulkGet(inboxIds)).filter(Boolean).map(row => row.ledgerId));
  for (const ledgerId of targetLedgers) await assertLedgerCostEditingReady(ledgerId);
  const rejectedAt = new Date().toISOString();
  const auditActor = await resolveProfitAuditActor(rejectedBy);
  const loadedIds = [];

  await db.transaction("rw", db.ledgers, db.erpCostInbox, db.auditEvents, async () => {
    const records = await db.erpCostInbox.bulkGet(inboxIds);
    if (records.some((record) => !record)) throw new Error("部分 ERP 收件批次已不存在，请刷新后重试。");
    for (const record of records) {
      if (!["pending", "loaded"].includes(record.status) || record.appliedBatchId) {
        throw new Error("只有待处理或已载入的 ERP 批次可以删除。");
      }
      const ledger = operatingLedger(await db.ledgers.get(record.ledgerId));
    }

    for (const record of records) {
      if (record.status === "loaded") loadedIds.push(record.id);
      const rejected = {
        ...record,
        status: "rejected",
        rejectedAt,
        rejectedBy: auditActor,
        updatedAt: rejectedAt,
      };
      await db.erpCostInbox.put(rejected);
      await db.auditEvents.add({
        workspaceId: record.workspaceId,
        objectType: "erp_cost_inbox",
        objectId: record.id,
        action: "rejected",
        actorId: auditActor,
        createdAt: rejectedAt,
        before: { status: record.status, batchId: record.batchId, ledgerId: record.ledgerId },
        after: { status: "rejected", batchId: record.batchId, ledgerId: record.ledgerId },
      });
    }
  });

  return { rejectedCount: inboxIds.length, loadedIds };
}

export async function switchLoadedErpCostInbox({ candidateId, previousId = null, switchedAt = new Date().toISOString() } = {}) {
  const candidateKey = String(candidateId ?? "").trim();
  const previousKey = String(previousId ?? "").trim();
  if (!candidateKey) throw new Error("ERP 待载入批次不能为空。");
  if (previousKey && previousKey === candidateKey) return db.erpCostInbox.get(candidateKey);

  return db.transaction("rw", db.erpCostInbox, async () => {
    const candidate = await db.erpCostInbox.get(candidateKey);
    if (!candidate) throw new Error("找不到待载入的 ERP 收件批次。");
    const stateChanged = () => Object.assign(new Error("当前载入状态已变化，请刷新待处理列表后重试。"), { code: "ERP_INBOX_STATE_CHANGED" });
    if (!["pending", "loaded"].includes(candidate.status)) throw stateChanged();

    const previous = previousKey ? await db.erpCostInbox.get(previousKey) : null;
    if (previousKey && (!previous || previous.status !== "loaded")) {
      throw stateChanged();
    }
    if (previous && (previous.ledgerId !== candidate.ledgerId || previous.workspaceId !== candidate.workspaceId)) {
      throw new Error("ERP 收件批次不属于同一工作区和账本，不能切换。");
    }

    const otherLoaded = (await db.erpCostInbox.where("ledgerId").equals(candidate.ledgerId).toArray())
      .find((record) => record.status === "loaded" && record.id !== candidateKey && record.id !== previousKey);
    if (otherLoaded) throw stateChanged();

    const loadedCandidate = { ...candidate, status: "loaded", loadedAt: switchedAt, updatedAt: switchedAt };
    await db.erpCostInbox.put(loadedCandidate);
    if (previous) {
      await db.erpCostInbox.put({
        ...previous,
        status: "pending",
        unloadedAt: switchedAt,
        unloadReason: "switched_batch",
        updatedAt: switchedAt,
      });
    }
    return loadedCandidate;
  });
}

export async function listErpCostRequests(ledgerId) {
  const requests = ledgerId
    ? await db.erpCostRequests.where("ledgerId").equals(ledgerId).toArray()
    : await db.erpCostRequests.toArray();
  return requests.toSorted((left, right) => String(right.requestedAt ?? right.createdAt ?? "").localeCompare(String(left.requestedAt ?? left.createdAt ?? "")));
}

export async function getLatestErpCostRequest(ledgerId) {
  return (await listErpCostRequests(ledgerId))[0] ?? null;
}

export async function updateLedgerWarehouseRate(ledgerId, warehouseRate, updatedBy = "local-user", expectedAccountingMode) {
  const rate = Number(warehouseRate);
  if (!Number.isFinite(rate) || rate < 0) throw new Error("仓储费率必须大于或等于 0。");
  const updatedAt = new Date().toISOString();
  const auditActor = await resolveProfitAuditActor(updatedBy);

  await db.transaction("rw", db.settings, db.ledgers, db.auditEvents, async () => {
    const ledger = operatingLedger(await db.ledgers.get(ledgerId));
    if (!ledger) throw new Error("找不到对应的月度账本。");
    const member = await getActiveMemberContext();
    if (ledger.workspaceId !== member.workspaceId || !['admin','finance'].includes(member.role)) throw new Error('当前成员无此账本的财务写权限。');
    const mode = await readAccountingMode(ledger.workspaceId);
    if (expectedAccountingMode != null && mode !== expectedAccountingMode) throw new Error('核算上下文已变化，请重新打开仓储费率。');
    const current = await projectAccountingLedger(ledger, mode);
    const savedLedger = { ...ledger, warehouseRate: rate, updatedAt };
    await db.ledgers.put(savedLedger);
    await db.settings.delete(accountingRateKey(ledger));
    await db.auditEvents.add({
      workspaceId: ledger.workspaceId,
      objectType: "monthly_ledger",
      objectId: ledgerId,
      action: "warehouse_rate_updated",
      actorId: auditActor,
      createdAt: updatedAt,
      before: { warehouseRate: current.warehouseRate },
      after: {
        warehouseRate: rate,
        snapshot: savedLedger,
      },
    });
  });
}

export async function finalizeMonthlyLedger({ ledgerId, profitLines, formulaVersion, expectedFingerprint } = {}) {
  const { previewProfitReport, saveProfitReport } = await import("./profitReportRepository");
  const input = { ledgerId, kind: "pre_deduction", expectedLegacyLines: profitLines, legacyFormulaVersion: formulaVersion };
  const preview = await previewProfitReport(input);
  if (expectedFingerprint && expectedFingerprint !== preview.fingerprint) throw new Error("成本或台账已变化，请刷新后重新预览。");
  return saveProfitReport(input, { expectedFingerprint: expectedFingerprint ?? preview.fingerprint });
}

export async function getLatestLedgerCosts(ledgerId) {
  return readOwnedLedgerCosts(await db.ledgers.get(ledgerId));
}

async function readOwnedLedgerCosts(ledger) {
  if (!ledger?.workspaceId) return [];
  const ledgerId = ledger.id;
  if (Dexie.currentTransaction) return readLatestLedgerCosts(ledgerId, ledger.workspaceId);
  await observePublishedCostRevision();
  return cachedDerived({ scope: [ledgerId,ledger.workspaceId], formula: 'published-ledger-costs@2-owned', revisionReader: publishedCostRevision,
    revision: publishedCostRevision(), persist: false, compute: () => readLatestLedgerCosts(ledgerId, ledger.workspaceId) });
}

const profitPageCostOrigins = new WeakMap();
let recentResolutionIndex;
async function scanProfitPageCosts(ledger, includeCosts, indexedInTransaction = false) {
  const batches = db.erpCostBatches;
  const [ledgerIds, ownedIds, scopedIds, publishedIds] = await Promise.all([
    batches.where('ledgerId').equals(ledger.id).primaryKeys(),
    batches.where('workspaceId').equals(ledger.workspaceId).primaryKeys(),
    batches.where('workspaceId').above('').primaryKeys(),
    batches.where('status').equals('published').primaryKeys(),
  ]);
  const owned = new Set(ownedIds), scoped = new Set(scopedIds), published = new Set(publishedIds);
  const allowed = new Set(ledgerIds.filter(id => owned.has(id) || !scoped.has(id)));
  if (!includeCosts) {
    const publishedIds = [...allowed].filter(id => published.has(id));
    return { costs: [], resolutionIndex: await completeProfitResolutionIndex(ledger, {publishedIds, resolutions: []}) };
  }
  if (includeCosts && (!Dexie.currentTransaction || indexedInTransaction)) {
    const indexed = await readIndexedProfitCosts(ledger, allowed, published);
    if (indexed) return indexed;
  }
  const latest = new Map(), resolutions = [];
  await forEachLedgerChunk(db.erpCostRows, ledger.id, 16, row => {
    if ((row.workspaceId && row.workspaceId !== ledger.workspaceId) || !allowed.has(row.batchId)) return;
    if (row.resolutions?.length && published.has(row.batchId)) {
      resolutions.push({ id: row.id, batchId: row.batchId, sourceEnvelopeBatchId: row.sourceEnvelopeBatchId, resolutions: row.resolutions });
    }
    const sku = row.canonicalPlatformSku ?? canonicalPlatformSku(row.platformSku);
    const previous = latest.get(sku);
    if (previous) previous.firstId = row.id;
    if (previous && comparePublishedRows(previous, row) > 0) return;
    // The page's period check uses purchase records and explicit evidence failures.
    // Legacy evidence references are reconstructed only when the purchase detail is opened.
    latest.set(sku, { firstId: row.id, id: row.id, publishedAt: row.publishedAt,
      cost: published.has(row.batchId) ? profitCostFields(row, ledger.period) : null });
  }, { newestFirst: true });
  return { costs: [...latest.values()].sort((a,b) => a.firstId-b.firstId).flatMap(entry => entry.cost ? [entry.cost] : []),
    resolutionIndex: { publishedIds: [...allowed].filter(id => published.has(id)), resolutions: resolutions.reverse() } };
}

async function readProfitPageCosts(ledger) {
  if (Dexie.currentTransaction) return (await scanProfitPageCosts(ledger, true)).costs;
  await observePublishedCostRevision();
  const revision = publishedCostRevision();
  const packed = await cachedDerived({ scope: [ledger.workspaceId, ledger.id, ledger.period], formula: 'profit-page-costs@6-unit-fractions',
    revisionReader: publishedCostRevision, revision, compute: async () => {
      const capture = readActionCosts.capture(ledger);
      const result = await scanProfitPageCosts(ledger, true);
      if (capture) capture(result.costs.map(({purchaseSearchText, ...cost}) => structuredClone(cost)));
      try { return await packProfitSearch(result); } catch { return result; }
    } });
  let projection;
  try { projection = await unpackProfitSearch(packed); }
  catch { projection = await scanProfitPageCosts(ledger, true); }
  assertSourceRevision(revision, publishedCostRevision);
  const { costs, resolutionIndex } = projection;
  if (recentResolutionIndex?.revision !== revision || recentResolutionIndex.ledgerId !== ledger.id
    || recentResolutionIndex.workspaceId !== ledger.workspaceId || recentResolutionIndex.value.unchecked?.length) {
    recentResolutionIndex = { workspaceId: ledger.workspaceId, ledgerId: ledger.id, revision, value: resolutionIndex };
  }
  for (const cost of costs) profitPageCostOrigins.set(cost, { workspaceId: ledger.workspaceId, ledgerId: ledger.id, id: cost.id, batchId: cost.batchId, sku: canonicalPlatformSku(cost.platformSku), revision });
  return costs;
}

export async function getProfitPageCostEvidence({ workspaceId, ledgerId, platformSku, id, batchId, mode, selection }) {
  return retrySourceRead(async () => {
    const member = await getActiveMemberContext(), ledger = await db.ledgers.get(ledgerId);
    if (!ledger || member.workspaceId !== workspaceId || ledger.workspaceId !== workspaceId) return null;
    if (await readAccountingMode(workspaceId) !== mode) return null;
    const sku = canonicalPlatformSku(platformSku);
    if (mode === LOWEST_ACCOUNTING) {
      await observeInventoryRevision(true);
      const revision = inventoryEvidenceRevision();
      const minimum = (await readHistoricalLowestCosts(workspaceId)).find(row => row.id === id && canonicalPlatformSku(row.platformSku) === sku);
      if (!minimum) return null;
      const purchaseReview = await readLowestPurchaseReview(workspaceId, minimum, ledger.period);
      assertSourceRevision(revision, inventoryEvidenceRevision);
      return { ...minimum, purchaseReview };
    }
    await observePublishedCostRevision();
    const revision = publishedCostRevision();
    const origin = selection && profitPageCostOrigins.get(selection);
    if (origin) {
      if (origin.revision !== revision || origin.workspaceId !== workspaceId || origin.ledgerId !== ledgerId || origin.sku !== sku || origin.id !== id || origin.batchId !== batchId) return null;
    } else {
      const current = (await readProfitPageCosts(ledger)).find(row => canonicalPlatformSku(row.platformSku) === sku);
      if (!current || current.id !== id || current.batchId !== batchId) return null;
    }
    const row = await db.erpCostRows.get(id);
    if (!row || canonicalPlatformSku(row.platformSku) !== sku || row.ledgerId !== ledgerId || row.batchId !== batchId || (row.workspaceId && row.workspaceId !== workspaceId)) return null;
    const proven = row.evidenceRef && row.evidenceComplete === true ? row : projectPublishedCostEvidence(row, await db.erpCostBatches.get(batchId));
    assertSourceRevision(revision, publishedCostRevision);
    return proven;
  });
}

async function readLatestLedgerCosts(ledgerId, workspaceId) {
  return db.transaction('r', db.erpCostRows, db.erpCostBatches, async () => {
    const [ids, batches] = await Promise.all([
      db.erpCostRows.where('ledgerId').equals(ledgerId).primaryKeys(),
      readAdoptionBatchHeaders(ledgerId, { indexed: true }),
    ]);
    // Both report checks need the current transaction's own keys, including a
    // same-count change to a row's SKU, publication date or ownership.
    let headers = await readActionHeaderIndex({ id: ledgerId }, ids, { fresh: true });
    if (!headers) {
      headers = new Map();
      await readCostIds(ids, row => {
        headers.set(row.id, { workspaceId: row.workspaceId, batchId: row.batchId, platformSku: row.platformSku,
          canonicalSku: row.canonicalPlatformSku, publishedAt: row.publishedAt });
      });
    }
    const ordered = [];
    for (const id of ids) {
      const header = headers.get(id);
      const batch = batches.get(header.batchId);
      if (!batch || (batch.workspaceId && batch.workspaceId !== workspaceId) || (header.workspaceId && header.workspaceId !== workspaceId)) continue;
      ordered.push({ id, publishedAt: header.publishedAt, sku: header.canonicalSku ?? canonicalPlatformSku(header.platformSku), published: batch.status === 'published' });
    }
    const latest = new Map();
    // Insertion order is part of the report fingerprint. A voided latest
    // publication suppresses an older value for the same SKU.
    for (const row of ordered.sort(comparePublishedRows)) latest.set(row.sku, row);
    const winners = [...latest.values()].filter(row => row.published);
    const rows = new Map(), legacyByBatch = new Map();
    await readCostIds(winners.map(row => row.id).sort(Dexie.cmp), row => {
      rows.set(row.id, row);
      if (row.evidenceRef && row.evidenceComplete === true) return;
      if (!legacyByBatch.has(row.batchId)) legacyByBatch.set(row.batchId, []);
      legacyByBatch.get(row.batchId).push(row);
    });
    for (const [batchId, legacy] of legacyByBatch) {
      const batch = await db.erpCostBatches.get(batchId);
      for (const row of legacy) rows.set(row.id, projectPublishedCostEvidence(row, batch));
    }
    return winners.map(row => rows.get(row.id));
  });
}

function samePurchaseEvidence(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((record, index) => {
    const source = right[index];
    return String(record.recordId ?? "") === String(source?.recordId ?? "")
      && String(record.purchaseDate ?? "") === String(source?.purchaseDate ?? "")
      && Number(record.quantity) === Number(source?.quantity)
      && Number(record.unitPrice) === Number(source?.unitPrice);
  });
}

function projectPublishedCostEvidence(row, batch) {
  if (row.evidenceRef && row.evidenceComplete === true) return row;
  const contract = batch?.sourceContract;
  if (batch?.status !== "published"
    || contract?.formatVersion !== ERP_COST_BATCH_VERSION
    || !contract.batchId
    || String(row.sourceEnvelopeBatchId ?? "") !== String(contract.batchId)
    || String(contract.requestId ?? "") !== String(batch.requestId ?? "")
    || String(row.workspaceId ?? "") !== String(batch.workspaceId ?? "")
    || String(row.ledgerId ?? "") !== String(batch.ledgerId ?? "")
    || row.evidenceComplete === false
    || row.costDecision?.evidenceComplete !== true
    || row.resolutionStatus !== "resolved"
    || (row.sourceWarnings ?? []).length > 0
    || !row.warehouseSku
    || !row.platformSkc) return row;
  const queriedSkcs = contract.query?.platformSkcs;
  if (!Array.isArray(queriedSkcs)
    || !queriedSkcs.some((item) => (item?.platformSkc ?? item)
      && canonicalPlatformSkc(item?.platformSkc ?? item) === canonicalPlatformSkc(row.platformSkc))) return row;
  const warehouseSku = canonicalWarehouseSku(row.warehouseSku);
  const evidence = Array.isArray(contract.warehouseEvidence)
    ? contract.warehouseEvidence.filter((entry) => entry?.warehouseSku && canonicalWarehouseSku(entry.warehouseSku) === warehouseSku)
    : [];
  if (evidence.length !== 1 || evidence[0].evidenceComplete !== true || (evidence[0].sourceWarnings ?? []).length > 0) return row;
  const evidenceRef = `warehouse:${warehouseSku}`;
  if (evidence[0].evidenceRef !== evidenceRef || (row.evidenceRef && row.evidenceRef !== evidenceRef)) return row;
  if (!samePurchaseEvidence(row.purchaseRecords, evidence[0].purchaseRecords)
    || !samePurchaseEvidence(row.excludedRecords ?? [], evidence[0].excludedRecords ?? [])) return row;
  return { ...row, evidenceRef, evidenceComplete: true };
}

export async function reopenLedgerForCostCorrection({ ledgerId, reason } = {}) {
  const normalizedReason = String(reason ?? "").trim();
  if (!normalizedReason) throw new Error("重开账本必须填写原因。");
  return db.transaction("rw", db.settings, db.ledgers, db.salesRows, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.profitLines, db.auditEvents, async () => {
    const member = await getActiveMemberContext();
    const ledger = await db.ledgers.get(ledgerId);
    if (!ledger || ledger.workspaceId !== member.workspaceId || !["admin", "finance"].includes(member.role)) throw new Error("当前成员无此账本的财务写权限。");
    if (ledger.status !== "finalized") throw new Error("只有已定稿且未锁定的账本可以重开。");
    const profitLines = await db.profitLines.where("ledgerId").equals(ledgerId).toArray();
    if (!profitLines.length || !ledger.profitSummary) throw new Error("定稿快照缺失，不能重开账本。");
    const updatedAt = new Date().toISOString();
    const { profitSummary: _summary, finalizedAt: _at, finalizedBy: _by, formulaVersion: _formula, currentBaseReportId: _base, ...draft } = ledger;
    const coverage = await readLedgerCostCoverage(ledgerId);
    const savedLedger = { ...draft, ...buildLedgerCoveragePatch(draft, coverage, updatedAt), reportReopenReason: normalizedReason };
    await db.auditEvents.add({
      workspaceId: ledger.workspaceId, objectType: ledger.currentBaseReportId ? "local_profit_report" : "monthly_ledger", objectId: ledgerId,
      ...(ledger.currentBaseReportId ? { localOnly: true, syncState: "local_only" } : {}),
      action: "ledger_reopened_for_cost_correction", actorId: member.memberId, createdAt: updatedAt,
      before: { status: ledger.status, snapshot: { ledger, profitLines } },
      after: { status: savedLedger.status, reason: normalizedReason, snapshot: savedLedger },
    });
    await db.profitLines.where("ledgerId").equals(ledgerId).delete();
    await db.ledgers.put(savedLedger);
    return savedLedger;
  });
}

export async function voidPublishedErpCostBatch({
  inboxId,
  reason,
  voidedBy = "local-user",
} = {}) {
  const normalizedInboxId = String(inboxId ?? "").trim();
  const normalizedReason = String(reason ?? "").trim();
  const normalizedActor = await resolveProfitAuditActor(voidedBy);
  if (!normalizedInboxId) throw new Error("请选择要撤回采用的 ERP 批次。");
  if (!normalizedReason) throw new Error("撤回采用必须填写原因。");
  const targetInbox = await db.erpCostInbox.get(normalizedInboxId);
  if (targetInbox) await assertLedgerCostEditingReady(targetInbox.ledgerId);
  const voidedAt = new Date().toISOString();
  let result = null;

  await db.transaction(
    "rw",
    db.settings,
    db.ledgers,
    db.salesRows,
    db.erpCostInbox,
    db.erpCostBatches,
    db.erpCostRows,
    db.costApprovals,
    db.profitLines,
    db.auditEvents,
    async () => {
      const inbox = await db.erpCostInbox.get(normalizedInboxId);
      if (!inbox || !["applied", "pending", "loaded"].includes(inbox.status) || !inbox.appliedBatchId) {
        throw new Error("只有已采用且尚未撤回的 ERP 批次可以撤回。");
      }
      const batch = await db.erpCostBatches.get(inbox.appliedBatchId);
      if (!batch || batch.status !== "published" || batch.ledgerId !== inbox.ledgerId) {
        throw new Error("找不到与收件记录关联的已采用 ERP 成本。");
      }
      let ledger = await db.ledgers.get(batch.ledgerId);
      if (!ledger) throw new Error("找不到对应的月度账本。");
      const member = await getActiveMemberContext();
      if (ledger.workspaceId !== member.workspaceId || !["admin", "finance"].includes(member.role)) throw new Error("当前成员无此账本的财务写权限。");
      const reopened = ledger.status === "finalized";
      // Keep frozen report files intact; reopen and withdraw in one transaction.
      if (ledger.currentBaseReportId && reopened) {
        ledger = await reopenLedgerForCostCorrection({ ledgerId: ledger.id, reason: normalizedReason });
      }

      const batchRows = await db.erpCostRows.where("batchId").equals(batch.id).toArray();
      const previousProfitLines = ledger.status === "finalized"
        ? await db.profitLines.where("ledgerId").equals(ledger.id).toArray()
        : [];
      const voidedBatch = {
        ...batch,
        status: "voided",
        voidedAt,
        voidedBy: normalizedActor,
        voidReason: normalizedReason,
      };
      const voidedInbox = {
        ...inbox,
        status: "voided",
        voidedAt,
        voidedBy: normalizedActor,
        voidReason: normalizedReason,
        voidedBatchId: batch.id,
        updatedAt: voidedAt,
      };
      await db.erpCostBatches.put(voidedBatch);
      await db.erpCostInbox.put(voidedInbox);

      const coverage = await readLedgerCostCoverage(ledger.id);
      const {
        profitSummary: _profitSummary,
        finalizedAt: _finalizedAt,
        finalizedBy: _finalizedBy,
        lockedAt: _lockedAt,
        lockedBy: _lockedBy,
        formulaVersion: _formulaVersion,
        ...reopenedLedger
      } = ledger;
      const savedLedger = {
        ...reopenedLedger,
        ...buildLedgerCoveragePatch(reopenedLedger, coverage, voidedAt),
      };
      if (ledger.status === "finalized") {
        await db.profitLines.where("ledgerId").equals(ledger.id).delete();
      }
      await db.ledgers.put(savedLedger);
      const transitionId = buildErpVoidTransitionId({ batchId: batch.id, ledgerId: ledger.id, voidedAt });

      await db.auditEvents.add({
        workspaceId: ledger.workspaceId,
        objectType: "erp_cost_batch",
        objectId: batch.id,
        action: "voided",
        actorId: normalizedActor,
        createdAt: voidedAt,
        before: {
          status: batch.status,
          ledgerStatus: ledger.status,
          affectedPlatformSkus: batchRows.map((row) => row.platformSku),
        },
        after: {
          status: "voided",
          reason: normalizedReason,
          transitionId,
          voidedBatchId: batch.id,
          ledgerStatus: savedLedger.status,
          missingCount: coverage.missingCount,
          snapshot: { costBatch: voidedBatch, inbox: voidedInbox, ledger: savedLedger },
        },
      });
      if (ledger.status === "finalized") {
        await db.auditEvents.add({
          workspaceId: ledger.workspaceId,
          objectType: "monthly_ledger",
          objectId: ledger.id,
          action: "reopened_for_cost_recalculation",
          actorId: normalizedActor,
          createdAt: voidedAt,
          before: {
            status: ledger.status,
            reason: normalizedReason,
            snapshot: { ledger, profitLines: previousProfitLines },
          },
          after: {
            status: savedLedger.status,
            reason: normalizedReason,
            transitionId,
            voidedBatchId: batch.id,
            missingCount: coverage.missingCount,
            snapshot: savedLedger,
          },
        });
      }
      result = {
        inboxId: inbox.id,
        batchId: batch.id,
        ledgerId: ledger.id,
        ledgerStatus: savedLedger.status,
        affectedPlatformSkus: batchRows.map((row) => row.platformSku),
        missingCount: coverage.missingCount,
        reopened,
      };
    },
  );
  return result;
}

export async function getLedgerSnapshot(ledgerId, options = {}) {
  const read = () => retrySourceRead(() => readLedgerSnapshot(ledgerId, options));
  return options.profitPage ? withProfitRead(read) : read();
}

async function readLedgerSnapshot(ledgerId, { summaryOnly = false, profitPage = false } = {}) {
  await observeLedgerSnapshotRevision();
  const dataVersion = ledgerSnapshotRevision();
  const original = await db.ledgers.get(ledgerId);
  const ledger = operatingLedger(original);
  if (!ledger) return null;
  const member = await getActiveMemberContext();
  if (ledger.workspaceId !== member.workspaceId) return null;
  const accountingMode = await readAccountingMode(ledger.workspaceId);
  const [sales, batches, originalCosts, approvals, profitLines] = await Promise.all([
    profitPage ? readProfitPageSales(ledger) : readLedgerSalesRows(member.workspaceId, ledgerId),
    summaryOnly ? [] : db.importBatches.where("ledgerId").equals(ledgerId).toArray(),
    accountingMode === LOWEST_ACCOUNTING ? [] : profitPage ? readProfitPageCosts(ledger) : readOwnedLedgerCosts(ledger),
    db.costApprovals.where("ledgerId").equals(ledgerId).toArray(),
    summaryOnly || profitPage ? [] : db.profitLines.where("ledgerId").equals(ledgerId).toArray(),
  ]);
  const rows = profitPage ? sales.rows : sales;
  Object.assign(ledger, await projectAccountingLedger(ledger, accountingMode));
  await observeInventoryRevision(false, accountingMode);
  const calculationReader = accountingMode === LOWEST_ACCOUNTING ? inventoryLowestRevision : inventoryCalculationRevision;
  const calculationRevision = calculationReader();
  const accountingRows = await accountingCosts(ledger, originalCosts, accountingMode, rows);
  const costs = profitPage && accountingMode === LOWEST_ACCOUNTING ? accountingRows.map(row => profitCostFields(row, null)) : accountingRows;
  // Compute alternate accounting only when selected. Loading this month must
  // not wait for a second, workspace-wide history projection.
  assertSourceRevision(dataVersion, ledgerSnapshotRevision);
  // Older live ledgers may have a ready summary written before parent identity
  // checks existed. Project current readiness without mutating business data or
  // touching any frozen report/snapshot during an upgrade or ordinary read.
  const coverage = await cachedDerived({ scope: [ledger.workspaceId, ledger.id, ledger.period, accountingMode],
    formula: profitPage ? 'profit-page-coverage@2-shared-manual' : 'inventory-cost-coverage@4-shared-manual', revisionReader: calculationReader, revision: calculationRevision, persist: profitPage,
    compute: () => runDerivedComputation(profitPage ? 'profit-page-coverage' : 'cost-coverage', { salesRows: rows, erpCosts: costs, approvals,
      workspaceId: ledger.workspaceId, ledgerId: ledger.id, period: costEvaluationPeriod(ledger), accountingMode }) });
  assertSourceRevision(dataVersion, ledgerSnapshotRevision);
  const snapshotLedger = {
    ...ledger,
    ...buildLedgerCoveragePatch(ledger, coverage, ledger.updatedAt),
  };
  assertSourceRevision(calculationRevision, calculationReader);
  return { ledger: snapshotLedger, rows, batches, costs, approvals: accountingApprovals(approvals, accountingMode), profitLines, ...(profitPage ? { profitPage: true, pageSales: sales } : {}), dataVersion: calculationRevision, revisionKind: accountingMode === LOWEST_ACCOUNTING ? 'inventory-lowest' : 'inventory' };
}

export async function getLatestLedgerSnapshot(options) {
  const member = await getActiveMemberContext();
  if (!member.workspaceId) return null;
  const ledger = (await db.ledgers.where("workspaceId").equals(member.workspaceId).sortBy("updatedAt")).at(-1);
  return ledger ? getLedgerSnapshot(ledger.id, options) : null;
}

export async function listLedgerSummaries() {
  const member = await getActiveMemberContext();
  return (await db.ledgers.where("workspaceId").equals(member.workspaceId).reverse().sortBy("period")).map(operatingLedger);
}

export async function withVerifiedLedgerCostSummaries(ledgers) {
  return retrySourceRead(async () => {
    await observeSourceRevision();
    const revision = selectionFactsRevision();
    const member = await getActiveMemberContext();
    if (ledgers.some(ledger => ledger.workspaceId !== member.workspaceId)) throw new Error('账本成本摘要不属于当前工作区。');
    const mode = await readAccountingMode(member.workspaceId);
    const projected = await Promise.all(ledgers.map(async original => {
      const ledger = operatingLedger(original);
      if (mode === 'historical_lowest') return (await getLedgerSnapshot(ledger.id, { summaryOnly: true, profitPage: true }))?.ledger ?? ledger;
      if (ledger.costSummary?.identityPolicyVersion === LEDGER_COST_IDENTITY_VERSION) return ledger;
      if (ledger.costSummary?.identityPolicyVersion === 'ledger-cost-identity@1') {
        // A weighted summary from the previous version is still valid if there
        // were no separate manual records to bring over from lowest mode.
        const legacy = await db.costApprovals.where('ledgerId').equals(ledger.id).filter(row =>
          row.workspaceId === ledger.workspaceId && row.accountingMode === LOWEST_ACCOUNTING && manualSnapshot(row)?.kind === 'manual_override').first();
        if (!legacy) return ledger;
      }
      const coverage = await cachedDerived({ scope: [ledger.workspaceId, ledger.id], formula: 'ledger-cost-summary@2-shared-manual',
        revision, revisionReader: selectionFactsRevision, persist: false, compute: async () => {
          const saleIdentities = new Map(), latest = new Map(), batchStates = new Map();
          let needsOwnershipProof = false, invalidSales = false, foreignSales = false, foreignBatch = false, foreignCost = false;
          await db.salesRows.where('ledgerId').equals(ledger.id).each(row => {
            if (row.workspaceId && row.workspaceId !== ledger.workspaceId) { foreignSales = true; return; }
            if (!row.workspaceId) needsOwnershipProof = true;
            // Historical sales rows may carry only ledgerId. The owned ledger
            // proves their scope; this read projection never rewrites the row.
            const sku = String(row.platformSku ?? row.sku ?? '').normalize('NFKC').trim();
            if (!sku) { invalidSales = true; return; }
            const skc = String(row.platformSkc ?? '').normalize('NFKC').trim();
            const identityKey = JSON.stringify([storeIdentity(row.store), canonicalPlatformSku(sku), skc ? canonicalPlatformSkc(skc) : '']);
            saleIdentities.set(identityKey, { workspaceId: ledger.workspaceId, ledgerId: row.ledgerId,
              store: row.store, platformSku: row.platformSku ?? row.sku, platformSkc: row.platformSkc });
          });
          if (foreignSales) throw new Error('台账存在跨工作区来源记录，请恢复完整备份后再核算。');
          if (invalidSales) throw new Error('台账来源缺少平台 SKU，请核对导入记录后再核算。');
          const salesRows = [...saleIdentities.values()];
          // Summary-only legacy fixtures/records have no identity evidence to
          // reassess. Preserve them rather than inventing an empty-ledger state.
          if (!salesRows.length) return null;
          if (needsOwnershipProof && (await db.ledgers.get(ledger.id))?.workspaceId !== ledger.workspaceId) throw new Error('缺少销售行所属工作区的账本依据，请恢复完整备份后再核算。');
          await db.erpCostBatches.where('ledgerId').equals(ledger.id).each(batch => {
            if (batch.workspaceId && batch.workspaceId !== ledger.workspaceId) { foreignBatch = true; return; }
            batchStates.set(batch.id, batch.status);
          });
          if (foreignBatch) throw new Error('ERP 成本批次不属于当前账本工作区。');
          await db.erpCostRows.where('ledgerId').equals(ledger.id).each(row => {
            if (row.workspaceId && row.workspaceId !== ledger.workspaceId) { foreignCost = true; return; }
            const sku = canonicalPlatformSku(row.platformSku), previous = latest.get(sku);
            const order = previous ? String(row.publishedAt ?? '').localeCompare(String(previous.publishedAt ?? '')) || Number(row.id ?? 0) - Number(previous.id ?? 0) : 1;
            if (order < 0) return;
            // Consume period evidence while visiting the stored row; keep only
            // the small identity/amount projection in the derived cache path.
            latest.set(sku, { id: row.id, batchId: row.batchId, platformSku: row.platformSku, platformSkc: row.platformSkc,
              unitCost: row.unitCost, resolutionStatus: row.resolutionStatus, unresolvedAnomalyCount: row.unresolvedAnomalyCount,
              publishedAt: row.publishedAt, periodVerified: isErpCostWithinPeriod(row, ledger.period) });
          });
          if (foreignCost) throw new Error('ERP 成本记录不属于当前账本工作区。');
          const identities = buildLedgerSkuIdentityIndex(salesRows);
          const currentCosts = [...latest.values()].filter(row => batchStates.get(row.batchId) === 'published');
          const erpCosts = currentCosts.filter(row => row.periodVerified);
          const approvals = [];
          await db.costApprovals.where('ledgerId').equals(ledger.id).each(row => {
            if (row.workspaceId && row.workspaceId !== ledger.workspaceId) return;
            const snapshot = manualSnapshot(row);
            approvals.push({ id: row.id, workspaceId: row.workspaceId, ledgerId: row.ledgerId, platformSku: row.platformSku,
              accountingMode: row.accountingMode, sourceApprovalId: row.sourceApprovalId,
              status: row.status, approvedAmount: row.approvedAmount, unitCost: row.unitCost, currency: row.currency,
              approvedBy: row.approvedBy, approvedAt: row.approvedAt, reason: row.reason,
              referenceCost: snapshot && { kind: snapshot.kind, store: snapshot.store } });
          });
          // Period eligibility was already checked above, before discarding the
          // purchase payload. Coverage still owns manual priority and counts.
          const result = calculateLedgerCostCoverage({ salesRows, erpCosts, approvals, workspaceId: ledger.workspaceId, ledgerId: ledger.id });
          const currentBySku = new Map(currentCosts.map(row => [canonicalPlatformSku(row.platformSku), row]));
          result.identityIssues = result.unresolvedSkus.map(sku => ledgerCostIdentityIssue(identities.get(sku), currentBySku.get(sku))).filter(Boolean);
          return result;
        } });
      return coverage ? { ...ledger, ...buildLedgerCoveragePatch(ledger, coverage, ledger.updatedAt) } : ledger;
    }));
    assertSourceRevision(revision, selectionFactsRevision);
    return projected;
  });
}

export async function deleteMonthlyLedger(ledgerId, deletedBy = "local-user") {
  const auditActor = await resolveProfitAuditActor(deletedBy);
  await db.transaction(
    "rw",
    db.settings,
    db.ledgers,
    db.importBatches,
    db.salesRows,
    db.erpCostRequests,
    db.erpCostBatches,
    db.erpCostRows,
    db.erpCostInbox,
    db.costApprovals,
    db.profitLines,
    db.auditEvents,
    db.profitReports,
    db.profitReportLines,
    db.monthlySupplementBatches,
    db.monthlySupplementRows,
    async () => {
      const ledger = operatingLedger(await db.ledgers.get(ledgerId));
      if (!ledger) return;
      const member = await getActiveMemberContext();
      if (ledger.workspaceId !== member.workspaceId || !["admin", "finance"].includes(member.role)) throw new Error("当前成员无此账本的财务写权限。");
      await db.salesRows.where("ledgerId").equals(ledgerId).delete();
      await db.importBatches.where("ledgerId").equals(ledgerId).delete();
      await db.erpCostRequests.where("ledgerId").equals(ledgerId).delete();
      await db.erpCostRows.where("ledgerId").equals(ledgerId).delete();
      await db.erpCostInbox.where("ledgerId").equals(ledgerId).delete();
      await db.erpCostBatches.where("ledgerId").equals(ledgerId).delete();
      await db.costApprovals.where("ledgerId").equals(ledgerId).delete();
      await db.profitLines.where("ledgerId").equals(ledgerId).delete();
      await db.monthlySupplementRows.where("ledgerId").equals(ledgerId).delete();
      await db.monthlySupplementBatches.where("ledgerId").equals(ledgerId).delete();
      await db.profitReportLines.where("ledgerId").equals(ledgerId).delete();
      await db.profitReports.where("ledgerId").equals(ledgerId).delete();
      await db.ledgers.delete(ledgerId);
      await db.settings.delete(accountingRateKey(ledger));
      await db.auditEvents.add({
        workspaceId: ledger.workspaceId,
        objectType: "monthly_ledger",
        objectId: ledgerId,
        action: "deleted",
        actorId: auditActor,
        createdAt: new Date().toISOString(),
        before: { period: ledger.period, status: ledger.status },
      });
    },
  );
}
