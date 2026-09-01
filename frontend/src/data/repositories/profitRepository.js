import { calculateLedgerCostCoverage, ledgerStatusFromCoverage } from "../../domain/costCoverage";
import { resolveFormalCostDecision } from "../../domain/costPolicy";
import {
  canonicalPlatformSkc,
  canonicalPlatformSku,
  canonicalWarehouseSku,
  normalizePlatformSku,
} from "../../domain/identifiers";
import { summarizeLedgerRows } from "../../domain/ledgerImport";
import { ERP_COST_BATCH_VERSION, validateErpCostBatchEnvelope } from "../../domain/erpCostBatchEnvelope";
import { buildErpCostInboxEnvelope, validateErpCostInboxEnvelope } from "../../domain/erpInboxContract";
import { calculateWarehouseCostDecision } from "../../domain/erpCostResolution";
import { buildErpVoidTransitionId } from "../../domain/syncLifecycleGroup";
import { runtimeConfig } from "../../config/runtimeConfig";
import { db } from "../db/clientDatabase";
import {
  ACTIVE_MEMBER_CONTEXT_KEY,
  DEFAULT_MEMBER_ID,
  DEFAULT_WORKSPACE_ID,
  monthlyLedgerId,
  normalizeLedgerPeriod,
} from "../db/constants";
import { makeId } from "../db/utils";
import { ensureDefaultWorkspace } from "./selectionRepository";

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
async function readLedgerCostCoverage(ledgerId) {
  const [salesRows, erpCosts, approvals] = await Promise.all([
    db.salesRows.where("ledgerId").equals(ledgerId).toArray(),
    getLatestLedgerCosts(ledgerId),
    db.costApprovals.where("ledgerId").equals(ledgerId).toArray(),
  ]);
  return calculateLedgerCostCoverage({ salesRows, erpCosts, approvals });
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
      const existingLedger = await db.ledgers.get(ledgerId);
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
            salesRows: persistedRows,
            ledger: savedLedger,
          },
        },
      });
    },
  );

  return { batchId, ledgerId, replacedGroupCount, addedGroupCount };
}

