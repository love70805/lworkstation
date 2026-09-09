import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const frontendRequire = createRequire(path.join(workspaceRoot, "frontend", "package.json"));
const { Window } = await import(pathToFileURL(frontendRequire.resolve("happy-dom")).href);
const Papa = frontendRequire("papaparse");
const cacheKey = "erpAssistantV8_latest_cost_result_v4";
const erpUrl = "https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html";

function cachedResult(text) {
  return {
    warehouseSku: text,
    mappings: [{ platformSku: text, platformSkc: text }],
    sourceType: text,
    orderNumber: text,
    name: text,
    supplierName: text,
    supplier1688Url: text,
    dateRange: text,
    calcTimes: 3,
    totalQty: 10,
    totalPrice: "12.34",
    unitCost: "1.2340",
    details: [],
    costWarnings: { count: 1, reasons: ["unit_price_one"], records: [{ recordId: text, unitPrice: 1 }] },
  };
}

async function loadExtension(extensionRoot, { cache, fetchImpl } = {}) {
  const window = new Window({ url: erpUrl });
  const downloads = [];
  const deliveries = [];
  const blobs = new Map();
  window.fetch = fetchImpl || (async () => { throw new Error("Unexpected ERP request"); });
  window.URL.createObjectURL = (blob) => {
    const url = `blob:erp-csv-test/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ name: this.download, blob: blobs.get(this.href) });
  };
  window.ShopeersErpDeliveryBridge = {
    reportStatus: async () => {},
    submit: async (payload) => { deliveries.push(payload); return { status: "success" }; },
  };
  if (cache) window.localStorage.setItem(cacheKey, JSON.stringify(cache));
  try {
    for (const file of ["result-policy.js", "request-context.js", "content.js"]) {
      let source = await readFile(path.join(extensionRoot, "src", file), "utf8");
      if (file === "content.js") source = source.replace("function handleDeliveryStatus(detail = {}) {", "window.__deliveryStatus = handleDeliveryStatus; function handleDeliveryStatus(detail = {}) {");
      window.eval(source);
    }
  } catch (error) {
    await window.happyDOM.close();
    throw error;
  }
  return {
    window,
    deliveries,
    async exportCsv() {
      const button = window.document.getElementById("erpa-export");
      assert.ok(button && !button.disabled, "the real CSV action must be available");
      const previousCount = downloads.length;
      button.click();
      assert.equal(downloads.length, previousCount + 1);
      const { name, blob } = downloads.at(-1);
      assert.match(name, /^SKU成本核算_\d{4}-\d{2}\.csv$/);
      assert.equal(blob.type, "text/csv;charset=utf-8");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      assert.deepEqual(Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf], "Chinese CSV keeps the UTF-8 BOM");
      const csv = new TextDecoder().decode(bytes);
      const parsed = Papa.parse(csv);
      assert.deepEqual(parsed.errors, [], "quotes and embedded delimiters must remain valid CSV");
      assert.ok(parsed.data.every((row) => row.length === 16), "untrusted text cannot create cells or rows");
      return { csv, rows: parsed.data };
    },
    close: () => window.happyDOM.close(),
  };
}

async function verifyCachedCsv(extensionRoot) {
  const dangerous = [
    "=1+1", "+1+1", "-1+1", "@SUM(1,1)",
    "\t商品", "\r商品", "\n商品", " \t商品", "  \r\n=1+1",
    "  =1+1", "\u00a0+1+1", "\u3000-1+1", "\ufeff@SUM(1,1)",
    "\u0000=1+1", "\v=1+1", "\f=1+1", "\u007f=1+1",
    "＝1+1", "＋1+1", "－1+1", "＠SUM(1,1)",
    '=1+1",=1+1\r\n=1+1',
  ];
  const normal = ["中文商品名称", "  中文商品", "WH-001", "00123", "", '商品"大号",蓝色;绿色\r\n第二行', "商品\n=1+1", "'已有文本标记"];
  const values = [...dangerous, ...normal];
  const results = values.map(cachedResult);
  const negativeNumbers = { ...cachedResult("普通数值"), totalQty: -5, totalPrice: -12.5, unitCost: -2.5 };
  const emptyNumbers = { ...cachedResult("缺失成本"), totalQty: null, totalPrice: null, unitCost: null };
  const warningResult = { ...cachedResult("异常记录"), costWarnings: { count: 1, reasons: ["=1+1"], records: [{ recordId: "=1+1", unitPrice: 1 }] } };
  results.push(negativeNumbers, emptyNumbers, warningResult);
  const cache = {
    timestamp: Date.now(), results, meta: { filters: {} }, resultDeliveryId: "ERP-CSV-CACHE",
    warehouseEvidence: { formatVersion: 1, warehouses: [{ purchaseRecords: [{ productName: "=1+1", unitPrice: 1.234 }] }] },
  };
  const extension = await loadExtension(extensionRoot, { cache });
  try {
    const originalCache = extension.window.localStorage.getItem(cacheKey);
    const { csv, rows } = await extension.exportCsv();
    assert.equal(rows.length, results.length + 1);
    assert.equal(rows[0][5], "产品名称");
    values.forEach((value, index) => {
      const row = rows[index + 1];
      const expected = index < dangerous.length ? `'${value}` : value;
      for (const column of [0, 1, 2, 3, 4, 5, 6, 7, 12]) {
        assert.equal(row[column], expected, `text column ${column} must safely preserve ${JSON.stringify(value)}`);
      }
      assert.deepEqual([row[8], row[11], ...row.slice(13)], ["1", "3", "10", "12.34", "1.2340"]);
      assert.equal(row[9], "采购单价为 1");
      assert.deepEqual(JSON.parse(row[10]), results[index].costWarnings.records);
    });
    assert.deepEqual(rows.at(-3).slice(13), ["-5", "-12.5", "-2.5"], "actual numeric cells do not receive text prefixes");
    assert.deepEqual(rows.at(-2).slice(13), ["", "", ""], "missing costs do not become zero");
    assert.equal(rows.at(-1)[9], "'=1+1", "external warning labels use the same safe text serialization");
    const typed = Papa.parse(csv, { header: true, dynamicTyping: (field) => ["总采购量", "总采购价(￥)", "预览单件成本"].includes(field) });
    assert.deepEqual([typed.data[0]["总采购量"], typed.data[0]["总采购价(￥)"], typed.data[0]["预览单件成本"]], [10, 12.34, 1.234]);
    assert.equal((await extension.exportCsv()).csv, csv, "repeated exports must not accumulate prefixes in live results");
    assert.equal(extension.window.localStorage.getItem(cacheKey), originalCache, "CSV encoding must not rewrite cached evidence");
    assert.equal(extension.deliveries.length, 0, "exporting a cached preview must not submit altered evidence");
  } finally {
    await extension.close();
  }
}

