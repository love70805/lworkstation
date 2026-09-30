import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.join(toolsRoot, "..", "integrations", "erp-assistant-extension", "src", "result-policy.js");
const sandbox = { window: {}, URL };
sandbox.globalThis = sandbox.window;
vm.runInNewContext(await readFile(policyPath, "utf8"), sandbox, { filename: policyPath });
const policy = sandbox.window.ShopeersErpResultPolicy;

assert.ok(policy, "result policy should expose its browser API");

const mappings = policy.normalizeMappings([
  { barcodeSkuid: "SKU-TARGET-RED", barcodeSkcid: "SKC-TARGET", barcodeArticleNumber: "YW-672-LYYY", platform: "Shein", storeName: "恩昭672" },
  { barcodeSkuid: "SKU-TARGET-BLUE", barcodeSkcid: "skc-target", barcodeArticleNumber: "YW-672-LYYY", platform: "Shein", storeName: "恩昭672" },
  { barcodeSkuid: "SKU-OTHER", barcodeSkcid: "SKC-OTHER", barcodeArticleNumber: "YW-OTHER", platform: "Shein", storeName: "恩昭27" },
  { barcodeSkuid: "SKU-TARGET-RED", barcodeSkcid: "SKC-TARGET", storeName: "重复映射" },
  { barcodeSkuid: "SKU-MISSING-SKC", storeName: "缺少 SKC" },
]);

assert.deepEqual(
  JSON.parse(JSON.stringify(mappings.map((item) => [item.platformSku, item.platformSkc, item.articleNumber]))),
  [
    ["SKU-OTHER", "SKC-OTHER", "YW-OTHER"],
    ["SKU-TARGET-BLUE", "skc-target", "YW-672-LYYY"],
    ["SKU-TARGET-RED", "SKC-TARGET", "YW-672-LYYY"],
  ],
);

const fullResults = [
  { warehouseSku: "WH-ONE", mappings },
  { warehouseSku: "WH-TWO", mappings: [{ platformSku: "SKU-SECOND", platformSkc: "SKC-SECOND" }] },
];

const targetScope = policy.filterResultsByMappingScope(fullResults, ["skc-target"]);
assert.equal(targetScope.scoped, true);
assert.equal(targetScope.results.length, 1);
assert.deepEqual(Array.from(targetScope.results[0].mappings, (item) => item.platformSku), ["SKU-TARGET-BLUE", "SKU-TARGET-RED"]);
assert.equal(targetScope.excludedMappingCount, 2);
assert.equal(targetScope.excludedWarehouseSkuCount, 1);
assert.equal(fullResults[0].mappings.length, 3, "scope filtering must not narrow the full cache/result source");

const skuScope = policy.filterResultsByMappingScope(fullResults, ["sku-target-red"]);
assert.deepEqual(Array.from(skuScope.results[0].mappings, (item) => item.platformSkc), ["SKC-TARGET"]);

const warehouseScope = policy.filterResultsByMappingScope(fullResults, ["wh-one"]);
assert.equal(warehouseScope.results.length, 1);
assert.equal(warehouseScope.results[0].mappings.length, 3, "an explicit warehouse SKU query keeps that warehouse's complete mapping list");

const noScope = policy.filterResultsByMappingScope(fullResults, []);
assert.equal(noScope.scoped, false);
assert.equal(noScope.results.length, 2);
assert.equal(noScope.results[0].mappings.length, 3);

