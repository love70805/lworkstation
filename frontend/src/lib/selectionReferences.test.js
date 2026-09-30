import { describe, expect, it } from "vitest";
import { buildSelectionReferenceRows, groupSelectionReferenceRows } from "./selectionReferences";
import { createSalesSourceCoverage } from "../domain/selectionSalesLabels";

describe("selection reference rows", () => {
  it("ranks cover candidates by net sales in the catalog receipt's ledger, not finalized history or the seven-day window", () => {
    const input = { workspaceId: "W", ledgers: [{ id: "CURRENT", workspaceId: "W", period: "2026-08" }, { id: "OLD", workspaceId: "W", period: "2026-07" }],
      erpCatalogRows: ["A", "B"].map(sku => ({ workspaceId: "W", ledgerId: "CURRENT", platformSkc: "SKC", platformSku: sku, warehouseSku: `WH-${sku}`, productName: "商品", imageUrl: `https://images.example.invalid/${sku}.jpg`, publishedAt: "2026-09-01T00:00:00Z" })),
      importBatches: [{ id: "BATCH", workspaceId: "W", ledgerId: "CURRENT", status: "completed", store: "店", fileHash: "FILE" }, { id: "OLD-BATCH", workspaceId: "W", ledgerId: "OLD", status: "completed", store: "店" }],
      salesRows: [{ id: "A1", workspaceId: "W", ledgerId: "CURRENT", batchId: "BATCH", store: "店", sourceRow: 1, platformSkc: "SKC", platformSku: "A", quantityExact: "120" }, { id: "A2", workspaceId: "W", ledgerId: "CURRENT", batchId: "BATCH", store: "店", sourceRow: 2, platformSkc: "SKC", platformSku: "A", quantityExact: "-20" }, { id: "B1", workspaceId: "W", ledgerId: "CURRENT", batchId: "BATCH", store: "店", sourceRow: 3, platformSkc: "SKC", platformSku: "B", quantityExact: "101" }, { id: "OLD", workspaceId: "W", ledgerId: "OLD", batchId: "OLD-BATCH", store: "店", sourceRow: 1, platformSkc: "SKC", platformSku: "A", quantityExact: "999" }] };
    const rows = buildSelectionReferenceRows(input);
    expect(rows.find(row => row.platformSku === "A").coverSalesQuantity).toBe(100);
    expect(rows.find(row => row.platformSku === "B").coverSalesQuantity).toBe(101);
  });
  it("uses the latest catalog receipt even when it supplements an older accounting month", () => {
    const rows = buildSelectionReferenceRows({ workspaceId: "W", ledgers: [{ id: "OLD", workspaceId: "W", period: "2026-07" }, { id: "NEW", workspaceId: "W", period: "2026-08" }],
      erpCatalogRows: [{ workspaceId: "W", ledgerId: "NEW", platformSkc: "SKC", platformSku: "A", warehouseSku: "WH-A", publishedAt: "2026-09-01T00:00:00Z" }, { workspaceId: "W", ledgerId: "OLD", platformSkc: "SKC", platformSku: "B", warehouseSku: "WH-B", publishedAt: "2026-09-05T00:00:00Z" }],
      importBatches: [{ id: "BA", workspaceId: "W", ledgerId: "NEW", status: "completed", store: "店" }, { id: "BB", workspaceId: "W", ledgerId: "OLD", status: "completed", store: "店" }],
      salesRows: [{ id: "SA", workspaceId: "W", ledgerId: "NEW", batchId: "BA", store: "店", platformSkc: "SKC", platformSku: "A", quantity: 100 }, { id: "SB", workspaceId: "W", ledgerId: "OLD", batchId: "BB", store: "店", platformSkc: "SKC", platformSku: "B", quantity: 20 }] });
    expect(rows.find(row => row.platformSku === "A").coverSalesQuantity).toBeNull();
    expect(rows.find(row => row.platformSku === "B").coverSalesQuantity).toBe(20);
  });
  it("uses the selected store's latest complete month for its seven-day tag", () => {
    const input = { workspaceId: "W", platformSkus: [{ platformSku: "SKU-A", platformSkc: "SKC-A", store: "甲店" }], ledgers: [{ id: "AUG", workspaceId: "W", period: "2026-08" }, { id: "JUL", workspaceId: "W", period: "2026-07" }],
      importBatches: [{ id: "A", workspaceId: "W", ledgerId: "AUG", period: "2026-08", store: "甲店", status: "completed", validRowCount: 1, sourceCoverage: createSalesSourceCoverage({ period: "2026-08", storeName: "甲店" }) }, { id: "B", workspaceId: "W", ledgerId: "JUL", period: "2026-07", store: "乙店", status: "completed", validRowCount: 1, sourceCoverage: createSalesSourceCoverage({ period: "2026-07", storeName: "乙店" }) }],
      salesRows: [{ id: "R1", workspaceId: "W", ledgerId: "AUG", batchId: "A", store: "甲店", platformSku: "SKU-A", platformSkc: "SKC-A", sourceRow: 1, sourceAddedDate: "2026-08-30", quantityExact: "100" }, { id: "R2", workspaceId: "W", ledgerId: "JUL", batchId: "B", store: "乙店", platformSku: "SKU-B", platformSkc: "SKC-B", sourceRow: 1, sourceAddedDate: "2026-07-30", quantityExact: "20" }] };
    expect(buildSelectionReferenceRows({ ...input, store: "all" })[0].automaticSalesTag).toMatchObject({ status: "ready", period: "2026-08", quantityExact: "100", label: "高销" });
    expect(buildSelectionReferenceRows({ ...input, store: "甲店" })[0].automaticSalesTag).toMatchObject({ period: "2026-08", quantityExact: "100", label: "高销" });
  });
  it("prefers ERP history and calculates a reference unit profit", () => {
    const [row] = buildSelectionReferenceRows({
      erpCosts: [{ id: "ERP-1", platformSku: "SKU-A", unitCost: 4, currency: "CNY", publishedAt: "2026-08-01T00:00:00Z" }],
      profitLines: [{
        id: 1,
        ledgerId: "LEDGER-1",
        period: "2026-07",
        platformSku: "SKU-A",
        quantity: 10,
        revenue: 100,
        warehouseCost: 7,
        profit: 53,
        profitRate: 53,
        unitCost: 4,
        finalizedAt: "2026-07-31T00:00:00Z",
      }],
      supplierOffers: [{ id: "OFFER-1", platformSku: "SKU-A", landedUnitCost: 8 }],
    });

    expect(row.referenceUnitCost).toBe(4);
    expect(row.authoritativeSource).toBe("erp");
    expect(row.referenceUnitProfit).toBe(5.3);
    expect(row.referenceProfitRate).toBe(53);
  });

  it("aggregates the latest three finalized months without mixing reference and exact results", () => {
    const rows = buildSelectionReferenceRows({
      profitLines: [
        { ledgerId: "L1", period: "2026-08", platformSku: "SKU-A", quantity: 2, revenue: 20, profit: 8, unitCost: 5, warehouseCost: 2, finalizedAt: "2026-08-05T00:00:00Z" },
        { ledgerId: "L2", period: "2026-07", platformSku: "SKU-A", quantity: 3, revenue: 30, profit: 12, unitCost: 5, warehouseCost: 3, finalizedAt: "2026-07-31T00:00:00Z" },
        { ledgerId: "L3", period: "2026-06", platformSku: "SKU-A", quantity: 4, revenue: 40, profit: 16, unitCost: 5, warehouseCost: 4, finalizedAt: "2026-06-30T00:00:00Z" },
        { ledgerId: "L4", period: "2026-05", platformSku: "SKU-A", quantity: 100, revenue: 1000, profit: 400, unitCost: 5, warehouseCost: 100, finalizedAt: "2026-05-31T00:00:00Z" },
      ],
    });

    expect(rows[0]).toMatchObject({
      latestPeriod: "2026-08",
      recentMonthCount: 3,
      recentQuantity: 9,
      recentRevenue: 90,
      recentProfit: 36,
      referenceCalculationMode: "reference",
    });
  });

  it("keeps the ERP cost evidence chain available to the selection workspace", () => {
    const [row] = buildSelectionReferenceRows({
      platformSkus: [{
        id: "SKU-ROW-1",
        platformSku: "sku-a",
        canonicalPlatformSku: "SKU-A",
        platformSkc: "SKC-A",
        productId: "PROD-1",
      }],
      products: [{ id: "PROD-1", name: "测试商品", status: "active" }],
      supplierOffers: [{ id: "OFFER-1", platformSku: "SKU-A", landedUnitCost: 9, currency: "CNY" }],
      erpCosts: [{
        id: "ERP-COST-1",
        ledgerId: "LEDGER-2026-08",
        platformSku: "SKU-A",
        platformSkc: "SKC-A",
        unitCost: 4,
        currency: "CNY",
        publishedAt: "2026-08-07T00:00:00Z",
      }],
      profitLines: [{
        ledgerId: "LEDGER-2026-07",
        period: "2026-07",
        platformSku: "SKU-A",
        platformSkc: "SKC-A",
        quantity: 10,
        revenue: 100,
        warehouseCost: 7,
        unitCost: 5,
        profit: 43,
        costSource: "approved_1688",
        costApprovalId: "APPROVAL-1",
        finalizedAt: "2026-07-31T00:00:00Z",
      }],
    });

    expect(row).toMatchObject({
      platformSku: "sku-a",
      platformSkc: "SKC-A",
      productId: "PROD-1",
      productName: "测试商品",
      referenceUnitCost: 4,
      referenceKind: "erp_history",
      authoritativeSource: "erp",
      referenceCostId: "ERP-COST-1",
      referenceLedgerId: "LEDGER-2026-08",
      referenceApprovalId: null,
      referenceCurrency: "CNY",
    });
  });

  it("uses the manually registered sale price when there is no finalized month yet", () => {
    const [row] = buildSelectionReferenceRows({
      platformSkus: [{ platformSku: "SKU-PRICE", platformSkc: "SKC-PRICE", salePrice: 25 }],
      supplierOffers: [{ platformSku: "SKU-PRICE", landedUnitCost: 10, currency: "CNY" }],
    });

    expect(row.averageSalePrice).toBe(25);
    expect(row.referenceUnitCost).toBe(10);
    expect(row.referenceUnitProfit).toBe(14.3);
  });

  it("uses the active SKU-level confirmed cost before a 1688 reference", () => {
    const [row] = buildSelectionReferenceRows({
      platformSkus: [{ id: "PS-1", platformSku: "SKU-MANUAL", platformSkc: "SKC-MANUAL", salePrice: 30 }],
      catalogManualCosts: [{ id: "MANUAL-1", platformSkuId: "PS-1", platformSku: "SKU-MANUAL", amount: 12, status: "active", confirmedAt: "2026-08-10T08:00:00Z" }],
      supplierOffers: [{ id: "OFFER-1", platformSku: "SKU-MANUAL", landedUnitCost: 10, currency: "CNY" }],
      erpCatalogReferences: [{ id: "ERP-REFERENCE", platformSku: "SKU-MANUAL", warehouseSku: "WH", unitCost: 4, currency: "CNY", referenceOnly: true }],
    });
    expect(row).toMatchObject({ referenceUnitCost: 12, referenceKind: "manual_confirmed", authoritativeSource: "manual_confirmed", referenceCostId: "MANUAL-1", manualCostHistoryCount: 1 });
  });

  it("prefers a complete ERP warehouse purchase reference to a 1688 quote for an unsold SKU", () => {
    const [row] = buildSelectionReferenceRows({
      platformSkus: [{ platformSku: "SKU-UNSOLD", platformSkc: "SKC-1" }],
      erpCatalogRows: [{ platformSku: "SKU-UNSOLD", platformSkc: "SKC-1", warehouseSku: "WH", catalogQuerySkcs: ["SKC-1"] }],
      erpCatalogReferences: [{ id: "ERP-REFERENCE", platformSku: "SKU-UNSOLD", platformSkc: "SKC-1", warehouseSku: "WH", unitCost: 3.2032, currency: "CNY", referenceOnly: true }],
      supplierOffers: [{ id: "OFFER-1", platformSku: "SKU-UNSOLD", landedUnitCost: 8.5, currency: "CNY" }],
    });
    expect(row).toMatchObject({ referenceUnitCost: 3.2032, referenceKind: "erp_catalog_reference", latestQuantity: 0 });
  });

  it("ignores superseded supplier quotations when resolving a current reference", () => {
    const [row] = buildSelectionReferenceRows({
      platformSkus: [{ platformSku: "SKU-HISTORY", platformSkc: "SKC-HISTORY" }],
      supplierOffers: [
        { id: "OFFER-OLD", platformSku: "SKU-HISTORY", landedUnitCost: 8, status: "superseded", calculatedAt: "2026-08-01T00:00:00Z" },
        { id: "OFFER-CURRENT", platformSku: "SKU-HISTORY", landedUnitCost: 10, status: "active", calculatedAt: "2026-08-02T00:00:00Z" },
      ],
    });
    expect(row).toMatchObject({ referenceUnitCost: 10, referenceCostId: "OFFER-CURRENT", referenceKind: "supplier_landed" });
  });

  it("groups SKU variants by platform SKC for the workbench view", () => {
    const rows = buildSelectionReferenceRows({
      platformSkus: [
        { platformSku: "SKU-RED", platformSkc: "SKC-1" },
        { platformSku: "SKU-BLUE", platformSkc: "SKC-1" },
      ],
    });
    const groups = groupSelectionReferenceRows(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ platformSkc: "SKC-1", skuCount: 2 });
    expect(groups[0].variants.map((item) => item.platformSku).toSorted()).toEqual(["SKU-BLUE", "SKU-RED"]);
  });
});

