import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, webcrypto } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const extensionRoot = path.join(workspaceRoot, "integrations", "erp-assistant-extension", "src");
const frontendRequire = createRequire(path.join(workspaceRoot, "frontend", "package.json"));
const { Window } = await import(pathToFileURL(frontendRequire.resolve("happy-dom")).href);
const erpUrl = "https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html";

async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

export async function verifyErpCatalogTransport({
  workspaceId = "workspace-catalog",
  ledgerId = "LEDGER-CATALOG",
  requestId = "REQ-CATALOG",
  includeConflict = true,
  includeCancelled = false,
  syntheticSpoolBytes = 0,
  expectedSkus = [{ platformSku: "SKU-RED", platformSkc: "SKC-CATALOG" }],
} = {}) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lworkstation-erp-catalog-"));
  const spoolPath = path.join(temporaryRoot, "isolated-inbox.json");
  if (syntheticSpoolBytes > 0) {
    const records = Array.from({ length: 2000 }, (_, index) => ({ kind: "batch", workspaceId: "synthetic-unrelated-workspace",
      status: "acknowledged", deliveryId: `SYNTHETIC-${index}`, sourceMeta: { padding: "x".repeat(Math.ceil(syntheticSpoolBytes / 2000)) } }));
    await fs.writeFile(spoolPath, JSON.stringify(records));
  }
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const capability = `synthetic-catalog-capability-${randomUUID()}`;
  const child = spawn(process.execPath, [path.join(workspaceRoot, "tools", "erp-inbox-server.mjs")], {
    windowsHide: true,
    env: {
      ...process.env,
      SHOPEERS_ERP_INBOX_PORT: String(port),
      SHOPEERS_ERP_INBOX_FILE: spoolPath,
      SHOPEERS_ERP_INBOX_CAPABILITY: capability,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let window;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Isolated catalog inbox startup timed out")), 5000);
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("listening")) { clearTimeout(timer); resolve(); }
      });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Isolated catalog inbox exited: ${code}`)); });
    });
    const requestResponse = await fetch(`${base}/erp/v1/requests`, {
      method: "POST",
      headers: { authorization: `Bearer ${capability}`, "content-type": "application/json" },
      body: JSON.stringify({
        request: { id: requestId, ledgerId, workspaceId, ledgerPeriod: "2026-09", platformSkcs: ["SKC-CATALOG"] },
        expectedSkus,
      }),
    });
    assert.equal(requestResponse.status, 202);

    const catalogRegistration = await fetch(`${base}/erp/v1/requests`, {
      method: "POST", headers: { authorization: `Bearer ${capability}`, "content-type": "application/json" },
      body: JSON.stringify({ request: { kind: "catalog", id: `${requestId}-CATALOG`, workspaceId, ledgerId, ledgerPeriod: "2026-09",
        platformSkcs: ["SKC-CATALOG"], confirmedSkus: expectedSkus, sourceRequestId: requestId, sourceProductIds: [],
        idempotencyKey: `cost-catalog:${requestId}`, requestedAt: new Date().toISOString() } }),
    });
    assert.equal(catalogRegistration.status, 202);
    const stored = {
      shopeersErpInboxBaseUrl: base,
      shopeersErpInboxCapability: capability,
      shopeersErpWorkspaceId: workspaceId,
    };
    const listeners = [];
    const chrome = {
      storage: { local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => Object.hasOwn(stored, key)).map((key) => [key, structuredClone(stored[key])])); },
        async set(values) { Object.assign(stored, structuredClone(values)); },
      } },
      runtime: {
        getManifest: () => ({ version: "8.0.31" }),
        onMessage: { addListener: (listener) => listeners.push(listener) },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
      },
      alarms: { create() {}, onAlarm: { addListener() {} } },
    };
    const worker = vm.createContext({
      __SHOPEERS_ERP_BACKGROUND_TEST__: true, chrome, URL, AbortController, TextEncoder,
      crypto: { randomUUID, subtle: webcrypto.subtle }, fetch, setTimeout, clearTimeout,
      console: { error() {}, warn() {}, info() {} }, Date, Math, Promise,
    });
    vm.runInContext(await fs.readFile(path.join(extensionRoot, "background.js"), "utf8"), worker);
    const submitted = [], catalogSubmitted = [], submissionOrder = [];
    window = new Window({ url: erpUrl });
    window.document.body.innerHTML = '<table><tr><td data-field="supplierName"><a id="supplierName1688" href="https://detail.1688.com/offer/999999999999.html">供应商甲</a></td></tr><tr><td data-field="supplierName"><a id="supplierName1688" href="https://detail.1688.com/offer/888888888888.html">供应商甲</a></td></tr></table>';
    const sender = { frameId: 0, url: erpUrl, tab: { url: erpUrl } };
    window.chrome = { runtime: { lastError: null, sendMessage(message, callback) {
      // Assert dispatch order, not the nondeterministic completion order of two HTTP deliveries.
      if (message.type === "shopeers.erp.submitCostResult" || message.type === "shopeers.erp.submitCatalogResult") submissionOrder.push(message.type);
      listeners[0](message, sender, (response) => {
        if (message.type === "shopeers.erp.submitCatalogResult") catalogSubmitted.push({ payload: structuredClone(message.payload), response: structuredClone(response) });
        if (message.type === "shopeers.erp.submitCostResult") submitted.push({ payload: structuredClone(message.payload), response: structuredClone(response) });
        callback(response);
      });
    } } };
    const requestedPaths = [];
    // Sanitized synthetic values use the field names observed in the real
    // purchase-order-details response. No order, supplier or image is real.
    const detail = (id, warehouseSku, orderId, lineNumber, creationTime, unitPrice, overrides = {}) => ({
      purchaseOrderDetailId: id, purchaseOrderId: orderId, purchaseOrderNo: orderId, lineNumber,
      itemId: warehouseSku, tradeName: "ERP 合成商品", creationTime,
      purchaseQuantity: "2", purchaseUnitPrice: String(unitPrice),
      supplierName: "供应商甲", supplierId: "SUPPLIER-SYNTHETIC-A",
      picturesLinking: null, pictureLink1688: null,
      purchaseSpecificationAndModel1688: "采购红色规格（仅参考）", model1688: "红色",
      specificationAndModel: "", productColor: "", purchaseProportion1688: "1-1",
      barcodeSkuid: "", barcodeSkcid: "", productLink1688: "", purchasingLink1688: "",
      ...overrides,
    });
    window.fetch = async (rawUrl) => {
      const url = new URL(rawUrl);
      requestedPaths.push(url.pathname);
      let data;
      if (url.pathname === "/purchase/purchase/v1/purchase-order-page") {
        data = [
          { purchaseOrderId: "PO-NEW", purchaseOrderNo: "PO-NEW", purchaseStatus: 4, paymentStatus: 4, purchaseOrderStatus1688: 2, supplierName: "供应商甲", productLink1688: "https://detail.1688.com/offer/777777777777.html", storeUrl: "https://synthetic-a.1688.com/" },
          { purchaseOrderId: "PO-OLD", purchaseOrderNo: "PO-OLD", supplierName: "供应商甲" },
          ...(includeCancelled ? [{ purchaseOrderId: 'PO-CANCELLED', purchaseOrderNo: 'PO-CANCELLED', purchaseStatus: 2, purchaseOrderStatus1688: 4 }] : []),
        ];
      } else if (url.pathname === "/purchase/purchase/v1/purchase-order-details") {
        assert.notEqual(url.searchParams.get('purchaseOrderId'), 'PO-CANCELLED', 'cancelled header must not fan out details');
        const newest = url.searchParams.get("purchaseOrderId") === "PO-NEW";
        data = newest ? [
          detail("DETAIL-NEW", "WH-CATALOG", "PO-NEW", 0, "2026-09-20 10:00:00", 6, {
            purchaseProportion1688: "1-2",
            picturesLinking: "https://images.example.invalid/catalog-red.jpg",
            pictureLink1688: "https://images.example.invalid/1688-red.jpg",
            productLink1688: "https://detail.1688.com/offer/111111111111.html?trace=erp",
            purchasingLink1688: "https://detail.1688.com/offer/111111111111.html",
          }),
          detail("DETAIL-BLUE", "WH-BLUE", "PO-NEW", 1, "2026-09-20 10:00:00", 5, {
            pictureLink1688: "https://images.example.invalid/1688-blue.jpg",
            purchaseSpecificationAndModel1688: "采购蓝色规格（仅参考）", model1688: "蓝色",
            purchaseProportion1688: "2-1",
            productLink1688: "https://detail.1688.com/offer/222222222222.html",
            purchasingLink1688: "https://detail.1688.com/offer/222222222222.html",
          }),
          detail("DETAIL-NO-LINK", "WH-CATALOG", "PO-NEW", 2, "2026-09-15 10:00:00", 5),
          ...(includeCancelled ? ['WH-CATALOG', 'WH-BLUE'].map(warehouse => detail('CANCELLED-' + warehouse, warehouse, 'PO-NEW', 3, '2026-09-30 23:59:59', 99, { purchaseOrderStatus1688: '4' })) : []),
        ] : [detail("DETAIL-OLD", "WH-CATALOG", "PO-OLD", 0, "2026-09-10 10:00:00", 4, {
          pictureLink1688: "https://images.example.invalid/1688-old.jpg",
          productLink1688: "https://detail.1688.com/offer/333333333333.html",
          purchasingLink1688: "https://detail.1688.com/offer/333333333333.html",
        })];
      } else if (url.pathname === "/purchase/product/v1/product-page") {
        data = [];
      } else {
        assert.equal(url.pathname, "/purchase/product/v1/product-info-sku", "only observed read-only ERP endpoints can be queried");
        const warehouseSku = url.searchParams.get("productId");
        assert.ok(["WH-CATALOG", "WH-BLUE"].includes(warehouseSku));
        data = warehouseSku === "WH-CATALOG" ? [
          { barcodeSkuid: "SKU-RED", barcodeSkcid: "SKC-CATALOG", barcodeArticleNumber: "GOODS-1", platform: "Shein", storeName: "店铺甲" },
          ...(includeConflict ? [{ barcodeSkuid: "SKU-RED", barcodeSkcid: "SKC-CONFLICT" }] : []),
        ] : [{ barcodeSkuid: "SKU-BLUE", barcodeSkcid: "SKC-CATALOG", barcodeArticleNumber: "GOODS-1", platform: "Shein", storeName: "店铺甲" }];
      }
      if (url.pathname === "/purchase/product/v1/product-info-sku") data = data.map(item => ({ ...item, associatedProductId: url.searchParams.get("productId") }));
      return { ok: true, json: async () => ({ code: 0, count: data.length, data }) };
    };
    for (const file of ["result-policy.js", "catalog-collector.js", "request-context.js", "shopeers-bridge.js", "content.js"]) window.eval(await fs.readFile(path.join(extensionRoot, file), "utf8"));
    window.dispatchEvent(new window.CustomEvent("shopeers:erp-v8-query-captured", { detail: { url: "https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-CATALOG" } }));
    window.document.getElementById("erpa-cost-trigger").click();
    for (let attempt = 0; attempt < 200 && !submitted.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(submitted.length, 1, window.document.body.textContent);
    assert.equal(submitted[0].response.ok, true, submitted[0].response.message);
    for (let attempt = 0; attempt < 200 && !catalogSubmitted.length; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(catalogSubmitted.length, 1);
    assert.equal(catalogSubmitted[0].response.status, "success", catalogSubmitted[0].response.message);
    assert.deepEqual(submissionOrder, ["shopeers.erp.submitCostResult", "shopeers.erp.submitCatalogResult"]);
    assert.equal(new Set(requestedPaths).size, 4);
    assert.equal(requestedPaths.filter(endpoint => endpoint.endsWith('purchase-order-page')).length, 1, 'complete original evidence does not trigger any optional history scan');
    assert.equal(requestedPaths.filter(endpoint => endpoint.endsWith('product-info-sku')).length, 2, 'complete original mappings are reused');
    const retryCatalog = await window.ShopeersErpDeliveryBridge.submitCatalog(catalogSubmitted[0].payload);
    assert.equal(retryCatalog.status, "success", 'same independently delivered catalog is retry-idempotent');
    const resultResponse = await fetch(`${base}/erp/v1/cost-batches?workspaceId=${encodeURIComponent(workspaceId)}&ledgerId=${encodeURIComponent(ledgerId)}`, { headers: { authorization: `Bearer ${capability}` } });
    assert.equal(resultResponse.status, 200);
    const inbox = await resultResponse.json();
    const envelope = inbox.records[0].envelope;
    const batch = envelope.batch;
    const red = batch.rows.find((row) => row.platformSku === "SKU-RED");
    const blue = batch.rows.find((row) => row.platformSku === "SKU-BLUE");
    assert.equal(red.ledgerScopeRole, "expected");
    assert.equal(blue.ledgerScopeRole, expectedSkus.some((sku) => sku.platformSku === "SKU-BLUE") ? "expected" : "auxiliary");
    assert.equal(red.productName, "ERP 合成商品", "the name comes from purchase detail tradeName");
    assert.equal(red.imageUrl, "https://images.example.invalid/catalog-red.jpg");
    assert.equal(blue.imageUrl, "https://images.example.invalid/1688-blue.jpg", "the sole reliable warehouse mapping allows the 1688 picture fallback");
    assert.equal(red.attribute, "", "procurement specifications must never be turned into platform attributes");
    assert.equal(blue.attribute, "");
    assert.equal(red.catalogMappings.length, includeConflict ? 2 : 1);
    assert.equal(red.catalogMappings.some((mapping) => mapping.platformSkc === "SKC-CONFLICT"), includeConflict);
    assert.equal(red.catalogMappings[0].warehouseSku, "WH-CATALOG");
    assert.equal(red.catalogMappings[0].storeName, "店铺甲");
    assert.equal(red.catalogMappings[0].articleNumber, "GOODS-1");
    assert.equal(red.supplierName, "供应商甲");
    assert.equal(red.supplier1688Url, "https://detail.1688.com/offer/111111111111.html");
    assert.equal(blue.supplier1688Url, "https://detail.1688.com/offer/222222222222.html");
    assert.ok(red.supplier1688Links.every((link) => link.url !== blue.supplier1688Url), "a same-supplier sibling line's product link cannot be borrowed");
    assert.equal(red.purchaseCatalog.purchaseOrderDetailId, "DETAIL-NEW");
    assert.equal(red.purchaseCatalog.purchaseSpecificationAndModel1688, "采购红色规格(仅参考)");
    assert.equal(red.purchaseCatalog.purchaseProportion1688, "1-2");
    assert.equal(red.purchaseCatalog.lineNumber, "0");
    assert.equal(red.purchaseCatalog.barcodeSkuid, null);
    assert.equal(red.purchaseCatalog.barcodeSkcid, null);
    assert.equal(red.purchaseCatalog.specificationAndModel, null);
    assert.equal(red.purchaseCatalog.productColor, null);
    assert.equal(Object.keys(red.purchaseCatalog).length, 14);
    const records = batch.warehouseEvidence.find((warehouse) => warehouse.warehouseSku === "WH-CATALOG").purchaseRecords;
    assert.equal(records.length, 3);
    const newest = records.find((record) => record.recordId === "DETAIL-NEW");
    const oldest = records.find((record) => record.recordId === "DETAIL-OLD");
    const missing = records.find((record) => record.recordId === "DETAIL-NO-LINK");
    assert.equal(newest.imageUrl, "https://images.example.invalid/catalog-red.jpg");
    assert.equal(newest.attribute, "");
    assert.equal(newest.supplierName, "供应商甲");
    assert.equal(newest.supplier1688Url, red.supplier1688Url);
    assert.equal(missing.supplier1688Url, "", "a missing product link cannot borrow the same supplier's DOM, sibling or order link");
    assert.ok(missing.supplier1688Links.every((link) => link.type === "store"));
    assert.equal(missing.purchaseCatalog.purchaseOrderDetailId, "DETAIL-NO-LINK");
    assert.equal(missing.purchaseCatalog.lineNumber, "2");
    assert.equal(oldest.supplierName, "供应商甲");
    assert.equal(oldest.supplier1688Url, "https://detail.1688.com/offer/333333333333.html");
    assert.equal(oldest.imageUrl, "https://images.example.invalid/1688-old.jpg");
    assert.equal(oldest.purchaseOrderId, "PO-OLD");
    assert.equal(red.previewUnitCost, 5, "catalog transport must not alter weighted cost arithmetic");
    assert.equal(blue.previewUnitCost, 5);
    assert.equal(red.totalQuantity, 6, "1:2 procurement composition must not change already-normalized warehouse quantity");
    assert.equal(red.totalPrice, 30, "1:2 procurement composition must not multiply the order amount again");
    assert.equal(blue.purchaseCatalog.purchaseProportion1688, "2-1");
    assert.equal(blue.totalQuantity, 2, "2:1 procurement split must retain recorded warehouse quantity");
    assert.equal(blue.totalPrice, 10, "2:1 procurement split must retain recorded warehouse-unit price");
    const cache = JSON.parse(window.localStorage.getItem("erpAssistantV8_latest_cost_result_v7"));
    assert.equal(cache.results.find((result) => result.warehouseSku === "WH-CATALOG").catalogMappings.length, includeConflict ? 2 : 1);
    const persisted = JSON.parse(await fs.readFile(spoolPath, "utf8"));
    assert.deepEqual(persisted.find((record) => record.kind === "batch" && record.workspaceId === workspaceId).envelope.batch.rows, batch.rows);
    assert.doesNotMatch(JSON.stringify(batch), /999999999999|888888888888|777777777777/, "global DOM and order-level product links must never enter detail evidence");

    // Synthetic non-empty values for the observed barcode fields check source
    // ownership without changing the nominal two-warehouse return fixture.
    const shared = structuredClone(submitted[0].payload);
    // The following ownership cases isolate valid purchase pictures; cancellation
    // persistence is checked separately by the end-to-end regression.
    shared.warehouseEvidence.excludedDetails = [];
    shared.warehouseEvidence.excludedOrders = [];
    shared.results = [shared.results.find((result) => result.warehouseSku === "WH-CATALOG")];
    shared.warehouseEvidence.warehouses = shared.warehouseEvidence.warehouses.filter((warehouse) => warehouse.warehouseSku === "WH-CATALOG");
    shared.results[0].mappings = [{ platformSku: "SKU-RED", platformSkc: "SKC-CATALOG" }, { platformSku: "SKU-BLUE", platformSkc: "SKC-CATALOG" }];
    const sharedRecords = shared.warehouseEvidence.warehouses[0].purchaseRecords;
    const history = structuredClone(sharedRecords.find((record) => record.recordId === "DETAIL-OLD"));
    history.recordId = "DETAIL-HISTORY";
    history.purchaseDate = "2026-08-01 10:00:00";
    history.selectedForPreview = false;
    history.purchaseCatalog.purchaseOrderDetailId = "DETAIL-HISTORY";
    history.purchaseCatalog.pictureLink1688 = "https://images.example.invalid/1688-history.jpg";
    history.supplier1688Url = "https://detail.1688.com/offer/444444444444.html";
    history.supplier1688Links = [{ type: "product", url: history.supplier1688Url, supplierName: "供应商乙" }];
    sharedRecords.push(history);
    for (const record of sharedRecords) {
      const blueSource = record.recordId === "DETAIL-HISTORY";
      record.purchaseCatalog.barcodeSkuid = blueSource ? "SKU-BLUE" : "SKU-RED";
      record.purchaseCatalog.barcodeSkcid = "SKC-CATALOG";
      if (blueSource) {
        record.supplierName = "供应商乙";
        record.purchaseCatalog.supplierId = "SUPPLIER-SYNTHETIC-B";
        record.supplier1688Links = record.supplier1688Links.map((link) => ({ ...link, supplierName: "供应商乙" }));
      }
    }
    const boundRows = worker.__SHOPEERS_ERP_BACKGROUND_TEST_API__.buildRows(shared.results, shared.warehouseEvidence);
    const boundRed = boundRows.find((row) => row.platformSku === "SKU-RED");
    const boundBlue = boundRows.find((row) => row.platformSku === "SKU-BLUE");
    assert.equal(boundRed.imageUrl, red.imageUrl);
    assert.equal(boundBlue.imageUrl, history.purchaseCatalog.pictureLink1688);
    assert.equal(boundBlue.purchaseCatalog.purchaseOrderDetailId, "DETAIL-HISTORY");
    assert.equal(boundBlue.purchaseCatalog.barcodeSkuid, "SKU-BLUE");
    assert.equal(boundBlue.supplierName, "供应商乙");
    assert.equal(boundBlue.supplier1688Url, history.supplier1688Url);
    assert.ok(boundBlue.supplier1688Links.every((link) => link.url !== red.supplier1688Url));
    assert.ok(boundRed.supplier1688Links.every((link) => link.url !== history.supplier1688Url));
    assert.equal(sharedRecords.length, 4, "binding may narrow a summary, never delete warehouse evidence");
    assert.equal(shared.results[0].selectedRecordIds.includes("DETAIL-HISTORY"), false, "catalog metadata may use complete history outside the three selected cost records");

    for (const record of sharedRecords) {
      record.purchaseCatalog.barcodeSkuid = null;
      record.purchaseCatalog.barcodeSkcid = null;
      record.purchaseCatalog.picturesLinking = null;
    }
    const unboundRows = worker.__SHOPEERS_ERP_BACKGROUND_TEST_API__.buildRows(shared.results, shared.warehouseEvidence);
    assert.ok(unboundRows.every((row) => row.imageUrl === ""), "an unbound 1688 purchase picture cannot become a SKU-specific image for several shared-warehouse SKUs");
    sharedRecords[0].purchaseCatalog.picturesLinking = red.imageUrl;
    const warehouseRows = worker.__SHOPEERS_ERP_BACKGROUND_TEST_API__.buildRows(shared.results, shared.warehouseEvidence);
    assert.ok(warehouseRows.every((row) => row.imageUrl === red.imageUrl), "an actual warehouse picture may follow reliable mappings of that warehouse");
    shared.results[0].mappings[1].attribute = "蓝色/M";
    const explicitAttributeRows = worker.__SHOPEERS_ERP_BACKGROUND_TEST_API__.buildRows(shared.results, shared.warehouseEvidence);
    assert.equal(explicitAttributeRows.find((row) => row.platformSku === "SKU-BLUE").attribute, "蓝色/M", "an explicit optional platform attribute remains compatible");
    assert.equal(explicitAttributeRows.find((row) => row.platformSku === "SKU-RED").attribute, "");
    return { batch, envelope };
  } finally {
    await window?.happyDOM.close();
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("exit", resolve));
    const resolvedRoot = path.resolve(temporaryRoot);
    assert.ok(resolvedRoot.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && path.basename(resolvedRoot).startsWith("lworkstation-erp-catalog-"));
    await fs.rm(resolvedRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyErpCatalogTransport();
  console.log("ERP catalog capture → isolated background → inbox envelope and persistent spool passed.");
}