const mappingPartition = policy.partitionResultsByMapping([
  { warehouseSku: "WH-MAPPED", mappings: [{ platformSku: "SKU-MAPPED", platformSkc: "SKC-TARGET" }] },
  {
    warehouseSku: "WH-EVIDENCE-ONLY",
    mappings: [],
    details: [{ recordId: "PURCHASE-1", unitPrice: 3.2, quantity: 20 }],
    orderNumber: "PO-CALCULATED",
    sourceType: "erp_purchase_weighted",
    name: "完整预览商品",
    calcTimes: 1,
    dateRange: "2026-07-01",
    totalQty: 20,
    totalPrice: 64,
    unitCost: 3.2,
    supplierName: "完整预览供应商",
    supplier1688Url: "https://detail.1688.com/offer/730242606884.html",
    selectedRecordIds: ["PURCHASE-1"],
    sourceWarnings: ["existing_warning"],
    costWarnings: { count: 1, reasons: ["unit_price_one"], records: [{ recordId: "PURCHASE-0", unitPrice: 1, reasons: ["unit_price_one"] }] },
  },
]);
assert.deepEqual(Array.from(mappingPartition.mapped, (item) => item.warehouseSku), ["WH-MAPPED"]);
assert.deepEqual(Array.from(mappingPartition.evidenceOnly, (item) => item.warehouseSku), ["WH-EVIDENCE-ONLY"]);
const evidenceOnlyResults = policy.buildEvidenceOnlyResults({
  unmappedResults: mappingPartition.evidenceOnly,
  sourceRecords: [
    { warehouseSku: "WH-EVIDENCE-ONLY", purchaseOrderNo: "PO-POOR", supplierName: "不应覆盖" },
    { warehouseSku: "WH-SOURCE-ONLY", purchaseOrderNo: "PO-SOURCE", productName: "纯排除证据", supplierName: "来源供应商" },
  ],
  excludedWarehouseSkus: ["WH-MAPPED"],
});
assert.deepEqual(JSON.parse(JSON.stringify(evidenceOnlyResults)), [
  {
    warehouseSku: "WH-EVIDENCE-ONLY",
    mappings: [],
    details: [{ recordId: "PURCHASE-1", unitPrice: 3.2, quantity: 20 }],
    orderNumber: "PO-CALCULATED",
    sourceType: "erp_purchase_weighted",
    name: "完整预览商品",
    calcTimes: 1,
    dateRange: "2026-07-01",
    totalQty: 20,
    totalPrice: 64,
    unitCost: 3.2,
    supplierName: "完整预览供应商",
    supplier1688Url: "https://detail.1688.com/offer/730242606884.html",
    selectedRecordIds: ["PURCHASE-1"],
    sourceWarnings: ["existing_warning", "evidence_only_warehouse_sku", "mapping_missing_for_warehouse_sku"],
    costWarnings: { count: 1, reasons: ["unit_price_one"], records: [{ recordId: "PURCHASE-0", unitPrice: 1, reasons: ["unit_price_one"] }] },
  },
  {
    warehouseSku: "WH-SOURCE-ONLY",
    mappings: [],
    details: [],
    orderNumber: "PO-SOURCE",
    sourceType: "evidence_only",
    name: "纯排除证据",
    calcTimes: 0,
    dateRange: "",
    totalQty: null,
    totalPrice: null,
    unitCost: null,
    supplierName: "来源供应商",
    supplier1688Url: "",
    selectedRecordIds: [],
    sourceWarnings: ["evidence_only_warehouse_sku"],
    costWarnings: { count: 0, reasons: [], records: [] },
  },
]);

assert.equal(
  policy.extractSupplier1688Url({ supplierUrl: "<a href=\"https://detail.1688.com/offer/730242606884.html?trace=erp\">供应商</a>" }),
  "https://detail.1688.com/offer/730242606884.html",
);
assert.equal(
  policy.extractSupplier1688Url({ offerId: "730242606884" }),
  "https://detail.1688.com/offer/730242606884.html",
);
assert.equal(
  policy.extractSupplier1688Url({ href: "https://xinjie.1688.com/page/offerlist.htm?spm=erp" }),
  "https://xinjie.1688.com/page/offerlist.htm?spm=erp",
);
assert.equal(policy.extractSupplier1688Url({ href: "https://xinjie.1688.com.evil.example/offer/730242606884.html" }), "");