async function verifyCalculatedCsv(extensionRoot) {
  const originalDetail = {
    detailId: "DETAIL-CSV-1", itemId: "WH-CSV", tradeName: "=1+1",
    creationTime: "2025-01-15 12:00:00", purchaseQuantity: "3", purchaseUnitPrice: "1.2345",
  };
  const originalDetailJson = JSON.stringify(originalDetail);
  const requests = [];
  const extension = await loadExtension(extensionRoot, {
    fetchImpl: async (url) => {
      const endpoint = new URL(url).pathname;
      requests.push(endpoint);
      const data = {
        "/purchase/purchase/v1/purchase-order-page": [{ purchaseOrderId: "PO-CSV", purchaseOrderNo: "=1+1", supplierName: "+供应商" }],
        "/purchase/purchase/v1/purchase-order-details": [originalDetail],
        "/purchase/product/v1/product-info-sku": [{ platformSku: "SKU-CSV", platformSkc: "SKC-CSV" }],
      }[endpoint];
      assert.ok(data, `only fixture ERP endpoints are allowed: ${endpoint}`);
      return { ok: true, json: async () => ({ code: 0, count: data.length, data }) };
    },
  });
  try {
    const { window } = extension;
    window.dispatchEvent(new window.CustomEvent("shopeers:erp-v8-query-captured", {
      detail: { url: "https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-CSV" },
    }));
    window.document.getElementById("erpa-cost-trigger").click();
    for (let attempt = 0; attempt < 100 && !extension.deliveries.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(extension.deliveries.length, 1, "the real ERP calculation must reach evidence delivery");
    assert.equal(requests.length, 3);
    const delivery = extension.deliveries[0];
    const originalDelivery = JSON.stringify(delivery);
    const originalCache = window.localStorage.getItem(cacheKey);
    const evidence = delivery.warehouseEvidence.warehouses[0].purchaseRecords[0];
    assert.equal(evidence.productName, "=1+1");
    assert.equal(evidence.quantity, 3);
    assert.equal(evidence.unitPrice, 1.2345);
    assert.equal(evidence.totalPrice, 3 * 1.2345);
    const { rows } = await extension.exportCsv();
    assert.equal(rows.length, 2);
    assert.equal(rows[1][4], "'=1+1");
    assert.equal(rows[1][5], "'=1+1");
    assert.equal(rows[1][6], "'+供应商");
    assert.deepEqual(rows[1].slice(13), ["3", "3.70", "1.2345"], "CSV protection leaves existing ERP preview precision unchanged");
    assert.equal(JSON.stringify(originalDetail), originalDetailJson, "the ERP response remains unchanged");
    assert.equal(JSON.stringify(delivery), originalDelivery, "complete evidence submitted to the bridge remains unchanged");
    assert.equal(window.localStorage.getItem(cacheKey), originalCache, "calculation cache remains unchanged after export");
  } finally {
    await extension.close();
  }
}

export async function verifyCsvExport(extensionRoot = path.join(workspaceRoot, "integrations", "erp-assistant-extension")) {
  await verifyCachedCsv(extensionRoot);
  await verifyCalculatedCsv(extensionRoot);
  const extension = await loadExtension(extensionRoot, { cache: { timestamp: Date.now(), results: [cachedResult("CURRENT-SKU")], meta: { filters: {} }, resultDeliveryId: "ERP-RESULT-CURRENT" } });
  try {
    const { window } = extension;
    let copied = "";
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (text) => { copied = text; } }, configurable: true });
    window.__deliveryStatus({ resultDeliveryId: "ERP-RESULT-OLD", status: "success", envelope: { batchId: "OLD" } });
    window.document.getElementById("erpa-copy").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(copied.includes("CURRENT-SKU"), "old ACK must not replace the current TSV with old JSON");
    assert.ok(!copied.includes('"batchId":"OLD"'));
    window.__deliveryStatus({ resultDeliveryId: "ERP-RESULT-CURRENT", status: "success", envelope: { batchId: "CURRENT" } });
    window.document.getElementById("erpa-copy").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(JSON.parse(copied).batchId, "CURRENT");
    assert.equal(JSON.parse(window.localStorage.getItem(cacheKey)).importEnvelope.batchId, "CURRENT");
  } finally { await extension.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyCsvExport();
  console.log("ERP CSV export safety tests passed.");
}