it("never fills a tied or manually cleared current price with historical average revenue", () => {
  const input = { workspaceId: "W", ledgers: [{ id: "L", workspaceId: "W", period: "2026-08" }], importBatches: [{ id: "B", workspaceId: "W", ledgerId: "L", status: "completed", store: "店" }], ledgerIdentityRows: [{ platformSku: "A", platformSkc: "S", store: "店" }], salesRows: [10,12].map((unitPrice,index) => ({ id: `R${index}`, sourceRow: index+2, workspaceId: "W", ledgerId: "L", batchId: "B", store: "店", platformSku: "A", platformSkc: "S", quantity: 1, unitPrice, rawAddedAt: "2026-08-31 12:00:00" })), erpCosts: [{ platformSku: "A", unitCost: 2 }], profitLines: [{ platformSku: "A", quantity: 10, revenue: 990, period: "2026-07" }] };
  const [tied] = buildSelectionReferenceRows(input);
  expect(tied).toMatchObject({ ledgerSalePrice: { status: "choose" }, catalogSalePrice: null, averageSalePrice: null, historicalAverageSalePrice: 99, referenceUnitProfit: null });
  const [cleared] = buildSelectionReferenceRows({ ...input, salesRows: [input.salesRows[0]], platformSkus: [{ platformSku: "A", productId: "P", salePrice: null, salePriceSource: { kind: "manual" } }], products: [{ id: "P", platformSkc: "S", attributes: { fieldEdits: { variants: { A: { salePrice: true } } } } }] });
  expect(cleared).toMatchObject({ catalogSalePrice: null, averageSalePrice: null, referenceUnitProfit: null });
});