// Synthetic carrier fixtures validate transport; these do not claim real ERP
// picture/specification aliases, which still require a purchase-detail response.
const catalogFixture = [
  { barcodeSkuid: "SKU-RED", barcodeSkcid: "SKC-CATALOG", productName: "ERP 红色商品", imageUrl: "https://images.example/red.jpg", attribute: "红色/M", storeName: "店铺甲", platform: "Shein" },
  { barcodeSkuid: "SKU-BLUE", barcodeSkcid: "SKC-CATALOG", productName: "ERP 蓝色商品", imageUrl: "https://images.example/blue.jpg", attribute: "蓝色/L" },
  { barcodeSkuid: "SKU-RED", barcodeSkcid: "SKC-CONFLICT", attribute: "不同归属" },
];
const catalogMappings = JSON.parse(JSON.stringify(policy.normalizeCatalogMappings([...catalogFixture, catalogFixture[0]], "WH-CATALOG")));
assert.equal(catalogMappings.length, 3, "only fully identical candidates are deduplicated; conflicting SKU ownership remains inspectable");
assert.equal(catalogMappings[1].attribute, "蓝色/L");
assert.equal(catalogMappings[1].warehouseSku, "WH-CATALOG");
assert.equal(catalogMappings[0].imageUrl, "https://images.example/red.jpg");
assert.equal(catalogMappings[0].storeName, "店铺甲");
const verifiedMapping = policy.normalizeCatalogMappings([{ barcodeSkuid: 'SKU-EXPLICIT', barcodeSkcid: 'SKC-CATALOG', associatedProductId: 'WH-CATALOG', unitConversion: { warehouseUnits: 2, platformUnits: 1, source: 'erp_platform_mapping', sourceRef: 'ERP-MAP-1' } }], 'WH-CATALOG')[0];
assert.deepEqual(JSON.parse(JSON.stringify(policy.normalizeMappings([verifiedMapping])[0].unitConversion)), { warehouseUnits: 2, platformUnits: 1, source: 'erp_platform_mapping', sourceRef: 'ERP-MAP-1' });
assert.equal(policy.normalizeCatalogMappings([{ barcodeSkuid: 'SKU-RATIO', barcodeSkcid: 'SKC-CATALOG', proportionOfGoodsPurchased1688: '1-1' }])[0].unitConversion, undefined, '1688 purchase ratio is not platform-to-warehouse conversion');
assert.equal(policy.canonicalImageUrl("javascript:alert(1)"), "");
assert.equal(policy.canonicalImageUrl("https://user:pass@images.example/red.jpg"), "");
assert.equal(policy.canonicalImageUrl("https://images.example/red.jpg?token=secret"), "");
assert.equal(policy.catalogText({ value: "不要变成对象名称" }), "");
const purchaseCatalog = JSON.parse(JSON.stringify(policy.purchaseCatalogFromDetail({
  picturesLinking: "https://images.example.invalid/warehouse.jpg",
  pictureLink1688: "https://images.example.invalid/1688.jpg",
  purchaseSpecificationAndModel1688: "采购规格",
  model1688: "红色",
  purchaseProportion1688: "1-1",
  purchaseOrderDetailId: "DETAIL-1", purchaseOrderId: "PO-1", purchaseOrderNo: "PO-1", lineNumber: 0,
  supplierId: "SUPPLIER-1", barcodeSkuid: "", barcodeSkcid: null,
  unexpectedSecret: "do-not-keep",
})));
assert.equal(Object.keys(purchaseCatalog).length, 14);
assert.equal(purchaseCatalog.lineNumber, "0");
assert.equal(purchaseCatalog.barcodeSkuid, null);
assert.equal(purchaseCatalog.barcodeSkcid, null);
assert.equal(purchaseCatalog.purchaseProportion1688, "1-1");
assert.equal(purchaseCatalog.specificationAndModel, null);
assert.equal(purchaseCatalog.productColor, null);
assert.equal(purchaseCatalog.unexpectedSecret, undefined);
assert.equal(policy.purchaseImageUrl({ picturesLinking: purchaseCatalog.picturesLinking, pictureLink1688: purchaseCatalog.pictureLink1688, imageUrl: "https://images.example.invalid/generic.jpg" }), purchaseCatalog.picturesLinking);
assert.equal(policy.purchaseImageUrl({ picturesLinking: "javascript:alert(1)", pictureLink1688: purchaseCatalog.pictureLink1688 }), purchaseCatalog.pictureLink1688);
assert.equal(policy.purchaseImageUrl({ imageUrl: "https://images.example.invalid/generic.jpg" }), "https://images.example.invalid/generic.jpg");
assert.equal(policy.purchaseImageUrl({ purchaseOrderId: "PO-1", purchaseCatalog, imageUrl: "https://images.example.invalid/generic.jpg" }), purchaseCatalog.picturesLinking, "canonical nested metadata stays authoritative after evidence normalization");
assert.equal(policy.normalizePurchaseCatalog({ lineNumber: Number.NaN }).lineNumber, null);
assert.equal(policy.purchaseCatalogFromDetail({ imageUrl: "https://images.example.invalid/generic.jpg" }), null);
const typedLinks = JSON.parse(JSON.stringify(policy.extractSupplier1688Links({
  productUrl: "https://detail.1688.com/offer/730242606884.html?trace=erp",
  storeUrl: "https://xinjie.1688.com/page/offerlist.htm",
}, "供应商甲")));
assert.deepEqual(typedLinks, [
  { type: "product", url: "https://detail.1688.com/offer/730242606884.html", supplierName: "供应商甲" },
  { type: "store", url: "https://xinjie.1688.com/page/offerlist.htm", supplierName: "供应商甲" },
]);
assert.equal(policy.normalizeSupplier1688Links([{ type: "product", url: typedLinks[1].url }]).length, 0);
assert.equal(policy.normalizeSupplier1688Links([{ type: "product", url: `https://attacker.example/?redirect=${typedLinks[0].url}` }]).length, 0);
assert.deepEqual(JSON.parse(JSON.stringify(policy.extractSupplier1688Links({
  supplier1688Links: typedLinks,
  _supplier1688Url: "https://detail.1688.com/offer/888888888888.html",
}, "不同供应商"))), typedLinks, "cached context and explicit supplier names must not be relabeled or recaptured");
const pairedPreview = policy.previewForLedger([{ warehouseSku: "WH-PAIR" }], { warehouses: [{ warehouseSku: "WH-PAIR", purchaseRecords: [
  { recordId: "NEW", purchaseDate: "2026-09-02", quantity: 1, unitPrice: 2, supplierName: "供应商乙", supplier1688Url: "" },
  { recordId: "OLD", purchaseDate: "2026-09-01", quantity: 1, unitPrice: 3, supplierName: "供应商甲", supplier1688Url: typedLinks[0].url, supplier1688Links: typedLinks },
] }] }, "2026-09")[0];
assert.equal(pairedPreview.supplierName, "供应商乙");
assert.equal(pairedPreview.supplier1688Url, "", "a different supplier's URL cannot fill the newest supplier's missing link");
assert.deepEqual(JSON.parse(JSON.stringify(pairedPreview.supplier1688Links)), typedLinks);