export async function savePublishedErpCostBatch({
  ledgerId,
  reconciliation,
  inboxId = null,
  sourceName = "clipboard.tsv",
  inputHash = null,
  requestId = null,
  sourceEnvelope = null,
  workspaceId = DEFAULT_WORKSPACE_ID,
  publishedBy = "local-user",
}) {
  const batchId = makeId("COST");
  const publishedAt = new Date().toISOString();
  const auditActor = await resolveProfitAuditActor(publishedBy);
  const effectiveRequestId = String(sourceEnvelope?.requestId ?? requestId ?? "").trim() || null;
  if (!effectiveRequestId) {
    throw new Error("发布 ERP 成本前必须关联已记录的平台 SKC 查询请求。");
  }
  if (!sourceEnvelope) {
    throw new Error("发布 ERP 正式成本必须使用包含完整采购证据的 v2 批次；TSV、旧批次和页面汇总只能预览。");
  }
  const recordedRequest = await db.erpCostRequests.get(effectiveRequestId);
  if (!recordedRequest
    || String(recordedRequest.ledgerId ?? "") !== String(ledgerId)
    || String(recordedRequest.workspaceId ?? "") !== String(workspaceId)) {
    throw new Error("找不到与当前账本和工作区匹配的 ERP 成本请求，不能发布正式成本。");
  }
  const verifiedExpectedSkus = Array.isArray(recordedRequest.expectedSkus) && recordedRequest.expectedSkus.length > 0
    ? recordedRequest.expectedSkus
    : null;
  if (!verifiedExpectedSkus) {
    throw new Error("已记录的 ERP 成本请求缺少精确 expected SKU 范围，只能预览，不能发布正式成本。");
  }
  const validatedSource = validateErpCostBatchEnvelope(sourceEnvelope, {
    expectedWorkspaceId: workspaceId,
    expectedLedgerId: ledgerId,
    expectedRequestId: effectiveRequestId,
    expectedPlatformSkcs: recordedRequest.platformSkcs,
    expectedSkus: verifiedExpectedSkus,
  });
  const verifiedSourceEnvelope = validatedSource.envelope;
  if (verifiedSourceEnvelope.formatVersion !== ERP_COST_BATCH_VERSION || verifiedSourceEnvelope.evidenceStatus !== "complete") {
    throw new Error("发布 ERP 正式成本必须使用包含完整采购证据的 v2 批次；TSV、旧批次和页面汇总只能预览。");
  }
  const matchedRows = reconciliation.matches.filter((row) => row.status === "matched");
  if (reconciliation.matches.some((row) => row.status === "anomaly_pending")) {
    throw new Error("仍有采购成本异常或不完整证据未在 Shopeers 完成处置，不能发布为 ERP 正式成本。");
  }
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
    const sourceEvidence = row.sourceWarehouseSku
      ? sourceEvidenceByWarehouseSku.get(canonicalWarehouseSku(row.sourceWarehouseSku))
      : null;
    const purchaseRecords = sourceEvidence?.purchaseRecords ?? row.purchaseRecords;
    const evidenceComplete = sourceEvidence?.evidenceComplete ?? row.evidenceComplete;
    const decision = calculateWarehouseCostDecision({
      warehouseSku: row.sourceWarehouseSku,
      purchaseRecords,
      resolutions: row.resolutions,
      evidenceComplete,
      currentYearMonth: Number(verifiedSourceEnvelope.generatedAt.slice(0, 4)) * 100
        + Number(verifiedSourceEnvelope.generatedAt.slice(5, 7)),
    });
    if (decision.resolutionStatus !== "resolved" || decision.unresolvedAnomalyCount > 0 || !(decision.formalUnitCost > 0)) {
      throw new Error(`仓库 SKU ${row.sourceWarehouseSku || "未知"} 的采购证据或异常处置尚未满足正式成本要求。`);
    }
    if (!Number.isFinite(Number(row.unitCost)) || Math.abs(Number(row.unitCost) - decision.formalUnitCost) > 0.00005) {
      throw new Error(`仓库 SKU ${row.sourceWarehouseSku || "未知"} 的页面成本与仓储层独立复算结果不一致。`);
    }
    return {
      ...row,
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
  const manualInboxEnvelope = buildErpCostInboxEnvelope({
    batch: verifiedSourceEnvelope,
    deliveryId: manualDeliveryId,
    sentAt: publishedAt,
    transport: "manual-v2-import",
  });
  let appliedInboxId = null;
  await db.transaction("rw", db.ledgers, db.salesRows, db.erpCostRequests, db.erpCostInbox, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.auditEvents, async () => {
    const ledger = await db.ledgers.get(ledgerId);
    if (!ledger) throw new Error("找不到对应的月度账本。");
    if (["finalized", "locked"].includes(ledger.status)) throw new Error("已定稿或已锁定的账本不能直接更新成本。");
    if (String(workspaceId) !== String(ledger.workspaceId)) throw new Error("ERP 成本发布工作区与账本不一致。");
    const request = await db.erpCostRequests.get(effectiveRequestId);
    if (!request || String(request.ledgerId ?? "") !== String(ledgerId) || String(request.workspaceId ?? "") !== String(ledger.workspaceId)) {
      throw new Error("找不到与当前账本和工作区匹配的 ERP 成本请求，不能发布正式成本。");
    }
    const normalizedInboxId = String(inboxId ?? "").trim() || null;
    const sourceInboxRecords = await db.erpCostInbox.where("batchId").equals(verifiedSourceEnvelope.batchId).toArray();
    if (sourceInboxRecords.length > 1) {
      throw new Error("ERP 源批次关联了多个收件记录，不能发布正式成本。");
    }
    const sourceInbox = sourceInboxRecords[0] ?? null;
    if (sourceInbox && !normalizedInboxId) {
      throw new Error("该 ERP 源批次已有收件记录，必须从当前已载入的收件批次发布。");
    }
    let linkedInbox = normalizedInboxId ? await db.erpCostInbox.get(normalizedInboxId) : null;
    if (normalizedInboxId && (!linkedInbox
      || linkedInbox.status !== "loaded"
      || linkedInbox.ledgerId !== ledgerId
      || linkedInbox.workspaceId !== workspaceId
      || linkedInbox.requestId !== effectiveRequestId
      || linkedInbox.batchId !== verifiedSourceEnvelope.batchId
      || (sourceInbox && sourceInbox.id !== linkedInbox.id))) {
      throw new Error("当前 ERP 收件批次状态或请求范围已变化，请重新载入后再发布。");
    }
    const manualInbox = !sourceInbox && !linkedInbox;
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
        envelope: manualInboxEnvelope,
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
      query: verifiedSourceEnvelope.query,
      summary: verifiedSourceEnvelope.summary,
      sourceMeta: verifiedSourceEnvelope.sourceMeta,
      evidenceStatus: verifiedSourceEnvelope.evidenceStatus,
      warehouseEvidence: verifiedSourceEnvelope.warehouseEvidence,
    };
    const savedBatch = {
      id: batchId,
      workspaceId,
      ledgerId,
      requestId: effectiveRequestId,
      sourceName,
      inputHash,
      status: "published",
      currency: "CNY",
      publishedBy: auditActor,
      publishedAt,
      summary: reconciliation.summary,
      invalidRows: reconciliation.invalidRows,
      overrides: reconciliation.overrides,
      sourceContract,
    };
    await db.erpCostBatches.add(savedBatch);

    const storedRows = verifiedRows.map((row) => ({
      batchId,
      ledgerId,
      workspaceId,
      platformSku: row.platformSku,
      canonicalPlatformSku: row.canonicalPlatformSku,
      platformSkc: row.platformSkc ?? null,
      canonicalPlatformSkc: row.canonicalPlatformSkc ?? null,
      warehouseSku: row.sourceWarehouseSku,
      unitCost: row.unitCost,
      currency: row.currency,
      orderNumber: row.orderNumber,
      orderType: row.orderType,
      productName: row.productName,
      calculationCount: row.calculationCount,
      dateRange: row.dateRange,
      totalQuantity: row.totalQuantity,
      totalPrice: row.totalPrice,
      supplierName: row.supplierName,
      supplier1688Url: row.supplier1688Url,
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
      sourceEnvelopeBatchId: verifiedSourceEnvelope.batchId,
      sourceAlgorithmVersion: verifiedSourceEnvelope.algorithmVersion,
      sourceBaselineSha256: verifiedSourceEnvelope.baseline?.releaseSha256 ?? null,
      publishedAt,
    }));
    if (verifiedRows.length > 0) {
      await db.erpCostRows.bulkAdd(storedRows);
    }

    const coverage = await readLedgerCostCoverage(ledgerId);
    const savedLedger = {
      ...ledger,
      ...buildLedgerCoveragePatch(
      ledger,
      coverage,
      publishedAt,
      reconciliation.summary,
      ),
    };
    await db.ledgers.put(savedLedger);
    const persistedRows = verifiedRows.length > 0
      ? await db.erpCostRows.where("batchId").equals(batchId).toArray()
      : [];
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
        ...reconciliation.summary,
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

  return { batchId, inboxId: appliedInboxId, matchedCount: verifiedRows.length, ...reconciliation.summary };
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
      const ledger = await db.ledgers.get(ledgerId);
      if (!ledger) throw new Error("找不到对应的月度账本。");
      if (["finalized", "locked"].includes(ledger.status)) throw new Error("已定稿或已锁定账本不能新增成本审批。");

      const ledgerRows = await db.salesRows.where("ledgerId").equals(ledgerId).toArray();
      if (!ledgerRows.some((row) => canonicalPlatformSku(row.platformSku ?? row.sku) === canonicalSku)) {
        throw new Error("该平台 SKU 不属于当前月度账本。");
      }

      const erpRows = await getLatestLedgerCosts(ledgerId);
      if (erpRows.some((row) => canonicalPlatformSku(row.platformSku) === canonicalSku && Number(row.unitCost) > 0)) {
        throw new Error("该平台 SKU 已有 ERP 正式成本，无需使用 1688 兜底。");
      }

      const activeApprovals = (await db.costApprovals.where("ledgerId").equals(ledgerId).toArray())
        .filter((item) => item.status === "approved" && canonicalPlatformSku(item.platformSku) === canonicalSku);
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
      const ledger = await db.ledgers.get(ledgerId);
      if (!ledger) throw new Error("找不到对应的月度账本。");
      if (["finalized", "locked"].includes(ledger.status)) throw new Error("已定稿或已锁定账本不能撤销成本审批。");
      const approval = await db.costApprovals.get(approvalId);
      if (!approval || approval.ledgerId !== ledgerId) throw new Error("找不到对应的成本审批记录。");
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
  await db.transaction("rw", db.ledgers, db.erpCostRequests, db.auditEvents, async () => {
    const ledger = request.ledgerId ? await db.ledgers.get(request.ledgerId) : null;
    if (request.ledgerId && !ledger) throw new Error("找不到对应的月度账本。");

    await db.erpCostRequests.put({
      ...savedRequest,
      status: "copied",
      createdAt,
      updatedAt: createdAt,
    });
    await db.auditEvents.add({
      workspaceId: request.workspaceId,
      objectType: "erp_cost_request",
      objectId: request.id,
      action: "skcs_copied",
      actorId: auditActor,
      createdAt,
      after: {
        ledgerId: request.ledgerId,
        platformSkcCount: request.platformSkcs.length,
        snapshot: { ...savedRequest, status: "copied", createdAt, updatedAt: createdAt },
      },
    });
  });
  return request.id;
}

export async function receiveErpCostInboxEnvelope({ envelope, receivedVia = "browser-message" } = {}) {
  const rawBatch = envelope?.batch;
  const requestId = String(rawBatch?.requestId ?? "").trim();
  const recordedRequest = requestId ? await db.erpCostRequests.get(requestId) : null;
  const verifiedExpectedSkus = Array.isArray(recordedRequest?.expectedSkus) && recordedRequest.expectedSkus.length > 0
    ? recordedRequest.expectedSkus
    : null;
  const validated = validateErpCostInboxEnvelope(envelope, recordedRequest ? {
    expectedWorkspaceId: recordedRequest.workspaceId,
    expectedLedgerId: recordedRequest.ledgerId,
    expectedRequestId: recordedRequest.id,
    expectedPlatformSkcs: recordedRequest.platformSkcs,
    expectedSkus: verifiedExpectedSkus,
  } : {});
  const batch = validated.batch;
  const receivedAt = new Date().toISOString();
  const inboxId = `INBOX-${validated.deliveryId}`;
  const existing = await db.erpCostInbox.where("deliveryId").equals(validated.deliveryId).first();
  if (existing) return { id: existing.id, deliveryId: existing.deliveryId, status: existing.status, idempotent: true };

  const existingBatch = await db.erpCostInbox.where("batchId").equals(batch.batchId).first();
  if (existingBatch) return { id: existingBatch.id, deliveryId: existingBatch.deliveryId, status: existingBatch.status, idempotent: true };
  const auditActor = await resolveProfitAuditActor("erp-assistant-v8");

  const saved = {
    id: inboxId,
    deliveryId: validated.deliveryId,
    batchId: batch.batchId,
    workspaceId: batch.workspaceId,
    ledgerId: batch.ledgerId,
    requestId: batch.requestId,
    status: "pending",
    receivedVia: String(receivedVia || validated.envelope.transport || "browser-message"),
    sentAt: validated.envelope.sentAt,
    receivedAt,
    envelope: validated.envelope,
  };

  await db.transaction("rw", db.erpCostInbox, db.auditEvents, async () => {
    const race = await db.erpCostInbox.get(inboxId);
    if (race) return;
    await db.erpCostInbox.add(saved);
    await db.auditEvents.add({
      workspaceId: batch.workspaceId,
      objectType: "erp_cost_inbox",
      objectId: inboxId,
      action: "received",
      actorId: auditActor,
      createdAt: receivedAt,
      after: {
        batchId: batch.batchId,
        ledgerId: batch.ledgerId,
        requestId: batch.requestId,
        deliveryId: validated.deliveryId,
        receivedVia: saved.receivedVia,
        outputRowCount: batch.summary.outputRowCount,
      },
    });
  });
  return { id: inboxId, deliveryId: validated.deliveryId, batchId: batch.batchId, status: "pending", idempotent: false };
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

export async function listErpCostInbox({ ledgerId = null, statuses = ["pending", "loaded"] } = {}) {
  const allowed = new Set(["pending", "loaded", "applied", "rejected", "voided"]);
  const statusSet = new Set((Array.isArray(statuses) ? statuses : []).filter((status) => allowed.has(status)));
  const rows = ledgerId
    ? await db.erpCostInbox.where("ledgerId").equals(ledgerId).toArray()
    : await db.erpCostInbox.toArray();
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
  const rejectedAt = new Date().toISOString();
  const auditActor = await resolveProfitAuditActor(rejectedBy);
  const loadedIds = [];

  await db.transaction("rw", db.ledgers, db.erpCostInbox, db.auditEvents, async () => {
    const records = await db.erpCostInbox.bulkGet(inboxIds);
    if (records.some((record) => !record)) throw new Error("部分 ERP 收件批次已不存在，请刷新后重试。");
    for (const record of records) {
      if (!["pending", "loaded"].includes(record.status)) {
        throw new Error("只有待处理或已载入的 ERP 批次可以删除。");
      }
      const ledger = await db.ledgers.get(record.ledgerId);
      if (ledger?.status === "locked") throw new Error("已锁定账本不能删除 ERP 收件批次。");
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
    if (!["pending", "loaded"].includes(candidate.status)) throw new Error("当前载入状态已变化，请刷新待处理列表后重试。");

    const previous = previousKey ? await db.erpCostInbox.get(previousKey) : null;
    if (previousKey && (!previous || previous.status !== "loaded")) {
      throw new Error("当前载入状态已变化，请刷新待处理列表后重试。");
    }
    if (previous && (previous.ledgerId !== candidate.ledgerId || previous.workspaceId !== candidate.workspaceId)) {
      throw new Error("ERP 收件批次不属于同一工作区和账本，不能切换。");
    }

    const otherLoaded = (await db.erpCostInbox.where("ledgerId").equals(candidate.ledgerId).toArray())
      .find((record) => record.status === "loaded" && record.id !== candidateKey && record.id !== previousKey);
    if (otherLoaded) throw new Error("当前载入状态已变化，请刷新待处理列表后重试。");

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

export async function updateLedgerWarehouseRate(ledgerId, warehouseRate, updatedBy = "local-user") {
  const rate = Number(warehouseRate);
  if (!Number.isFinite(rate) || rate < 0) throw new Error("仓储费率必须大于或等于 0。");
  const updatedAt = new Date().toISOString();
  const auditActor = await resolveProfitAuditActor(updatedBy);

  await db.transaction("rw", db.ledgers, db.auditEvents, async () => {
    const ledger = await db.ledgers.get(ledgerId);
    if (!ledger) throw new Error("找不到对应的月度账本。");
    if (["finalized", "locked"].includes(ledger.status)) throw new Error("已定稿或已锁定账本不能修改仓储费率。");
    const savedLedger = { ...ledger, warehouseRate: rate, updatedAt };
    await db.ledgers.put(savedLedger);
    await db.auditEvents.add({
      workspaceId: ledger.workspaceId,
      objectType: "monthly_ledger",
      objectId: ledgerId,
      action: "warehouse_rate_updated",
      actorId: auditActor,
      createdAt: updatedAt,
      before: { warehouseRate: ledger.warehouseRate },
      after: {
        warehouseRate: rate,
        snapshot: savedLedger,
      },
    });
  });
}

export async function finalizeMonthlyLedger({
  ledgerId,
  profitLines,
  profitSummary,
  formulaVersion,
  finalizedBy = "local-user",
}) {
  const finalizedAt = new Date().toISOString();
  const auditActor = await resolveProfitAuditActor(finalizedBy);

  await db.transaction("rw", db.ledgers, db.salesRows, db.erpCostBatches, db.erpCostRows, db.costApprovals, db.profitLines, db.auditEvents, async () => {
    const ledger = await db.ledgers.get(ledgerId);
    if (!ledger) throw new Error("找不到对应的月度账本。");
    if (ledger.status === "locked") throw new Error("已锁定账本不能重新定稿。");
    const coverage = await readLedgerCostCoverage(ledgerId);
    if (coverage.missingCount > 0 || profitLines.some((line) => !line.finalizable)) {
      throw new Error("仍有平台 SKU 缺少正式成本，账本不能定稿。");
    }

    const savedProfitLines = profitLines.map((line) => ({
      ...line,
      workspaceId: ledger.workspaceId,
      ledgerId,
      period: ledger.period,
      finalizedAt,
      finalizedBy: auditActor,
      formulaVersion,
    }));
    await db.profitLines.where("ledgerId").equals(ledgerId).delete();
    if (savedProfitLines.length > 0) await db.profitLines.bulkAdd(savedProfitLines);
    const persistedProfitLines = savedProfitLines.length > 0
      ? await db.profitLines.where("ledgerId").equals(ledgerId).toArray()
      : [];
    const savedLedger = {
      ...ledger,
      status: "finalized",
      costSummary: {
        ...(ledger.costSummary ?? {}),
        ...coverage,
        matchedCount: coverage.erpMatchedCount,
      },
      profitSummary,
      formulaVersion,
      finalizedAt,
      finalizedBy: auditActor,
      updatedAt: finalizedAt,
    };
    await db.ledgers.put(savedLedger);
    await db.auditEvents.add({
      workspaceId: ledger.workspaceId,
      objectType: "monthly_ledger",
      objectId: ledgerId,
      action: "finalized",
      actorId: auditActor,
      createdAt: finalizedAt,
      after: {
        ...profitSummary,
        formulaVersion,
        lineCount: profitLines.length,
        snapshot: {
          ...savedLedger,
          profitLines: persistedProfitLines,
        },
      },
    });
  });
}

export async function getLatestLedgerCosts(ledgerId) {
  const [rows, batches] = await Promise.all([
    db.erpCostRows.where("ledgerId").equals(ledgerId).toArray(),
    db.erpCostBatches.where("ledgerId").equals(ledgerId).toArray(),
  ]);
  const batchStatus = new Map(batches.map((batch) => [batch.id, batch.status]));
  const latest = new Map();
  rows.toSorted((a, b) => {
    const dateOrder = String(a.publishedAt ?? "").localeCompare(String(b.publishedAt ?? ""));
    return dateOrder || Number(a.id ?? 0) - Number(b.id ?? 0);
  }).forEach((row) => {
    latest.set(row.canonicalPlatformSku ?? canonicalPlatformSku(row.platformSku), row);
  });
  return [...latest.values()].filter((row) => batchStatus.get(row.batchId) === "published");
}

export async function voidPublishedErpCostBatch({
  inboxId,
  reason,
  voidedBy = "local-user",
} = {}) {
  const normalizedInboxId = String(inboxId ?? "").trim();
  const normalizedReason = String(reason ?? "").trim();
  const normalizedActor = await resolveProfitAuditActor(voidedBy);
  if (!normalizedInboxId) throw new Error("请选择要作废的 ERP 发布批次。");
  if (!normalizedReason) throw new Error("作废发布必须填写原因。");
  const voidedAt = new Date().toISOString();
  let result = null;

  await db.transaction(
    "rw",
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
      if (!inbox || inbox.status !== "applied" || !inbox.appliedBatchId) {
        throw new Error("只有已发布且尚未作废的 ERP 批次可以作废。");
      }
      const batch = await db.erpCostBatches.get(inbox.appliedBatchId);
      if (!batch || batch.status !== "published" || batch.ledgerId !== inbox.ledgerId) {
        throw new Error("找不到与收件记录关联的有效 ERP 正式成本批次。");
      }
      const ledger = await db.ledgers.get(batch.ledgerId);
      if (!ledger) throw new Error("找不到对应的月度账本。");
      if (ledger.status === "locked") throw new Error("已锁定账本不能作废 ERP 正式成本。");

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
        reopened: ledger.status === "finalized",
      };
    },
  );
  return result;
}

export async function getLedgerSnapshot(ledgerId) {
  const ledger = await db.ledgers.get(ledgerId);
  if (!ledger) return null;
  const [rows, batches, costs, approvals] = await Promise.all([
    db.salesRows.where("ledgerId").equals(ledgerId).toArray(),
    db.importBatches.where("ledgerId").equals(ledgerId).toArray(),
    getLatestLedgerCosts(ledgerId),
    db.costApprovals.where("ledgerId").equals(ledgerId).toArray(),
  ]);
  return { ledger, rows, batches, costs, approvals };
}

export async function getLatestLedgerSnapshot() {
  const ledger = await db.ledgers.orderBy("updatedAt").last();
  return ledger ? getLedgerSnapshot(ledger.id) : null;
}

export async function listLedgerSummaries() {
  return db.ledgers.orderBy("period").reverse().toArray();
}

export async function deleteMonthlyLedger(ledgerId, deletedBy = "local-user") {
  const auditActor = await resolveProfitAuditActor(deletedBy);
  await db.transaction(
    "rw",
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
    async () => {
      const ledger = await db.ledgers.get(ledgerId);
      if (!ledger) return;
      if (["finalized", "locked"].includes(ledger.status)) throw new Error("已定稿或已锁定的账本不能删除。");

      const [costBatchRecords, inboxRecords] = await Promise.all([
        db.erpCostBatches.where("ledgerId").equals(ledgerId).toArray(),
        db.erpCostInbox.where("ledgerId").equals(ledgerId).toArray(),
      ]);
      if (costBatchRecords.some((batch) => ["published", "voided"].includes(batch.status))
        || inboxRecords.some((inbox) => ["applied", "voided"].includes(inbox.status))) {
        throw new Error("该账本已有正式 ERP 成本生命周期记录，不能物理删除；请保留证据并使用作废流程纠错。");
      }
      const costBatches = costBatchRecords.map((batch) => batch.id);
      await db.salesRows.where("ledgerId").equals(ledgerId).delete();
      await db.importBatches.where("ledgerId").equals(ledgerId).delete();
      await db.erpCostRequests.where("ledgerId").equals(ledgerId).delete();
      await db.erpCostRows.where("ledgerId").equals(ledgerId).delete();
      await db.erpCostInbox.where("ledgerId").equals(ledgerId).delete();
      await db.erpCostBatches.bulkDelete(costBatches);
      await db.costApprovals.where("ledgerId").equals(ledgerId).delete();
      await db.profitLines.where("ledgerId").equals(ledgerId).delete();
      await db.ledgers.delete(ledgerId);
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
