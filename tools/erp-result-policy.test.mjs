import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

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

console.log("ERP result policy tests passed");