const warningRecords = policy.annotateCostWarnings([
  { recordId: "R0", unitPrice: 0 },
  { recordId: "R2", unitPrice: 2 },
  { recordId: "R2B", unitPrice: 2 },
]);
assert.deepEqual(JSON.parse(JSON.stringify(warningRecords.map((record) => ({
  recordId: record.recordId,
  reasons: record.warningReasons,
})))), [
  { recordId: "R0", reasons: ["unit_price_zero"] },
  { recordId: "R2", reasons: [] },
  { recordId: "R2B", reasons: [] },
]);
assert.deepEqual(JSON.parse(JSON.stringify(policy.summarizeCostWarnings(warningRecords))), {
  count: 1,
  reasons: ["unit_price_zero"],
  records: [{
    recordId: "R0",
    unitPrice: 0,
    reasons: ["unit_price_zero"],
  }],
});
assert.equal(policy.costWarningLabel("unit_price_one"), "采购单价为 1");
assert.deepEqual(
  JSON.parse(JSON.stringify(policy.annotateCostWarnings([{ recordId: "R1", unitPrice: 1 }])[0].warningReasons)),
  ["unit_price_one"],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(policy.annotateCostWarnings([{ unitPrice: 2 }, { unitPrice: 2 }, { unitPrice: 3 }]).map((record) => record.warningReasons))),
  [[], [], []],
  "a strict majority must not create an extension-side warning",
);
assert.deepEqual(
  JSON.parse(JSON.stringify(policy.annotateCostWarnings([{ unitPrice: 2 }, { unitPrice: 3 }]).map((record) => record.warningReasons))),
  [[], []],
);

