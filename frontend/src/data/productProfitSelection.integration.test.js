import "fake-indexeddb/auto";
import { liveQuery } from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_ID,
  bulkUpdateProductCatalogSalesStatus,
  createManualCaptureRecord,
  createOrGetMonthlyLedger,
  db,
  finalizeMonthlyLedger,
  getLedgerSnapshot,
  getProductEditorSnapshot,
  getSelectionReferenceSnapshot,
  getWorkspaceOperationalSummary,
  ignoreCaptureRecord,
  listProductCatalogRecords,
  mergeProductSkcRecords,
  previewProductSkcMerge,
  restoreWorkspaceSyncRecoveryPayload,
  saveCatalogManualCost,
  saveApproved1688Fallback,
  saveErpCostRequest,
  savePublishedErpCostBatch,
  saveProductCatalogRecord,
  setActiveMemberContext,
  saveSalesImport,
  updateCaptureDraft,
} from "./database";
import { buildErpCostRequest, reconcileErpCostRows } from "../domain/erpCosts";
import { buildErpCostBatchEnvelope } from "../domain/erpCostBatchEnvelope";
import { resolveFormalCostDecision } from "../domain/costPolicy";
import { calculateExactProfitLine, PROFIT_FORMULA_VERSION } from "../domain/profitCalculations";
import { validateSalesRows } from "../lib/salesImport";
import { groupImportedSales } from "../lib/profit";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";
import { auditEventToSyncEvent, buildSyncEnvelope } from "../domain/syncEnvelope";
import { listBusinessProjectionGaps } from "../domain/syncBusinessProjection";
import { createSyncEventStore } from "../domain/syncServerContract";
import { buildSyncRecoveryPayload } from "../domain/syncRecovery";

