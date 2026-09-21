import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.join(toolsRoot, "..", "integrations", "erp-assistant-extension", "src", "result-policy.js");
const sandbox = { window: {} };
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

async function verifyUnscopedEvidenceDelivery() {
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

  for (const mixedMonths of [false, true]) {
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
          callback({ ok: true, status: "success", resultDeliveryId: message.payload?.resultDeliveryId });
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
      } else {
        assert.equal(url.pathname, "/purchase/product/v1/product-info-sku", "only fixture ERP endpoints are allowed");
        data = [{ platformSku: "SKU-MONTH", platformSkc: "SKC-MONTH" }];
      }
      return { ok: true, json: async () => ({ code: 0, count: data.length, data }) };
    };
    try {
      for (const file of ["result-policy.js", "request-context.js", "shopeers-bridge.js", "content.js"]) {
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
      assert.equal(records.find((record) => record.recordId === "CURRENT").purchaseDate, "2026-06-10");
      assert.equal(payload.warehouseEvidence.excludedOrders.length, 1);
      assert.equal(payload.meta.skippedCancelledOrderCount, 1);
      assert.equal(payload.meta.skippedInvalid, invalid.length);
      assert.ok(payload.warehouseEvidence.excludedDetails.every((record) => record.exclusionReasons.join() === "invalid_purchase_detail"));
      assert.equal(payload.warehouseEvidence.excludedDetails.length, invalid.length);
      const expectedPreview = mixedMonths ? ["REGULAR-NEWEST", "LATER", "CURRENT"] : ["CURRENT"];
      assert.deepEqual(payload.results[0].selectedRecordIds, expectedPreview, "latest-three preview must not prefer 1688 or apply an untrusted month cutoff");
      assert.equal(payload.results[0].sourceType, mixedMonths ? "混合采购" : "1688");
      assert.deepEqual(records.filter((record) => record.selectedForPreview).map((record) => record.recordId), expectedPreview);
      assert.equal(payload.results[0].unitCost, "4.0000");
      assert.equal(payload.results[0].mappings[0].platformSku, "SKU-MONTH");
      assert.equal(payload.meta.evidenceRecordCount, records.length);
      assert.equal(payload.meta.previewScope, "unscoped");
      assert.equal(payload.meta.ledgerMonthCutoffStatus, "pending_workstation");
      assert.equal(Object.hasOwn(payload.meta, "excludedMonth"), false);
      assert.equal(Object.hasOwn(payload.meta, "skippedCurrentMonth"), false);
      const footer = window.document.getElementById("erpa-footer-right").textContent;
      assert.match(footer, /未按账本月末范围筛选的预览/);
      assert.match(footer, /待工作台保留账本当月及以前采购，排除后续月份/);
      assert.doesNotMatch(footer, /1688单号优先|月末截止/);
      assert.doesNotMatch(window.document.body.textContent, /排除当月|完整历史证据|排除undefined/);
    } finally {
      await window.happyDOM.close();
    }
  }
}

await verifyUnscopedEvidenceDelivery();
console.log("ERP result policy and unscoped evidence delivery tests passed");