async function verifyLedgerScopedEvidenceDelivery() {
  const frontendRequire = createRequire(path.join(toolsRoot, "..", "frontend", "package.json"));
  const { Window } = await import(pathToFileURL(frontendRequire.resolve("happy-dom")).href);
  const collectionTime = new Date("2026-06-15T12:00:00").getTime();
  const detail = (recordId, creationTime, overrides = {}) => ({
    detailId: recordId,
    itemId: "WH-MONTH",
    tradeName: "Synthetic month fixture",
    creationTime,
    purchaseQuantity: "2",
    purchaseUnitPrice: "4",
    ...overrides,
  });
  const current = detail("CURRENT", "2026-06-10 12:00:00");
  const earlier = [
    detail("MAY", "2026-05-31 23:59:59"),
    detail("APRIL", "2026-04-15 12:00:00"),
    detail("MARCH", "2026-03-15 12:00:00"),
    detail("PRIOR-YEAR", "2025-12-31 23:59:59"),
  ];
  const later = detail("LATER", "2026-07-01 00:00:00");
  const invalid = [
    detail("INVALID-QTY", current.creationTime, { purchaseQuantity: "0" }),
    detail("INVALID-DATE", "", {}),
    detail("INVALID-PRICE", current.creationTime, { purchaseUnitPrice: "-1" }),
  ];

  for (const [mixedMonths, ledgerPeriod] of [[false, null], [true, null], [false, "2026-06"], [true, "2026-06"]]) {
    const window = new Window({ url: "https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html" });
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [collectionTime])); }
      static now() { return collectionTime; }
    };
    const sent = [];
    const fetchedOrders = [];
    const validDetails = mixedMonths ? [current, ...earlier, later] : [current];
    const orders = [
      { purchaseOrderId: "PO-1688", purchaseOrderNo1688: "1688-FIXTURE" },
      { purchaseOrderId: "PO-CANCELLED", purchaseStatus: "11" },
      ...(mixedMonths ? [{ purchaseOrderId: "PO-REGULAR", purchaseOrderNo: "REGULAR-FIXTURE" }] : []),
    ];
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sent.push(JSON.parse(JSON.stringify(message)));
          callback(message.type === "shopeers.erp.previewContext"
            ? { ok: Boolean(ledgerPeriod), ledgerPeriod }
            : { ok: true, status: "success", resultDeliveryId: message.payload?.resultDeliveryId });
        },
      },
    };
    window.fetch = async (rawUrl) => {
      const url = new URL(rawUrl);
      let data;
      if (url.pathname === "/purchase/purchase/v1/purchase-order-page") {
        data = orders;
      } else if (url.pathname === "/purchase/purchase/v1/purchase-order-details") {
        const orderId = url.searchParams.get("purchaseOrderId");
        fetchedOrders.push(orderId);
        assert.notEqual(orderId, "PO-CANCELLED", "cancelled orders must remain filtered before detail collection");
        assert.ok(["PO-1688", "PO-REGULAR"].includes(orderId));
        data = orderId === "PO-1688"
          ? [...validDetails, ...invalid]
          : [detail("REGULAR-NEWEST", "2026-08-01 00:00:00")];
      } else if (url.pathname === "/purchase/product/v1/product-page") {
        data = [];
      } else {
        assert.equal(url.pathname, "/purchase/product/v1/product-info-sku", "only fixture ERP endpoints are allowed");
        data = [{ associatedProductId: url.searchParams.get("productId"), platformSku: "SKU-MONTH", platformSkc: "SKC-MONTH" }];
      }
      return { ok: true, json: async () => ({ code: 0, count: data.length, data }) };
    };
    try {
      for (const file of ["result-policy.js", "catalog-collector.js", "request-context.js", "shopeers-bridge.js", "content.js"]) {
        window.eval(await readFile(path.join(path.dirname(policyPath), file), "utf8"));
      }
      window.dispatchEvent(new window.CustomEvent("shopeers:erp-v8-query-captured", {
        detail: { url: "https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-MONTH" },
      }));
      window.document.getElementById("erpa-cost-trigger").click();
      for (let attempt = 0; attempt < 100 && !sent.some((message) => message.type === "shopeers.erp.submitCostResult"); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const deliveries = sent.filter((message) => message.type === "shopeers.erp.submitCostResult");
      assert.equal(deliveries.length, 1, "even a collection-month-only purchase must reach the real bridge transport");
      assert.equal(fetchedOrders.length, mixedMonths ? 2 : 1);
      const { payload } = deliveries[0];
      assert.equal(payload.warehouseEvidence.warehouses.length, 1);
      const records = payload.warehouseEvidence.warehouses[0].purchaseRecords;
      assert.deepEqual(
        records.map((record) => record.recordId).sort(),
        [...validDetails.map((record) => record.detailId), ...(mixedMonths ? ["REGULAR-NEWEST"] : [])].sort(),
        "all valid raw evidence, including earlier, collection and later months, must survive transport for workstation cutoff filtering",
      );
      assert.ok(records.every((record) => record.eligible && record.exclusionReasons.length === 0));
      assert.equal(records.find((record) => record.recordId === "CURRENT").purchaseDate, current.creationTime, "raw purchase timestamps remain intact for nearest-record ordering");
      assert.equal(payload.warehouseEvidence.excludedOrders.length, 1);
      assert.equal(payload.meta.skippedCancelledOrderCount, 1);
      assert.equal(payload.meta.skippedInvalid, invalid.length);
      assert.ok(payload.warehouseEvidence.excludedDetails.every((record) => record.exclusionReasons.join() === "invalid_purchase_detail"));
      assert.equal(payload.warehouseEvidence.excludedDetails.length, invalid.length);
      const expectedPreview = !ledgerPeriod ? [] : mixedMonths ? ["CURRENT", "MAY", "APRIL"] : ["CURRENT"];
      assert.deepEqual(payload.results[0].selectedRecordIds, expectedPreview, "without a trusted month no preview is computed; a trusted month selects nearest eligible records and preserves later raw evidence");
      assert.equal(payload.results[0].sourceType, ledgerPeriod ? "1688" : "", "preview type describes only selected records, never excluded later-month purchases");
      assert.deepEqual(records.filter((record) => record.selectedForPreview).map((record) => record.recordId), expectedPreview);
      assert.equal(payload.results[0].unitCost, ledgerPeriod ? "4.0000" : null);
      assert.equal(payload.results[0].mappings[0].platformSku, "SKU-MONTH");
      assert.equal(payload.meta.evidenceRecordCount, records.length);
      assert.equal(payload.meta.previewScope, ledgerPeriod ? "ledger_month" : "period_unknown");
      assert.equal(payload.meta.ledgerMonthCutoffStatus, ledgerPeriod ? "applied" : "pending_ledger");
      assert.equal(Object.hasOwn(payload.meta, "excludedMonth"), false);
      assert.equal(Object.hasOwn(payload.meta, "skippedCurrentMonth"), false);
      const footer = window.document.getElementById("erpa-footer-right").textContent;
      assert.match(footer, ledgerPeriod ? /台账月份：2026-06.*采用当月及以前采购/ : /台账月份待关联.*暂不计算预览成本/);
      assert.doesNotMatch(footer, /1688单号优先|月末截止/);
      assert.doesNotMatch(window.document.body.textContent, /排除当月|完整历史证据|排除undefined/);
    } finally {
      await window.happyDOM.close();
    }
  }
}