const period = "2026-07";
const now = "2026-07-31T12:00:00.000Z";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("商品到利润再到选品参考的持久化闭环", () => {
  it("keeps catalog live queries read-only when the default workspace has not been created yet", async () => {
    expect(await db.workspaces.count()).toBe(0);

    const products = await new Promise((resolve, reject) => {
      let subscription;
      subscription = liveQuery(listProductCatalogRecords).subscribe({
        next(value) {
          subscription?.unsubscribe();
          resolve(value);
        },
        error: reject,
      });
    });

    expect(products).toEqual([]);
    expect(await db.workspaces.count()).toBe(0);
  });

  it("将人工确认成本保留在选品参考与同步恢复中，但不作为月度正式成本", async () => {
    const { product } = await saveProductCatalogRecord({
      status: "active",
      savedBy: "integration-test",
      draft: {
        name: "人工确认成本商品",
        platformSkc: "SKC-MANUAL-COST",
        variants: [{ attribute: "默认", platformSku: "SKU-MANUAL-COST", purchaseUnitPrice: 12, purchasePackCount: 1, unitsPerPack: 1, salePrice: 30 }],
      },
    });
    const manualCost = await saveCatalogManualCost({
      productId: product.id,
      platformSku: "SKU-MANUAL-COST",
      amount: 13.5,
      note: "供应商报价已人工复核",
      confirmedBy: "reviewer-a",
    });

    const selectionRows = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
    expect(selectionRows).toMatchObject([{
      platformSku: "SKU-MANUAL-COST",
      referenceUnitCost: 13.5,
      referenceKind: "manual_confirmed",
      authoritativeSource: "manual_confirmed",
      referenceCostId: manualCost.id,
    }]);
    expect(resolveFormalCostDecision({ ledgerId: "L-EMPTY", platformSku: "SKU-MANUAL-COST" })).toMatchObject({
      status: "missing", eligibleForExactProfit: false,
    });

    const events = (await db.auditEvents.toArray()).map(auditEventToSyncEvent);
    expect(listBusinessProjectionGaps(events)).toEqual([]);
    const recovery = buildSyncRecoveryPayload({
      workspaceId: DEFAULT_WORKSPACE_ID,
      cursor: "manual-cost-recovery",
      generatedAt: now,
      workspace: await db.workspaces.get(DEFAULT_WORKSPACE_ID),
      events,
    });
    db.close();
    await db.delete();
    await db.open();
    await restoreWorkspaceSyncRecoveryPayload(recovery, "recovery-test");
    const restoredRows = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
    expect(restoredRows).toMatchObject([{
      platformSku: "SKU-MANUAL-COST",
      referenceUnitCost: 13.5,
      authoritativeSource: "manual_confirmed",
    }]);
  });

  it("uses ERP history before the lowest 1688 supplier reference and keeps supplier SKU branches isolated", async () => {
    const draft = {
      name: "多供应商测试款",
      platformSkc: "SKC-MULTI-1",
      store: "美国主店",
      suppliers: [
        {
          id: "SUP-PRIMARY",
          supplierCode: "SUP-A",
          supplierName: "供应商 A",
          sourceProductId: "1688-A",
          sourceUrl: "https://detail.1688.com/offer/a",
          shippingAmount: 0,
          handlingFee: 0,
          variants: [{ platformSku: "SKU-MULTI-RED", purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1 }],
        },
        {
          id: "SUP-SECONDARY",
          supplierCode: "SUP-B",
          supplierName: "供应商 B",
          sourceProductId: "1688-B",
          sourceUrl: "https://detail.1688.com/offer/b",
          shippingAmount: 0,
          handlingFee: 0,
          variants: [{ platformSku: "", purchaseUnitPrice: 8, purchasePackCount: 1, unitsPerPack: 1 }],
        },
      ],
      variants: [{
        attribute: "红色",
        platformSku: "SKU-MULTI-RED",
        sourceSku: "RED-01",
        purchaseUnitPrice: 10,
        purchasePackCount: 1,
        unitsPerPack: 1,
        salePrice: 29.9,
      }],
    };

    const { product } = await saveProductCatalogRecord({ draft, status: "active", savedBy: "integration-test" });
    const [catalogBeforeErp] = await listProductCatalogRecords();
    expect(catalogBeforeErp).toMatchObject({
      id: product.id,
      lowestReferenceCost: 10,
      costSource: "supplier_landed",
      supplierCount: 2,
      erpCoveredSkuCount: 0,
    });
    expect(catalogBeforeErp.offers).toHaveLength(2);
    expect(catalogBeforeErp.offers.find((offer) => offer.supplierCode === "SUP-B")).toMatchObject({
      purchaseUnitPrice: null,
      landedUnitCost: null,
    });

    await db.erpCostRows.add({
      id: "ERP-COST-MULTI-1",
      workspaceId: DEFAULT_WORKSPACE_ID,
      ledgerId: "LEDGER-REFERENCE",
      platformSku: "SKU-MULTI-RED",
      canonicalPlatformSku: "SKU-MULTI-RED",
      platformSkc: "SKC-MULTI-1",
      unitCost: 6.25,
      currency: "CNY",
      publishedAt: "2026-07-31T12:00:00.000Z",
    });

    const [catalogWithErp] = await listProductCatalogRecords();
    expect(catalogWithErp).toMatchObject({
      lowestReferenceCost: 6.25,
      costSource: "erp",
      erpCoveredSkuCount: 1,
      referenceCoveredSkuCount: 1,
    });
  });

  it("uses the latest finalized profit cost before falling back to a 1688 quote in the product archive", async () => {
    const { product } = await saveProductCatalogRecord({
      draft: {
        name: "定稿历史参考款",
        platformSkc: "SKC-FINALIZED-REFERENCE",
        variants: [{ attribute: "默认", platformSku: "SKU-FINALIZED-REFERENCE", purchaseUnitPrice: 12, purchasePackCount: 1, unitsPerPack: 1, salePrice: 30 }],
      },
      status: "active",
    });

    await db.profitLines.add({
      id: "PROFIT-FINALIZED-REFERENCE",
      workspaceId: DEFAULT_WORKSPACE_ID,
      ledgerId: "LEDGER-FINALIZED-REFERENCE",
      platformSku: "SKU-FINALIZED-REFERENCE",
      canonicalPlatformSku: "SKU-FINALIZED-REFERENCE",
      unitCost: 7.5,
      formalUnitCost: 7.5,
      finalizedAt: "2026-08-10T12:00:00.000Z",
      profit: 10,
    });

    const [catalog] = await listProductCatalogRecords();
    expect(catalog).toMatchObject({ id: product.id, lowestReferenceCost: 7.5, costSource: "finalized_profit_history" });
    expect(catalog.skuReferences).toMatchObject([{ platformSku: "SKU-FINALIZED-REFERENCE", unitCost: 7.5, source: "finalized_profit_history" }]);
  });

  it("keeps a freely created unpublished product and its multiple 1688 suppliers before platform SKU assignment", async () => {
    const { product } = await saveProductCatalogRecord({
      status: "active",
      savedBy: "integration-test",
      draft: {
        name: "SHEIN 未审核候选款",
        salesPlatform: "SHEIN",
        publicationStatus: "published_pending_review",
        imageUrl: "https://img.example.com/candidate.jpg",
        suppliers: [
          {
            id: "SUP-CANDIDATE-A",
            supplierName: "1688 供应商 A",
            sourceProductId: "1688-CANDIDATE-A",
            sourceUrl: "https://detail.1688.com/offer/candidate-a",
            variants: [{ platformSku: "", sourceSku: "A-RED", purchaseUnitPrice: 8.5, purchasePackCount: 1, unitsPerPack: 1 }],
          },
          {
            id: "SUP-CANDIDATE-B",
            supplierName: "1688 供应商 B",
            sourceProductId: "1688-CANDIDATE-B",
            sourceUrl: "https://detail.1688.com/offer/candidate-b",
            variants: [{ platformSku: "", sourceSku: "B-RED", purchaseUnitPrice: 9, purchasePackCount: 1, unitsPerPack: 1 }],
          },
        ],
        variants: [{ attribute: "红色", sourceSku: "A-RED", purchaseUnitPrice: 8.5, purchasePackCount: 1, unitsPerPack: 1, salePrice: 25 }],
      },
    });

    expect(await db.platformSkus.where("productId").equals(product.id).toArray()).toHaveLength(0);
    expect(product.attributes).toMatchObject({
      pendingVariants: [{ attribute: "红色", sourceSku: "A-RED", salePrice: 25 }],
      supplierProfiles: [
        { supplierId: "SUP-CANDIDATE-A", sourceUrl: "https://detail.1688.com/offer/candidate-a" },
        { supplierId: "SUP-CANDIDATE-B", sourceUrl: "https://detail.1688.com/offer/candidate-b" },
      ],
    });

    let [catalog] = await listProductCatalogRecords();
    expect(catalog).toMatchObject({
      id: product.id,
      publicationStatus: "published_pending_review",
      skuCount: 0,
      pendingVariantCount: 1,
      supplierCount: 2,
      dataReadiness: {
        purchase: { status: "missing" },
        profit: { status: "missing" },
        warehouseMapping: { status: "missing" },
      },
    });
    expect(catalog.supplierProfiles.map((supplier) => supplier.sourceUrl).toSorted()).toEqual([
      "https://detail.1688.com/offer/candidate-a",
      "https://detail.1688.com/offer/candidate-b",
    ]);

    const editor = await getProductEditorSnapshot({ productId: product.id });
    expect(editor.draft.variants).toMatchObject([{ attribute: "红色", sourceSku: "A-RED", salePrice: 25 }]);
    expect(editor.draft.suppliers).toMatchObject([
      { supplierId: "SUP-CANDIDATE-A", variants: [{ sourceSku: "A-RED", purchaseUnitPrice: 8.5 }] },
      { supplierId: "SUP-CANDIDATE-B", variants: [{ sourceSku: "B-RED", purchaseUnitPrice: 9 }] },
    ]);

    await saveProductCatalogRecord({
      productId: product.id,
      status: "active",
      savedBy: "integration-test",
      draft: {
        ...editor.draft,
        platformSkc: "SKC-CANDIDATE-RED",
        variants: editor.draft.variants.map((variant) => ({ ...variant, platformSku: "SKU-CANDIDATE-RED" })),
        suppliers: editor.draft.suppliers.map((supplier) => ({
          ...supplier,
          variants: supplier.variants.map((variant) => ({ ...variant, platformSku: "SKU-CANDIDATE-RED" })),
        })),
      },
    });

    catalog = (await listProductCatalogRecords())[0];
    expect(catalog).toMatchObject({ skuCount: 1, pendingVariantCount: 0, supplierCount: 2 });
    expect(catalog.offers.toSorted((left, right) => left.sourceSku.localeCompare(right.sourceSku))).toMatchObject([
      { platformSku: "SKU-CANDIDATE-RED", sourceSku: "A-RED", purchaseUnitPrice: 8.5 },
      { platformSku: "SKU-CANDIDATE-RED", sourceSku: "B-RED", purchaseUnitPrice: 9 },
    ]);
  });

  it("does not duplicate a legacy product-level supplier when its SKU quotation has a different supplier ID", async () => {
    const { product } = await saveProductCatalogRecord({
      status: "active",
      draft: {
        name: "兼容供应商去重款",
        platformSkc: "SKC-SUPPLIER-DEDUP",
        suppliers: [{
          id: "SUP-UI-LEGACY",
          supplierCode: "SUP-DEDUP",
          supplierName: "同一供应商",
          sourceProductId: "1688-DEDUP",
          sourceUrl: "https://detail.1688.com/offer/dedup",
          variants: [{ platformSku: "SKU-SUPPLIER-DEDUP", purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1 }],
        }],
        variants: [{ platformSku: "SKU-SUPPLIER-DEDUP", purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1 }],
      },
    });
    await db.products.update(product.id, { attributes: {} });

    const [catalog] = await listProductCatalogRecords();
    expect(catalog).toMatchObject({ supplierCount: 1, supplier: "SUP-DEDUP" });
    expect(catalog.supplierProfiles).toHaveLength(1);
  });

  it("does not create an empty 1688 supplier when only a platform SKU is known", async () => {
    const { product } = await saveProductCatalogRecord({
      status: "active",
      draft: {
        name: "待补供应商款",
        platformSkc: "SKC-NO-SUPPLIER",
        variants: [{ platformSku: "SKU-NO-SUPPLIER", attribute: "默认规格", salePrice: 19.9 }],
      },
    });

    expect(await db.supplierOffers.where("productId").equals(product.id).toArray()).toHaveLength(0);
    const [catalog] = await listProductCatalogRecords();
    expect(catalog).toMatchObject({ supplierCount: 0, supplier: "未填写" });
    expect(catalog.supplierProfiles).toEqual([]);
  });

  it("keeps publication lifecycle separate from ERP and profit data while allowing a shared warehouse SKU", async () => {
    const { product } = await saveProductCatalogRecord({
      draft: {
        name: "SHEIN 待上架引流款",
        salesPlatform: "SHEIN",
        publicationStatus: "approved_pending_listing",
        platformSkc: "SKC-SHARED-WH",
        variants: [
          { attribute: "红色", platformSku: "SKU-SHARED-WH-RED", warehouseSku: "WH-TRAFFIC-01", purchaseUnitPrice: 8, purchasePackCount: 1, unitsPerPack: 1, salePrice: 20 },
          { attribute: "蓝色", platformSku: "SKU-SHARED-WH-BLUE", warehouseSku: "WH-TRAFFIC-01", purchaseUnitPrice: 8, purchasePackCount: 1, unitsPerPack: 1, salePrice: 20 },
        ],
      },
      status: "active",
    });

    const storedSkus = await db.platformSkus.where("productId").equals(product.id).toArray();
    expect(storedSkus.map((sku) => sku.canonicalWarehouseSku)).toEqual(["WH-TRAFFIC-01", "WH-TRAFFIC-01"]);

    let [catalog] = await listProductCatalogRecords();
    expect(catalog).toMatchObject({
      salesPlatform: "SHEIN",
      publicationStatus: "approved_pending_listing",
      dataReadiness: {
        purchase: { status: "missing" },
        profit: { status: "missing" },
        warehouseMapping: { status: "complete" },
      },
    });

    await db.erpCostRows.bulkAdd([
      { workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: "LEDGER-SHARED-WH", platformSku: "SKU-SHARED-WH-RED", canonicalPlatformSku: "SKU-SHARED-WH-RED", warehouseSku: "WH-TRAFFIC-01", unitCost: 6, currency: "CNY", publishedAt: now },
      { workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: "LEDGER-SHARED-WH", platformSku: "SKU-SHARED-WH-BLUE", canonicalPlatformSku: "SKU-SHARED-WH-BLUE", warehouseSku: "WH-TRAFFIC-01", unitCost: 6, currency: "CNY", publishedAt: now },
    ]);
    await db.profitLines.bulkAdd([
      { workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: "LEDGER-SHARED-WH", platformSku: "SKU-SHARED-WH-RED", canonicalPlatformSku: "SKU-SHARED-WH-RED", unitCost: 6, formalUnitCost: 6, finalizedAt: now },
      { workspaceId: DEFAULT_WORKSPACE_ID, ledgerId: "LEDGER-SHARED-WH", platformSku: "SKU-SHARED-WH-BLUE", canonicalPlatformSku: "SKU-SHARED-WH-BLUE", unitCost: 6, formalUnitCost: 6, finalizedAt: now },
    ]);

    [catalog] = await listProductCatalogRecords();
    expect(catalog.dataReadiness).toMatchObject({
      purchase: { status: "complete" },
      profit: { status: "complete" },
      warehouseMapping: { status: "complete" },
    });
  });

  it("preserves superseded 1688 quotations while only using the active quotation as a selection reference", async () => {
    const draft = {
      name: "报价历史测试款",
      platformSkc: "SKC-OFFER-HISTORY",
      store: "美国主店",
      suppliers: [{
        id: "SUP-HISTORY",
        supplierCode: "SUP-HISTORY",
        supplierName: "历史供应商",
        sourceProductId: "1688-HISTORY",
        sourceUrl: "https://detail.1688.com/offer/history",
        shippingAmount: 0,
        handlingFee: 0,
        variants: [{ platformSku: "SKU-OFFER-HISTORY", purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1 }],
      }],
      variants: [{ attribute: "默认", platformSku: "SKU-OFFER-HISTORY", purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1, salePrice: 30 }],
    };
    const { product } = await saveProductCatalogRecord({ draft, status: "active", savedBy: "integration-test" });
    await saveProductCatalogRecord({
      productId: product.id,
      status: "active",
      savedBy: "integration-test",
      draft: {
        ...draft,
        suppliers: [{ ...draft.suppliers[0], variants: [{ ...draft.suppliers[0].variants[0], purchaseUnitPrice: 12 }] }],
        variants: [{ ...draft.variants[0], purchaseUnitPrice: 12 }],
      },
    });

    const storedOffers = await db.supplierOffers.where("productId").equals(product.id).toArray();
    expect(storedOffers).toHaveLength(2);
    expect(storedOffers.filter((offer) => offer.status === "active")).toMatchObject([{ purchaseUnitPrice: 12, landedUnitCost: 12 }]);
    expect(storedOffers.filter((offer) => offer.status === "superseded")).toMatchObject([{ purchaseUnitPrice: 10, landedUnitCost: 10 }]);

    const [catalog] = await listProductCatalogRecords();
    expect(catalog.offers).toHaveLength(1);
    expect(catalog.skuReferences).toMatchObject([{ platformSku: "SKU-OFFER-HISTORY", unitCost: 12, source: "supplier_landed" }]);
    const [reference] = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
    expect(reference).toMatchObject({ platformSku: "SKU-OFFER-HISTORY", referenceUnitCost: 12, referenceKind: "supplier_landed" });
  });

  it("keeps platform SKU identity and ERP evidence across every module", async () => {
    const ignoredCapture = await createManualCaptureRecord({
      name: "待忽略采集",
      sourceUrl: "https://detail.1688.com/offer/ignored",
      sourceProductId: "1688-IGNORED-1",
      supplierCode: "SUP-IGNORED",
    });
    await updateCaptureDraft({
      captureId: ignoredCapture.id,
      draft: { ...ignoredCapture.draft, englishTitle: "Ignored capture" },
      updatedBy: "integration-test",
    });
    await ignoreCaptureRecord(ignoredCapture.id, "integration-test");

    const capture = await createManualCaptureRecord({
      name: "测试收纳盒",
      sourceUrl: "https://detail.1688.com/offer/test",
      sourceProductId: "1688-TEST-1",
      supplierCode: "SUP-TEST",
      supplierName: "测试供应商",
    });

    const draft = {
      ...capture.draft,
      name: "测试收纳盒",
      platformSkc: "SKC-TEST-1",
      store: "美国主店",
      variants: [{
        id: "VAR-1",
        attribute: "红色",
        platformSku: "SKU-TEST-RED",
        sourceSku: "RED-01",
        purchaseUnitPrice: 8,
        purchasePackCount: 1,
        unitsPerPack: 1,
      }],
    };
    await saveProductCatalogRecord({ captureId: capture.id, draft, status: "active" });

    const [product] = await listProductCatalogRecords();
    expect(product).toMatchObject({
      name: "测试收纳盒",
      platformSkc: "SKC-TEST-1",
      skuCount: 1,
      supplier: "SUP-TEST",
    });
    expect(product.skus[0]).toMatchObject({
      platformSku: "SKU-TEST-RED",
      platformSkc: "SKC-TEST-1",
    });
    expect(product.offers[0]).toMatchObject({
      platformSku: "SKU-TEST-RED",
      landedUnitCost: 8,
      currency: "CNY",
    });

    const ledger = await createOrGetMonthlyLedger({ period, createdBy: "integration-test" });
    const mapping = {
      store: "店铺",
      supplierNumber: "供方货号",
      platformSkc: "平台 SKC",
      platformSku: "平台 SKU",
      quantity: "数量",
      amount: "金额",
    };
    const validation = validateSalesRows([
      {
        店铺: "美国主店",
        供方货号: "SUP-TEST",
        "平台 SKC": "SKC-TEST-1",
        "平台 SKU": "SKU-TEST-RED",
        数量: "10",
        金额: "100",
      },
    ], mapping);
    expect(validation.errors).toHaveLength(0);

    await saveSalesImport({
      fileName: "2026-07-sales.csv",
      mapping,
      summary: {
        sourceRowCount: validation.sourceRowCount,
        errorCount: validation.errors.length,
        ignoredCount: validation.ignored.length,
      },
      rows: validation.rows,
      period,
      storeName: "美国主店",
    });

    const expectedSkus = [{ platformSku: "SKU-TEST-RED", platformSkc: "SKC-TEST-1" }];
    const request = buildErpCostRequest({
      id: "ERP-REQ-TEST-1",
      workspaceId: DEFAULT_WORKSPACE_ID,
      ledgerId: ledger.id,
      platformSkcs: ["SKC-TEST-1"],
      expectedSkus,
      requestedBy: "integration-test",
      requestedAt: now,
    });
    await saveErpCostRequest(request);

    const ledgerSnapshotBeforeCost = await getLedgerSnapshot(ledger.id);
    const reconciliation = reconcileErpCostRows({
      workspaceId: DEFAULT_WORKSPACE_ID,
      expectedSkus,
      costRows: [{
        platformSku: "SKU-TEST-RED",
        platformSkc: "SKC-TEST-1",
        warehouseSku: "WH-TEST-RED",
        orderNumber: "1688-ORDER-1",
        previewUnitCost: 4,
        currency: "CNY",
        calculationCount: 3,
        dateRange: "2026-05-01 ~ 2026-06-01",
        totalQuantity: 30,
        totalPrice: 120,
        evidenceComplete: true,
        purchaseRecords: [
          { recordId: "TEST-R3", warehouseSku: "WH-TEST-RED", purchaseDate: "2026-06-01", quantity: 10, unitPrice: 4, order1688: "1688-ORDER-1", eligible: true, exclusionReasons: [] },
          { recordId: "TEST-R2", warehouseSku: "WH-TEST-RED", purchaseDate: "2026-05-15", quantity: 10, unitPrice: 4, order1688: "1688-ORDER-1", eligible: true, exclusionReasons: [] },
          { recordId: "TEST-R1", warehouseSku: "WH-TEST-RED", purchaseDate: "2026-05-01", quantity: 10, unitPrice: 4, order1688: "1688-ORDER-1", eligible: true, exclusionReasons: [] },
        ],
      }],
      batchId: "ERP-BATCH-TEST-1",
    });
    expect(reconciliation.summary).toMatchObject({ expectedCount: 1, matchedCount: 1, missingCount: 0 });
    const sourceEnvelope = buildErpCostBatchEnvelope({
      batchId: "ERP-BATCH-TEST-1",
      workspaceId: DEFAULT_WORKSPACE_ID,
      ledgerId: ledger.id,
      requestId: request.id,
      platformSkcs: ["SKC-TEST-1"],
      generatedAt: "2026-07-31T12:05:00.000Z",
      results: [{
        warehouseSku: "WH-TEST-RED",
        mappings: [{ platformSku: "SKU-TEST-RED", platformSkc: "SKC-TEST-1" }],
        orderNumber: "1688-ORDER-1",
        sourceType: "1688",
        unitCost: 4,
      }],
      warehouseEvidence: [{
        warehouseSku: "WH-TEST-RED",
        evidenceComplete: true,
        purchaseRecords: reconciliation.matches[0].purchaseRecords,
      }],
    });

    await savePublishedErpCostBatch({
      ledgerId: ledger.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      requestId: request.id,
      reconciliation,
      sourceName: "erp-v8-test.tsv",
      inputHash: "test-hash",
      sourceEnvelope,
      publishedBy: "integration-test",
    });

    const ledgerSnapshot = await getLedgerSnapshot(ledger.id);
    const [salesLine] = groupImportedSales(ledgerSnapshot.rows);
    const [erpCost] = ledgerSnapshot.costs;
    expect(erpCost).toMatchObject({
      platformSku: "SKU-TEST-RED",
      platformSkc: "SKC-TEST-1",
      warehouseSku: "WH-TEST-RED",
      unitCost: 4,
      currency: "CNY",
    });

    const costDecision = resolveFormalCostDecision({
      ledgerId: ledger.id,
      platformSku: salesLine.platformSku,
      erpCost,
      reference1688Cost: { id: "1688-REFERENCE", platformSku: salesLine.platformSku, unitCost: 8, currency: "CNY" },
    });
    const exactProfit = calculateExactProfitLine({
      revenue: salesLine.revenue,
      quantity: salesLine.qty,
      costDecision,
      warehouseRate: 0.7,
      penalty: salesLine.penalty,
    });
    expect(exactProfit).toMatchObject({
      finalizable: true,
      unitCost: 4,
      purchaseCost: 40,
      warehouseCost: 7,
      profit: 53,
      currency: "CNY",
    });

    await finalizeMonthlyLedger({
      ledgerId: ledger.id,
      formulaVersion: PROFIT_FORMULA_VERSION,
      profitSummary: {
        revenue: exactProfit.revenue,
        quantity: exactProfit.quantity,
        purchaseCost: exactProfit.purchaseCost,
        warehouseCost: exactProfit.warehouseCost,
        penalty: exactProfit.penalty,
        profit: exactProfit.profit,
        profitRate: exactProfit.profitRate,
        missingSkuCount: 0,
      },
      profitLines: [{
        platformSku: salesLine.platformSku,
        canonicalPlatformSku: salesLine.canonicalPlatformSku,
        platformSkc: salesLine.platformSkc,
        groupSkc: salesLine.groupSkc,
        supplierNumber: salesLine.supplierNumber,
        store: salesLine.store,
        attribute: salesLine.attribute,
        quantity: salesLine.qty,
        revenue: salesLine.revenue,
        penalty: salesLine.penalty,
        unitCost: exactProfit.unitCost,
        purchaseCost: exactProfit.purchaseCost,
        warehouseCost: exactProfit.warehouseCost,
        profit: exactProfit.profit,
        profitRate: exactProfit.profitRate,
        costSource: costDecision.source,
        costSourceRecordId: costDecision.sourceRecordId,
        costApprovalId: costDecision.approvalId,
        costPolicyVersion: costDecision.policyVersion,
        orderNumber: erpCost.orderNumber,
        finalizable: exactProfit.finalizable,
        calculationMode: "exact",
      }],
    });

    const referenceRows = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
    expect(referenceRows).toHaveLength(1);
    expect(referenceRows[0]).toMatchObject({
      platformSku: "SKU-TEST-RED",
      platformSkc: "SKC-TEST-1",
      productId: product.id,
      referenceUnitCost: 4,
      authoritativeSource: "erp",
      referenceKind: "erp_history",
      referenceCostId: erpCost.id,
      referenceLedgerId: ledger.id,
      referenceCurrency: "CNY",
      latestPeriod: period,
      latestQuantity: 10,
      latestRevenue: 100,
      latestProfit: 53,
      referenceUnitProfit: 5.3,
    });

    expect(ledgerSnapshotBeforeCost.ledger.status).toBe("cost_pending");
    expect((await getLedgerSnapshot(ledger.id)).ledger.status).toBe("finalized");

    const auditRows = await db.auditEvents.orderBy("id").toArray();
    const syncEvents = auditRows.map(auditEventToSyncEvent);
    expect(listBusinessProjectionGaps(syncEvents)).toEqual([]);
    const recoveryPayload = buildSyncRecoveryPayload({
      workspaceId: DEFAULT_WORKSPACE_ID,
      cursor: "cloud-integration-1",
      generatedAt: now,
      events: syncEvents,
      workspace: await db.workspaces.get(DEFAULT_WORKSPACE_ID),
    });

    const syncStore = createSyncEventStore();
    syncStore.accept(buildSyncEnvelope({
      workspaceId: DEFAULT_WORKSPACE_ID,
      cursor: auditRows.at(-1)?.id,
      events: syncEvents,
      generatedAt: now,
    }));
    const projectedEntities = syncStore.snapshot().entities.map(({ value }) => value);
    const projectedProduct = projectedEntities.find((value) => value._entityType === "product");
    const projectedCapture = projectedEntities.find((value) => value._entityType === "capture" && value.id === capture.id);
    const projectedIgnoredCapture = projectedEntities.find((value) => value._entityType === "capture" && value.id === ignoredCapture.id);
    const projectedImport = projectedEntities.find((value) => value._entityType === "sales_import_batch");
    const projectedCostBatch = projectedEntities.find((value) => value._entityType === "erp_cost_batch");
    const projectedLedger = projectedEntities.find((value) => value._entityType === "monthly_ledger");

    expect(projectedProduct).toMatchObject({
      product: { id: product.id, platformSkc: "SKC-TEST-1" },
      platformSkus: [{ platformSku: "SKU-TEST-RED" }],
      supplierOffers: [{ landedUnitCost: 8, currency: "CNY" }],
      _complete: true,
    });
    expect(projectedCapture).toMatchObject({
      id: capture.id,
      status: "confirmed",
      confirmedProductId: product.id,
      draft: { platformSkc: "SKC-TEST-1" },
    });
    expect(projectedIgnoredCapture).toMatchObject({
      id: ignoredCapture.id,
      status: "ignored",
      draft: { englishTitle: "Ignored capture" },
      ignoredBy: "integration-test",
    });
    expect(projectedImport).toMatchObject({
      importBatch: { ledgerId: ledger.id, validRowCount: 1 },
      salesRows: [{ platformSku: "SKU-TEST-RED", workspaceId: DEFAULT_WORKSPACE_ID }],
      ledger: { id: ledger.id, status: "cost_pending", currency: "CNY" },
    });
    expect(projectedCostBatch).toMatchObject({
      costBatch: { ledgerId: ledger.id, requestId: request.id, status: "published" },
      rows: [{
        platformSku: "SKU-TEST-RED",
        warehouseSku: "WH-TEST-RED",
        unitCost: 4,
        workspaceId: DEFAULT_WORKSPACE_ID,
      }],
      ledger: { id: ledger.id, costSummary: { missingCount: 0 } },
    });
    expect(projectedLedger).toMatchObject({
      id: ledger.id,
      status: "finalized",
      currency: "CNY",
      profitSummary: { profit: 53 },
      profitLines: [{
        id: expect.any(Number),
        platformSku: "SKU-TEST-RED",
        profit: 53,
        workspaceId: DEFAULT_WORKSPACE_ID,
        ledgerId: ledger.id,
      }],
    });

    db.close();
    await db.delete();
    await db.open();
    await expect(restoreWorkspaceSyncRecoveryPayload(recoveryPayload, "recovery-test")).resolves.toMatchObject({
      workspaceId: DEFAULT_WORKSPACE_ID,
      eventCount: syncEvents.length,
      cursor: "cloud-integration-1",
    });

    const [restoredProduct] = await listProductCatalogRecords();
    const restoredLedger = await getLedgerSnapshot(ledger.id);
    const restoredReferenceRows = buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
    expect(restoredProduct).toMatchObject({
      id: product.id,
      platformSkc: "SKC-TEST-1",
      skus: [{ platformSku: "SKU-TEST-RED" }],
      offers: [{ landedUnitCost: 8, currency: "CNY" }],
    });
    expect(restoredLedger).toMatchObject({
      ledger: { id: ledger.id, status: "finalized", currency: "CNY" },
      rows: [{ platformSku: "SKU-TEST-RED", quantity: 10 }],
      costs: [{ platformSku: "SKU-TEST-RED", warehouseSku: "WH-TEST-RED", unitCost: 4 }],
    });
    expect(restoredReferenceRows).toMatchObject([{
      platformSku: "SKU-TEST-RED",
      authoritativeSource: "erp",
      referenceUnitCost: 4,
      latestProfit: 53,
    }]);
    const restoredSourceEvents = (await db.auditEvents.toArray()).filter((event) => event.action !== "sync_recovery_restored");
    expect(restoredSourceEvents).toHaveLength(syncEvents.length);
    expect(restoredSourceEvents.every((event) => event.eventId && event.syncState === "synced")).toBe(true);
  });

  it("projects approved 1688 fallback replacements without leaving stale approvals", async () => {
    const ledger = await createOrGetMonthlyLedger({ period, createdBy: "integration-test" });
    const mapping = {
      store: "店铺",
      supplierNumber: "供方货号",
      platformSkc: "平台 SKC",
      platformSku: "平台 SKU",
      quantity: "数量",
      amount: "金额",
    };
    const validation = validateSalesRows([{
      店铺: "美国主店",
      供方货号: "SUP-FALLBACK",
      "平台 SKC": "SKC-FALLBACK-1",
      "平台 SKU": "SKU-FALLBACK-1",
      数量: "2",
      金额: "40",
    }], mapping);
    await saveSalesImport({
      fileName: "fallback-sales.csv",
      mapping,
      summary: { sourceRowCount: 1, errorCount: 0, ignoredCount: 0 },
      rows: validation.rows,
      period,
      storeName: "美国主店",
      importedBy: "integration-test",
    });

    const firstApproval = await saveApproved1688Fallback({
      ledgerId: ledger.id,
      platformSku: "SKU-FALLBACK-1",
      unitCost: 8,
      reason: "ERP 暂无采购记录",
      approvedBy: "reviewer-a",
      referenceSource: "1688 商品页",
    });
    const secondApproval = await saveApproved1688Fallback({
      ledgerId: ledger.id,
      platformSku: "SKU-FALLBACK-1",
      unitCost: 7.5,
      reason: "复核后采用最新落地成本",
      approvedBy: "reviewer-b",
      referenceSource: "1688 商品页",
    });

    const auditRows = await db.auditEvents.orderBy("id").toArray();
    const syncEvents = auditRows.map(auditEventToSyncEvent);
    expect(listBusinessProjectionGaps(syncEvents)).toEqual([]);
    const syncStore = createSyncEventStore();
    syncStore.accept(buildSyncEnvelope({ workspaceId: DEFAULT_WORKSPACE_ID, events: syncEvents }));
    const approvals = syncStore.snapshot().entities
      .map(({ value }) => value)
      .filter((value) => value._entityType === "cost_approval");

    expect(approvals.find((approval) => approval.id === firstApproval.id)).toMatchObject({
      status: "revoked",
      revokedBy: "reviewer-b",
      revokeReason: "已由新的审批记录替换",
    });
    expect(approvals.find((approval) => approval.id === secondApproval.id)).toMatchObject({
      status: "approved",
      approvedAmount: 7.5,
      currency: "CNY",
      referenceCost: { source: "1688 商品页", unitCost: 7.5 },
      ledger: { id: ledger.id, status: "approval_pending", costSummary: { missingCount: 1, approvedFallbackCount: 1 } },
    });

    const staleLedger = await db.ledgers.get(ledger.id);
    await db.ledgers.put({
      ...staleLedger,
      status: "ready",
      costSummary: { ...staleLedger.costSummary, missingCount: 0, formalMatchedCount: 1 },
    });

    await expect(finalizeMonthlyLedger({
      ledgerId: ledger.id,
      formulaVersion: PROFIT_FORMULA_VERSION,
      profitSummary: { revenue: 40, quantity: 2, purchaseCost: 15, warehouseCost: 1.4, penalty: 0, profit: 23.6 },
      profitLines: [{ platformSku: "SKU-FALLBACK-1", finalizable: false }],
    })).rejects.toThrow("缺少正式成本");
  });

  it("rejects an ERP cost publish that has no matching recorded request", async () => {
    const ledger = await createOrGetMonthlyLedger({ period, createdBy: "integration-test" });
    const reconciliation = {
      matches: [{
        status: "matched",
        platformSku: "SKU-UNBOUND",
        canonicalPlatformSku: "SKU-UNBOUND",
        unitCost: 3,
        currency: "CNY",
      }],
      summary: { expectedCount: 1, matchedCount: 1, missingCount: 0 },
      invalidRows: [],
      overrides: [],
    };

    await expect(savePublishedErpCostBatch({
      ledgerId: ledger.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      reconciliation,
      requestId: null,
    })).rejects.toThrow("必须关联已记录的平台 SKC 查询请求");
  });

  it("保存同一 SKC 的多个供应商并分别保留参考报价", async () => {
    const capture = await createManualCaptureRecord({
      name: "多供应商商品",
      sourceUrl: "https://detail.1688.com/offer/multi-supplier",
      sourceProductId: "1688-MULTI-SUPPLIER-1",
      supplierCode: "SUP-A",
      supplierName: "供应商 A",
    });
    await saveProductCatalogRecord({
      captureId: capture.id,
      status: "active",
      draft: {
        ...capture.draft,
        name: "多供应商商品",
        platformSkc: "SKC-MULTI-SUPPLIER-1",
        salesStatus: "observing",
        tags: ["高潜", "待比价"],
        variants: [{ id: "VAR-1", attribute: "默认", platformSku: "SKU-MULTI-SUPPLIER-1", purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1 }],
        suppliers: [
          { id: "SUPPLIER-A", supplierCode: "SUP-A", supplierName: "供应商 A", sourceUrl: "https://detail.1688.com/offer/a", variants: [{ platformSku: "SKU-MULTI-SUPPLIER-1", purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1 }] },
          { id: "SUPPLIER-B", supplierCode: "SUP-B", supplierName: "供应商 B", sourceUrl: "https://detail.1688.com/offer/b", variants: [{ platformSku: "SKU-MULTI-SUPPLIER-1", purchaseUnitPrice: 8, purchasePackCount: 1, unitsPerPack: 1 }] },
        ],
      },
    });
    const [product] = await listProductCatalogRecords();
    expect(product).toMatchObject({ salesStatus: "observing", supplierCount: 2 });
    expect(product.offers.map((offer) => offer.supplierCode).toSorted()).toEqual(["SUP-A", "SUP-B"]);
    expect(product.offers.map((offer) => offer.landedUnitCost).toSorted((a, b) => a - b)).toEqual([8, 10]);
  });

  it("批量更新可见商品的选品状态并记录每条审计事件", async () => {
    const saveProduct = (name, skc, sku) => saveProductCatalogRecord({
      status: "active",
      savedBy: "integration-test",
      draft: {
        name,
        platformSkc: skc,
        variants: [{ attribute: "默认", platformSku: sku, purchaseUnitPrice: 5, purchasePackCount: 1, unitsPerPack: 1 }],
      },
    });
    const [{ product: first }, { product: second }] = await Promise.all([
      saveProduct("批量状态商品 A", "SKC-BULK-A", "SKU-BULK-A"),
      saveProduct("批量状态商品 B", "SKC-BULK-B", "SKU-BULK-B"),
    ]);

    await expect(bulkUpdateProductCatalogSalesStatus({
      productIds: [first.id, second.id],
      salesStatus: "off_sale",
      updatedBy: "reviewer-a",
    })).resolves.toHaveLength(2);

    const records = await listProductCatalogRecords();
    expect(records.filter((product) => [first.id, second.id].includes(product.id)).map((product) => product.salesStatus)).toEqual(["off_sale", "off_sale"]);
    const events = (await db.auditEvents.toArray()).filter((event) => event.action === "product_sales_status_bulk_updated");
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.actorId === "reviewer-a" && event.after.salesStatus === "off_sale" && event.after.batchSize === 2)).toBe(true);
  });

  it("人工合并重复 SKC 时保留来源 SKU、报价历史、人工成本和已确认采集", async () => {
    const { product: primary } = await saveProductCatalogRecord({
      status: "active",
      savedBy: "integration-test",
      draft: {
        name: "重复 SKC 主档",
        platformSkc: "SKC-MERGE-1",
        tags: ["主档标签"],
        notes: "主档备注",
        variants: [{ attribute: "黑色", platformSku: "SKU-MERGE-BLACK", purchaseUnitPrice: 8, purchasePackCount: 1, unitsPerPack: 1, salePrice: 25 }],
      },
    });
    const capture = await createManualCaptureRecord({
      name: "重复 SKC 来源档",
      sourceUrl: "https://detail.1688.com/offer/merge-source",
      sourceProductId: "1688-MERGE-SOURCE",
      supplierCode: "SUP-MERGE",
      supplierName: "合并供应商",
    });
    const sourceDraft = {
      ...capture.draft,
      name: "重复 SKC 来源档",
      platformSkc: "SKC-MERGE-1",
      tags: ["来源标签"],
      notes: "来源档备注",
      variants: [{ attribute: "白色", platformSku: "SKU-MERGE-WHITE", purchaseUnitPrice: 10, purchasePackCount: 1, unitsPerPack: 1, salePrice: 28 }],
    };
    const { product: source } = await saveProductCatalogRecord({ captureId: capture.id, status: "active", savedBy: "integration-test", draft: sourceDraft });
    await saveProductCatalogRecord({
      productId: source.id,
      status: "active",
      savedBy: "integration-test",
      draft: { ...sourceDraft, variants: [{ ...sourceDraft.variants[0], purchaseUnitPrice: 12 }] },
    });
    const manualCost = await saveCatalogManualCost({
      productId: source.id,
      platformSku: "SKU-MERGE-WHITE",
      amount: 11.5,
      note: "人工复核后的落地成本",
      confirmedBy: "reviewer-a",
    });

    await expect(previewProductSkcMerge({ primaryProductId: primary.id, sourceProductIds: [source.id] })).resolves.toMatchObject({
      primaryProductId: primary.id,
      movedSkuCount: 1,
      movedSupplierOfferCount: 1,
      retainedSupplierOfferHistoryCount: 1,
      movedManualCostCount: 1,
      mergedTags: expect.arrayContaining(["主档标签", "来源标签"]),
    });
    const merged = await mergeProductSkcRecords({ primaryProductId: primary.id, sourceProductIds: [source.id], mergedBy: "reviewer-a" });
    expect(merged).toMatchObject({ product: { id: primary.id }, mergedSourceCount: 1 });

    const catalog = await listProductCatalogRecords();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: primary.id,
      tags: expect.arrayContaining(["主档标签", "来源标签"]),
      notes: expect.stringContaining("来源档备注"),
    });
    expect(catalog[0].skus.map((sku) => sku.platformSku).toSorted()).toEqual(["SKU-MERGE-BLACK", "SKU-MERGE-WHITE"]);
    expect((await db.supplierOffers.where("productId").equals(primary.id).toArray()).filter((offer) => offer.status === "superseded")).toHaveLength(1);
    expect(await db.catalogManualCosts.get(manualCost.id)).toMatchObject({ productId: primary.id, platformSku: "SKU-MERGE-WHITE" });
    expect(await db.captures.get(capture.id)).toMatchObject({ confirmedProductId: primary.id });
    expect(await db.products.get(source.id)).toBeUndefined();

    const mergeActions = (await db.auditEvents.orderBy("id").toArray()).map((item) => item.action);
    expect(mergeActions.lastIndexOf("product_deleted")).toBeLessThan(mergeActions.lastIndexOf("product_merged"));
    expect(mergeActions.lastIndexOf("product_merged")).toBeLessThan(mergeActions.lastIndexOf("catalog_manual_cost_relinked"));
    expect(mergeActions.lastIndexOf("catalog_manual_cost_relinked")).toBeLessThan(mergeActions.lastIndexOf("capture_product_relinked"));

    const events = (await db.auditEvents.toArray()).map(auditEventToSyncEvent);
    const recovery = buildSyncRecoveryPayload({ workspaceId: DEFAULT_WORKSPACE_ID, cursor: "merge-recovery", generatedAt: now, workspace: await db.workspaces.get(DEFAULT_WORKSPACE_ID), events });
    db.close();
    await db.delete();
    await db.open();
    await restoreWorkspaceSyncRecoveryPayload(recovery, "recovery-test");
    const [restored] = await listProductCatalogRecords();
    expect(restored).toMatchObject({ id: primary.id, skuCount: 2 });
    expect(restored.skus.map((sku) => sku.platformSku).toSorted()).toEqual(["SKU-MERGE-BLACK", "SKU-MERGE-WHITE"]);
    expect(await db.catalogManualCosts.get(manualCost.id)).toMatchObject({ productId: primary.id });
    expect(await db.captures.get(capture.id)).toMatchObject({ confirmedProductId: primary.id });
  });

  it("按销售账号隔离选品资料，但不隔离利润账本", async () => {
    await setActiveMemberContext({ memberId: "sales-a", role: "selection" });
    const privateCapture = await createManualCaptureRecord({
      name: "销售 A 私有商品",
      sourceUrl: "https://detail.1688.com/offer/private-a",
      sourceProductId: "1688-PRIVATE-A",
      supplierCode: "SUP-A",
    });
    await saveProductCatalogRecord({
      captureId: privateCapture.id,
      status: "active",
      draft: {
        ...privateCapture.draft,
        name: "销售 A 私有商品",
        platformSkc: "SKC-PRIVATE-A",
        variants: [{ attribute: "默认", platformSku: "SKU-PRIVATE-A", purchaseUnitPrice: 5, purchasePackCount: 1, unitsPerPack: 1 }],
      },
    });
    await createOrGetMonthlyLedger({ period: "2026-08", createdBy: "sales-a" });

    await setActiveMemberContext({ memberId: "sales-b", role: "selection" });
    expect(await listProductCatalogRecords()).toHaveLength(0);
    await setActiveMemberContext({ memberId: "admin-1", role: "admin" });
    expect((await listProductCatalogRecords()).map((item) => item.name)).toContain("销售 A 私有商品");
    await setActiveMemberContext({ memberId: "sales-b", role: "selection" });
    const summary = await getWorkspaceOperationalSummary();
    expect(summary.productCount).toBe(0);
    expect(summary.openLedgerCount).toBe(1);
  });

  it("按当前工作区隔离选品参考与平台 SKU", async () => {
    await setActiveMemberContext({ memberId: "admin-a", role: "admin", workspaceId: "workspace-a" });
    const capture = await createManualCaptureRecord({
      name: "工作区 A 商品",
      sourceUrl: "https://detail.1688.com/offer/workspace-a",
      sourceProductId: "1688-WORKSPACE-A",
      workspaceId: "workspace-a",
    });
    await saveProductCatalogRecord({
      workspaceId: "workspace-a",
      captureId: capture.id,
      status: "active",
      draft: {
        ...capture.draft,
        name: "工作区 A 商品",
        platformSkc: "SKC-WORKSPACE-A",
        variants: [{ attribute: "默认", platformSku: "SKU-WORKSPACE-A", purchaseUnitPrice: 5, purchasePackCount: 1, unitsPerPack: 1 }],
      },
    });
    await setActiveMemberContext({ memberId: "admin-b", role: "admin", workspaceId: "workspace-b" });
    expect(await listProductCatalogRecords()).toHaveLength(0);
    const reference = await getSelectionReferenceSnapshot();
    expect(reference.products).toHaveLength(0);
    expect(reference.platformSkus).toHaveLength(0);
  });
});