await verifyLedgerScopedEvidenceDelivery();
console.log("ERP result policy, trusted-month preview and full raw evidence delivery tests passed");

const observedMapping = policy.normalizeCatalogMappings([{ associatedProductId: 'WH-OBSERVED', barcodeSkuid: 'SKU-TARGET', barcodeSkcid: 'SKC-TARGET', barcodeAttributeSet: '蓝色 / 加厚', barcodePrimaryAttribute: 'CODE-NOT-ATTRIBUTE', barcodeImageLink: 'https://images.example.invalid/sku.jpg', productSellerId: 'OTHER-PERSON' }, { associatedProductId: 'WH-OBSERVED', barcodeSkuid: 'SKU-TARGET', barcodeSkcid: 'CONFLICT' }, { associatedProductId: 'WH-FOREIGN', barcodeSkuid: 'SKU-FOREIGN', barcodeSkcid: 'SKC-TARGET' }], 'WH-OBSERVED');
assert.equal(observedMapping[0].attribute, '蓝色 / 加厚');
assert.equal(observedMapping[0].imageUrl, 'https://images.example.invalid/sku.jpg');
assert.equal(observedMapping[0].warehouseSku, 'WH-OBSERVED');
assert.equal(Object.hasOwn(observedMapping[0], 'productSellerId'), false);
const strictCatalog = policy.filterCatalogBySkc([{ warehouseSku: 'WH-OBSERVED', mappings: policy.normalizeMappings(observedMapping) }], ['SKC-TARGET']);
assert.deepEqual(Array.from(strictCatalog.results[0].mappings, item => item.platformSku), ['SKU-TARGET']);
assert.equal(policy.normalizeMappings(observedMapping).filter(item => item.platformSku === 'SKU-TARGET').length, 2, 'conflicting parent evidence stays visible');
assert.equal(policy.filterCatalogBySkc([{ warehouseSku: 'SKC-TARGET', mappings: [{ platformSku: 'OTHER', platformSkc: 'OTHER' }] }], ['SKC-TARGET']).results.length, 0, 'warehouse equality never widens platform SKC scope');
const observedProduct = policy.catalogProduct({ itemId: 'WH-OBSERVED', tradeName: '已观测商品名称', productColor: '仓库颜色', specificationAndModel: '仓库规格', commoditySpecificationAndModel1688: '1688规格', proportionOfGoodsPurchased1688: '1-1', supplierData: [{ supplierName: '供应商乙', unitPrices: 999 }, { supplierName: '供应商甲' }], productSellerId: 'PERSON', '7-daySales': 999, '30DaySales': 999, platformSkuCost: 999 });
assert.deepEqual(Array.from(observedProduct.supplierNames).sort(), ['供应商乙', '供应商甲'].sort());
assert.equal(observedProduct.supplierName, '', 'multiple suppliers are retained instead of arbitrarily binding one');
assert.equal(observedProduct.purchaseCatalog.purchaseSpecificationAndModel1688, '1688规格');
assert.equal(observedProduct.purchaseCatalog.purchaseProportion1688, '1-1');
assert.equal(Object.hasOwn(observedProduct, 'unitConversion'), false, 'an unverified ratio does not create a cost-unit relation');
assert.equal(observedProduct.unitCost, null);
for (const field of ['productSellerId','7-daySales','30DaySales','platformSkuCost']) assert.equal(Object.hasOwn(observedProduct, field), false);
assert.deepEqual(Array.from(policy.annotateCostWarnings([{ unitPrice: 0.00001 }])[0].warningReasons), [], 'a micro positive price is not mislabeled zero');
console.log('Observed catalog aliases, strict shared-warehouse scope and micro-price checks passed');
