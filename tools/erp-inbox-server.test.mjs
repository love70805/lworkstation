import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createInvalidDirectV2Fixtures,
  createValidDirectV2Envelope,
} from "./fixtures/erp-direct-v2-contract.mjs";

const port = 18790 + Math.floor(Math.random() * 1000);
const spoolPath = path.join(os.tmpdir(), `shopeers-erp-inbox-test-${process.pid}.json`);
const serverPath = fileURLToPath(new URL("./erp-inbox-server.mjs", import.meta.url));
const base = `http://127.0.0.1:${port}`;
const capability = "erp-inbox-test-capability-0123456789abcdef";

await fs.rm(spoolPath, { force: true });
const missingCapabilityChild = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    SHOPEERS_ERP_INBOX_PORT: String(port + 2000),
    SHOPEERS_ERP_INBOX_FILE: `${spoolPath}.missing-capability`,
    SHOPEERS_ERP_INBOX_CAPABILITY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let missingCapabilityError = "";
missingCapabilityChild.stderr.on("data", (chunk) => { missingCapabilityError += String(chunk); });
const missingCapabilityExit = await new Promise((resolve, reject) => {
  missingCapabilityChild.once("error", reject);
  missingCapabilityChild.once("exit", resolve);
});
assert.equal(missingCapabilityExit, 1);
assert.match(missingCapabilityError, /SHOPEERS_ERP_INBOX_CAPABILITY/);
await fs.rm(`${spoolPath}.missing-capability`, { force: true });
const child = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    SHOPEERS_ERP_INBOX_PORT: String(port),
    SHOPEERS_ERP_INBOX_FILE: spoolPath,
    SHOPEERS_ERP_INBOX_CAPABILITY: capability,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverStdout = "";
let serverStderr = "";
child.stdout.on("data", (chunk) => { serverStdout += String(chunk); });
child.stderr.on("data", (chunk) => { serverStderr += String(chunk); });

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ERP 收件服务启动超时。")), 5000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening")) { clearTimeout(timer); resolve(); }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`ERP 收件服务提前退出：${code}`)));
  });

  const authorizedFetch = (url, options = {}) => globalThis.fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${capability}`, ...(options.headers || {}) },
  });
  const fetch = authorizedFetch;
  const rawPost = (pathname, body, token = capability) => globalThis.fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const registerDirectContext = async (payload) => {
    const batch = payload?.batch;
    if (!batch || payload?.status === "acknowledged") return;
    const expectedSkus = [...new Map((Array.isArray(batch.rows) ? batch.rows : [])
      .filter((row) => row?.platformSku && row?.platformSkc && row?.ledgerScopeRole !== "auxiliary")
      .map((row) => [String(row.platformSku).normalize("NFKC").trim().toUpperCase(), {
        platformSku: row.platformSku,
        platformSkc: row.platformSkc,
      }])).values()];
    await rawPost("/erp/v1/requests", {
      request: {
        id: batch.requestId,
        workspaceId: batch.workspaceId,
        ledgerId: batch.ledgerId,
        platformSkcs: batch.query?.platformSkcs,
      },
      expectedSkus,
    });
  };
  const post = async (pathname, body) => {
    if (pathname === "/erp/v1/cost-batches" && body?.batch) await registerDirectContext(body);
    return rawPost(pathname, body);
  };

  let response = await globalThis.fetch(`${base}/erp/v1/status`);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-private-network"), null);

  for (const [method, pathname] of [
    ["GET", "/erp/v1/status"],
    ["GET", "/erp/v1/requests"],
    ["GET", "/erp/v1/cost-batches"],
    ["GET", "/erp/v1/extension-status"],
    ["POST", "/erp/v1/requests"],
    ["POST", "/erp/v1/cost-results"],
    ["POST", "/erp/v1/cost-batches"],
    ["POST", "/erp/v1/extension-status"],
    ["GET", "/selection/v1/status"],
    ["GET", "/selection/v1/context"],
    ["GET", "/selection/v1/captures"],
    ["GET", "/selection/v1/extension-status"],
    ["POST", "/selection/v1/context"],
    ["POST", "/selection/v1/captures"],
    ["POST", "/selection/v1/captures/ack"],
    ["POST", "/selection/v1/extension-status"],
  ]) {
    response = await globalThis.fetch(`${base}${pathname}`, {
      method,
      ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
    });
    assert.equal(response.status, 401, `${method} ${pathname}`);
    assert.equal(response.headers.get("access-control-allow-origin"), null, pathname);
    assert.equal(response.headers.get("access-control-allow-private-network"), null, pathname);
  }

  response = await globalThis.fetch(`${base}/selection/v1/captures?workspaceId=workspace-other`, {
    headers: { authorization: "Bearer wrong-capability" },
  });
  assert.equal(response.status, 401);

  response = await globalThis.fetch(`${base}/selection/v1/status`, {
    method: "OPTIONS",
    headers: { "access-control-request-private-network": "true" },
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-private-network"), null);

  response = await fetch(`${base}/selection/v1/status`, { method: "OPTIONS" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("access-control-allow-private-network"), null);

  response = await fetch(`${base}/erp/v1/status`);
  assert.equal(response.status, 200);
  let runtimeStatus = await response.json();
  assert.equal(runtimeStatus.application, "shopeers-erp-inbox");
  assert.equal(runtimeStatus.apiVersion, 2);
  response = await fetch(`${base}/erp/v1/cost-batches`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_INBOX_QUERY");

  response = await rawPost("/erp/v1/cost-batches", createValidDirectV2Envelope());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "ERP_REQUEST_NOT_FOUND");
  response = await post("/erp/v1/cost-batches", createValidDirectV2Envelope());
  assert.equal(response.status, 202);
  response = await post("/erp/v1/cost-batches", createValidDirectV2Envelope());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).idempotent, true);
  const changedDirectReplay = createValidDirectV2Envelope();
  changedDirectReplay.batch.rows[0].unitCost += 1;
  changedDirectReplay.batch.rows[0].previewUnitCost += 1;
  response = await post("/erp/v1/cost-batches", changedDirectReplay);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "ERP_DIRECT_DELIVERY_CONFLICT");
  for (const [label, mutate] of [
    ["ledger scope role", (payload) => { payload.batch.rows[0].ledgerScopeRole = "auxiliary"; }],
    ["purchase confirmation", (payload) => { payload.batch.warehouseEvidence[0].purchaseRecords[0].confirmed = true; }],
    ["manual row decision", (payload) => { payload.batch.rows[0].manualUnitPrice = 4; }],
  ]) {
    const changedDecisionReplay = createValidDirectV2Envelope();
    mutate(changedDecisionReplay);
    response = await rawPost("/erp/v1/cost-batches", changedDecisionReplay);
    assert.equal(response.status, 409, label);
    assert.equal((await response.json()).error, "ERP_DIRECT_DELIVERY_CONFLICT", label);
  }
  const changedScopeReplay = createValidDirectV2Envelope();
  changedScopeReplay.batch.workspaceId = "workspace-direct-conflict";
  changedScopeReplay.batch.ledgerId = "ledger-direct-conflict";
  changedScopeReplay.batch.requestId = "request-direct-conflict";
  await rawPost("/erp/v1/requests", {
    request: {
      id: changedScopeReplay.batch.requestId,
      workspaceId: changedScopeReplay.batch.workspaceId,
      ledgerId: changedScopeReplay.batch.ledgerId,
      platformSkcs: changedScopeReplay.batch.query.platformSkcs,
    },
    expectedSkus: [{ platformSku: "SKU-SHARED-DIRECT-V2", platformSkc: "SKC-SHARED-A" }],
  });
  response = await rawPost("/erp/v1/cost-batches", changedScopeReplay);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "ERP_DIRECT_DELIVERY_CONFLICT");
  response = await fetch(`${base}/erp/v1/requests?workspaceId=workspace-direct-conflict&includeHistory=true`);
  assert.equal((await response.json()).records[0].status, "registered");
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-shared-direct-v2&ledgerId=ledger-shared-direct-v2`);
  const sharedDirectRecords = (await response.json()).records;
  assert.equal(sharedDirectRecords.length, 1);
  const [sharedDirectRecord] = sharedDirectRecords;
  assert.equal(sharedDirectRecord.envelope.batch.summary.querySkcCount, 2);
  assert.deepEqual(sharedDirectRecord.envelope.batch.query.platformSkcs.map((item) => item.platformSkc), ["SKC-SHARED-A", "skc-shared-b", "ＳＫＣ－ＳＨＡＲＥＤ－Ａ"]);

  for (const { id, payload } of createInvalidDirectV2Fixtures()) {
    response = await post("/erp/v1/cost-batches", payload);
    assert.equal(response.status, 400, id);
  }

  response = await post("/erp/v1/extension-status", {
    extensionId: "erp-assistant",
    version: "8.0.1",
    pageUrl: "https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html",
    ready: true,
  });
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/extension-status`);
  assert.equal(response.status, 200);
  let extensionStatus = await response.json();
  assert.equal(extensionStatus.online, true);
  assert.equal(extensionStatus.records[0].version, "8.0.1");

  response = await post("/selection/v1/extension-status", {
    extensionId: "selection-1688-capture",
    version: "1.2.1",
    pageUrl: "https://order.1688.com/order/confirm.html",
    ready: true,
  });
  assert.equal(response.status, 202);
  response = await fetch(`${base}/selection/v1/extension-status`);
  assert.equal(response.status, 200);
  const selectionExtensionStatus = await response.json();
  assert.equal(selectionExtensionStatus.online, true);
  assert.equal(selectionExtensionStatus.records[0].version, "1.2.1");
  response = await post("/selection/v1/context", { workspaceId: "workspace-sales-a", memberId: "sales-a", visibility: "private" });
  assert.equal(response.status, 202);
  response = await fetch(`${base}/selection/v1/context`);
  assert.equal((await response.json()).context.memberId, "sales-a");

  const selectionCapture = {
    schemaVersion: 1,
    requestId: "selection-request-001",
    source: "1688",
    sourceUrl: "https://detail.1688.com/offer/998877.html",
    capturedAt: Date.now(),
    extractorVersion: "1.2.0",
    product: {
      name: "测试商品",
      sourceProductId: "998877",
      imageUrl: "https://cbu01.alicdn.com/img/test.jpg",
      purchasePrice: 8.8,
      shippingFee: 3,
      purchaseQty: 2,
      skus: [{ spec: "红色", sourceSkuId: "SRC-RED", purchasePrice: 8.8, imageUrl: "https://cbu01.alicdn.com/img/red.jpg", purchaseQty: 2, lineSubtotal: 17.6 }],
    },
    warnings: [],
  };
  response = await post("/selection/v1/captures", selectionCapture);
  assert.equal(response.status, 202);
  const selectionDelivery = await response.json();
  assert.equal(selectionDelivery.code, "accepted");
  response = await post("/selection/v1/captures", selectionCapture);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).code, "duplicate");
  response = await fetch(`${base}/selection/v1/captures?workspaceId=workspace-sales-a&memberId=sales-a`);
  assert.equal(response.status, 200);
  const pendingSelection = await response.json();
  assert.equal(pendingSelection.records.length, 1);
  assert.equal(pendingSelection.records[0].visibility, "private");
  assert.equal(pendingSelection.records[0].ownerId, "sales-a");
  assert.equal(pendingSelection.records[0].envelope.product.skus[0].sourceSkuId, "SRC-RED");
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-sales-a`);
  assert.deepEqual((await response.json()).records, []);
  response = await post("/erp/v1/cost-batches", { deliveryId: selectionDelivery.deliveryId, workspaceId: "workspace-sales-a", status: "acknowledged" });
  assert.equal(response.status, 404);
  response = await fetch(`${base}/selection/v1/captures?workspaceId=workspace-sales-a&memberId=sales-a`);
  assert.equal((await response.json()).records.length, 1);
  response = await post("/selection/v1/captures/ack", { deliveryId: selectionDelivery.deliveryId, workspaceId: "workspace-sales-b" });
  assert.equal(response.status, 404);
  response = await post("/selection/v1/captures/ack", { deliveryId: selectionDelivery.deliveryId, workspaceId: "workspace-sales-a" });
  assert.equal(response.status, 200);

  const request = (id, sku) => ({
    request: { id, workspaceId: "workspace-test", ledgerId: `ledger-${id}`, platformSkcs: [{ platformSkc: `SKC-${id}` }] },
    expectedSkus: [{ platformSku: sku, platformSkc: `SKC-${id}` }],
  });
  const erpBaseline = {
    application: "ERP Assistant",
    version: "8.0.0",
    releaseSha256: "199561b86755b93000f3fc0197e8cd4ed5e699072a76d11d48e00c18f8e4a0ed",
  };
  const directInboxFixture = ({
    outerVersion = 2,
    innerVersion = 2,
    deliveryId,
    batchId,
    workspaceId,
    ledgerId,
    requestId,
    platformSkc = "SKC-DIRECT",
    rows,
    warehouseEvidence,
    sourceMeta,
    sentAt = "2026-08-19T08:00:00.000Z",
  }) => {
    const normalizedRows = rows.map((row, index) => {
      const warehouseSku = String(row.warehouseSku ?? "").trim();
      return {
        ...row,
        evidenceRef: row.evidenceRef ?? `warehouse:${warehouseSku.normalize("NFKC").toUpperCase()}`,
        sourceRow: row.sourceRow ?? index + 1,
      };
    });
    const warehouseSkuCount = new Set(normalizedRows.map((row) => String(row.warehouseSku).normalize("NFKC").toUpperCase())).size;
    return {
      type: "shopeers.erp.cost.batch",
      source: "erp-assistant-v8",
      format: "shopeers-erp-cost-inbox",
      formatVersion: outerVersion,
      deliveryId,
      sentAt,
      transport: "local-http",
      baseline: erpBaseline,
      batch: {
        format: "shopeers-erp-cost-batch",
        formatVersion: innerVersion,
        batchId,
        workspaceId,
        ledgerId,
        requestId,
        generatedAt: sentAt,
        complete: true,
        status: "completed",
        currency: "CNY",
        baseline: erpBaseline,
        algorithmVersion: "erp-v8.0-compatible@1",
        query: { unit: "platform_skc", platformSkcs: [{ platformSkc }] },
        summary: {
          outputRowCount: normalizedRows.length,
          warehouseSkuCount,
          mappingFallbackCount: normalizedRows.filter((row) => Boolean(row.mappingFallback)).length,
          querySkcCount: 1,
        },
        sourceMeta,
        rows: normalizedRows,
        warehouseEvidence: warehouseEvidence ?? normalizedRows.map((row) => ({
          warehouseSku: row.warehouseSku,
          evidenceComplete: true,
          purchaseRecords: [],
        })),
      },
    };
  };

  response = await post("/erp/v1/requests", request("A", "SKU-A"));
  assert.equal(response.status, 202);
  response = await post("/erp/v1/requests", request("A", "SKU-A"));
  assert.deepEqual(await response.json(), { accepted: true, idempotent: true, requestId: "A" });
  response = await fetch(`${base}/erp/v1/requests?includeHistory=true`);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_ERP_REQUEST_QUERY");
  await post("/erp/v1/requests", {
    request: { id: "CROSS-WORKSPACE-A", workspaceId: "workspace-cross-a", ledgerId: "ledger-cross-a", platformSkcs: [{ platformSkc: "SKC-CROSS" }] },
    expectedSkus: [{ platformSku: "SKU-CROSS-A", platformSkc: "SKC-CROSS" }],
  });
  await post("/erp/v1/requests", {
    request: { id: "CROSS-WORKSPACE-B", workspaceId: "workspace-cross-b", ledgerId: "ledger-cross-b", platformSkcs: [{ platformSkc: "ＳＫＣ－ＣＲＯＳＳ" }] },
    expectedSkus: [{ platformSku: "SKU-CROSS-B", platformSkc: "SKC-CROSS" }],
  });
  response = await fetch(`${base}/erp/v1/requests?workspaceId=workspace-cross-a&includeHistory=true`);
  assert.deepEqual((await response.json()).records.map((item) => item.requestId), ["CROSS-WORKSPACE-A"]);
  response = await fetch(`${base}/erp/v1/requests?workspaceId=workspace-cross-missing&includeHistory=true`);
  assert.deepEqual((await response.json()).records, []);
  const requestSnapshotAt = new Date().toISOString();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await post("/erp/v1/requests", request("AFTER-SNAPSHOT", "SKU-AFTER"));
  response = await fetch(`${base}/erp/v1/requests?workspaceId=workspace-test&registeredBefore=${encodeURIComponent(requestSnapshotAt)}`);
  const snapshotRequests = await response.json();
  assert.equal(snapshotRequests.records.some((item) => item.requestId === "A"), true);
  assert.equal(snapshotRequests.records.some((item) => item.requestId === "AFTER-SNAPSHOT"), false);

  response = await post("/erp/v1/cost-results", {
    requestId: "A",
    ledgerId: "ledger-WRONG",
    workspaceId: "workspace-test",
    querySkcs: ["SKC-A"],
    resultDeliveryId: "RESULT-WRONG-LEDGER",
    rows: [{ platformSku: "SKU-A", warehouseSku: "WH-A", unitCost: 4 }],
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "ERP_REQUEST_SCOPE_MISMATCH");

  response = await post("/erp/v1/cost-results", {
    requestId: "A",
    ledgerId: "ledger-A",
    workspaceId: "workspace-test",
    querySkcs: ["SKC-OTHER"],
    resultDeliveryId: "RESULT-WRONG-SKC",
    rows: [{ platformSku: "SKU-A", warehouseSku: "WH-A", unitCost: 4 }],
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "ERP_REQUEST_SCOPE_MISMATCH");

  response = await post("/erp/v1/cost-results", {
    resultDeliveryId: "RESULT-MISSING-SCOPE",
    rows: [{ platformSku: "SKU-UNKNOWN", warehouseSku: "WH-X", unitCost: 1 }],
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_ERP_RESULT_CONTEXT");

  for (const [missingField, body] of [
    ["resultDeliveryId", { requestId: "A", ledgerId: "ledger-A", querySkcs: ["SKC-A"], rows: [{ platformSku: "SKU-A", warehouseSku: "WH-A", unitCost: 4 }] }],
    ["requestId", { resultDeliveryId: "RESULT-MISSING-REQUEST", ledgerId: "ledger-A", querySkcs: ["SKC-A"], rows: [{ platformSku: "SKU-A", warehouseSku: "WH-A", unitCost: 4 }] }],
    ["ledgerId", { resultDeliveryId: "RESULT-MISSING-LEDGER", requestId: "A", querySkcs: ["SKC-A"], rows: [{ platformSku: "SKU-A", warehouseSku: "WH-A", unitCost: 4 }] }],
    ["querySkcs", { resultDeliveryId: "RESULT-MISSING-QUERY", requestId: "A", ledgerId: "ledger-A", meta: { filters: { sku: "SKC-A" } }, rows: [{ platformSku: "SKU-A", warehouseSku: "WH-A", unitCost: 4 }] }],
  ]) {
    response = await post("/erp/v1/cost-results", body);
    assert.equal(response.status, 400, missingField);
  }

  const acceptedResultPayload = {
    requestId: "A",
    ledgerId: "ledger-A",
    workspaceId: "workspace-test",
    querySkcs: ["ＳＫＣ－Ａ"],
    resultDeliveryId: "RESULT-A-STABLE",
    rows: [{
      platformSku: "SKU-A",
      platformSkc: "SKC-A",
      warehouseSku: "WH-A",
      supplierName: "义乌市鑫颉日用品有限公司",
      supplier1688Url: "https://detail.1688.com/offer/730242606884.html",
      costNature: "formal",
      manualUnitPrice: 2.5,
      anomalyConfirmed: true,
      costWarningCount: 1,
      costWarningReasons: ["unit_price_one"],
      costWarningRecords: [{
        recordId: "R-1",
        unitPrice: 1,
        reasons: ["unit_price_one"],
        confirmed: true,
        manualUnitPrice: 2.5,
        confirmedAt: "2026-08-11T08:00:00.000Z",
      }],
      unitCost: 0,
    }],
    sourceMeta: {
      orderCount: 12,
      costWarningCount: 1,
      extensionVersion: "8.0.12",
      filters: { token: "must-not-leak" },
      manualDecision: "must-not-leak",
    },
    warehouseEvidence: {
      formatVersion: 1,
      warehouses: [{
        warehouseSku: "WH-A",
        purchaseRecords: [
          { recordId: "R-1", unitPrice: 1, quantity: 2, eligible: true, selectedForPreview: true, confirmed: true },
          { recordId: "R-2", unitPrice: 1.99, quantity: 5, eligible: true, selectedForPreview: false },
        ],
      }],
      excludedOrders: [{ purchaseOrderId: "PO-CANCELLED", warehouseSku: "WH-A", exclusionReasons: ["cancelled_or_closed"] }],
      excludedDetails: [{ recordId: "R-CURRENT", warehouseSku: "WH-A", exclusionReasons: ["current_month"] }],
    },
  };
  response = await post("/erp/v1/cost-results", acceptedResultPayload);
  assert.equal(response.status, 202);
  const delivered = await response.json();
  assert.equal(delivered.requestId, "A");
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-test&ledgerId=ledger-A`);
  assert.equal(response.status, 200);
  const firstPending = await response.json();
  assert.equal(firstPending.records[0].envelope.batch.rows[0].supplier1688Url, "https://detail.1688.com/offer/730242606884.html");
  assert.equal(firstPending.records[0].envelope.formatVersion, 2);
  assert.equal(firstPending.records[0].envelope.batch.formatVersion, 2);
  assert.equal(firstPending.records[0].envelope.batch.rows[0].previewUnitCost, 0);
  assert.equal(firstPending.records[0].envelope.batch.rows[0].costRole, "preview");
  assert.equal(firstPending.records[0].envelope.batch.rows[0].manualUnitPrice, undefined);
  assert.equal(firstPending.records[0].envelope.batch.rows[0].anomalyConfirmed, undefined);
  assert.equal(firstPending.records[0].envelope.batch.sourceMeta.extensionVersion, "8.0.12");
  assert.equal(firstPending.records[0].envelope.batch.sourceMeta.filters, undefined);
  assert.equal(firstPending.records[0].envelope.batch.sourceMeta.manualDecision, undefined);
  assert.equal(firstPending.records[0].envelope.batch.warehouseEvidence[0].purchaseRecords.length, 2);
  assert.equal(firstPending.records[0].envelope.batch.warehouseEvidence[0].purchaseRecords[0].confirmed, undefined);
  assert.deepEqual(firstPending.records[0].envelope.batch.warehouseEvidence[0].purchaseRecords[0].warningReasons, []);
  assert.equal(firstPending.records[0].envelope.batch.warehouseEvidence[0].excludedRecords[0].exclusionReasons[0], "cancelled_or_closed");
  response = await post("/erp/v1/cost-results", acceptedResultPayload);
  assert.equal(response.status, 200);
  const duplicateResult = await response.json();
  assert.equal(duplicateResult.idempotent, true);
  assert.equal(duplicateResult.deliveryId, delivered.deliveryId);
  assert.equal(duplicateResult.batchId, delivered.batchId);
  response = await post("/erp/v1/cost-results", {
    ...acceptedResultPayload,
    rows: acceptedResultPayload.rows.map((row) => ({ ...row, ledgerScopeRole: "auxiliary" })),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).idempotent, true);
  response = await post("/erp/v1/cost-results", {
    ...acceptedResultPayload,
    sourceMeta: { ...acceptedResultPayload.sourceMeta, cacheRestored: true },
  });
  assert.equal(response.status, 200);
  const restoredCacheDuplicate = await response.json();
  assert.equal(restoredCacheDuplicate.idempotent, true);
  assert.equal(restoredCacheDuplicate.deliveryId, delivered.deliveryId);
  assert.equal(restoredCacheDuplicate.batchId, delivered.batchId);
  response = await post("/erp/v1/cost-results", {
    ...acceptedResultPayload,
    ledgerId: "ledger-WRONG",
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "ERP_RESULT_DELIVERY_CONFLICT");
  response = await fetch(`${base}/erp/v1/status`);
  runtimeStatus = await response.json();
  assert.equal(runtimeStatus.latestBatch.sourceFormatVersion, 2);
  assert.equal(runtimeStatus.latestBatch.evidenceStatus, "legacy_partial");
  assert.equal(runtimeStatus.latestBatch.status, "pending");

  await post("/erp/v1/requests", request("B", "SKU-B"));
  await post("/erp/v1/requests", request("C", "SKU-B"));
  response = await post("/erp/v1/cost-results", {
    resultDeliveryId: "RESULT-B-MISSING-SCOPE",
    rows: [{ platformSku: "SKU-B", warehouseSku: "WH-B", unitCost: 3 }],
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_ERP_RESULT_CONTEXT");

  response = await post("/erp/v1/cost-results", {
    requestId: "C",
    ledgerId: "ledger-C",
    workspaceId: "workspace-test",
    querySkcs: ["SKC-C"],
    resultDeliveryId: "RESULT-C",
    rows: [{ platformSku: "SKU-B", warehouseSku: "WH-B", unitCost: 3 }],
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).requestId, "C");

  await post("/erp/v1/requests", {
    request: { id: "AMB-1", workspaceId: "workspace-amb", ledgerId: "ledger-amb-1", platformSkcs: [{ platformSkc: "SKC-AMB" }] },
    expectedSkus: [{ platformSku: "SKU-AMB-1", platformSkc: "SKC-AMB" }],
  });
  await post("/erp/v1/requests", {
    request: { id: "AMB-2", workspaceId: "workspace-amb", ledgerId: "ledger-amb-2", platformSkcs: [{ platformSkc: "ＳＫＣ－ＡＭＢ" }] },
    expectedSkus: [{ platformSku: "SKU-AMB-2", platformSkc: "SKC-AMB" }],
  });
  const ambiguitySnapshotAt = new Date(Date.now() + 1000).toISOString();
  response = await fetch(`${base}/erp/v1/requests?workspaceId=workspace-amb&registeredBefore=${encodeURIComponent(ambiguitySnapshotAt)}`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).records.map((item) => item.requestId).sort(), ["AMB-1", "AMB-2"]);

  await post("/erp/v1/requests", {
    request: { id: "EVIDENCE-UNKNOWN", workspaceId: "workspace-evidence", ledgerId: "ledger-evidence-unknown", platformSkcs: [{ platformSkc: "SKC-EVIDENCE" }] },
    expectedSkus: [{ platformSku: "SKU-EVIDENCE", platformSkc: "SKC-EVIDENCE" }],
  });
  response = await post("/erp/v1/cost-results", {
    resultDeliveryId: "RESULT-EVIDENCE-UNKNOWN",
    requestId: "EVIDENCE-UNKNOWN",
    ledgerId: "ledger-evidence-unknown",
    workspaceId: "workspace-evidence",
    querySkcs: ["SKC-EVIDENCE"],
    rows: [{ platformSku: "SKU-NOT-IN-REQUEST", platformSkc: "SKC-EVIDENCE", warehouseSku: "WH-EVIDENCE", unitCost: 2.5, sourceWarnings: ["raw-row-warning"] }],
    sourceMeta: { mappingFailures: [{ warehouseSku: "WH-EVIDENCE", message: "mapping unavailable" }] },
    warehouseEvidence: {
      formatVersion: 1,
      warehouses: [{ warehouseSku: "WH-EVIDENCE", evidenceComplete: false, purchaseRecords: [{ recordId: "E-R1", quantity: 2, unitPrice: 2.5 }] }],
      mappingFailures: [{ warehouseSku: "WH-EVIDENCE", message: "mapping unavailable" }],
    },
  });
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-evidence&ledgerId=ledger-evidence-unknown`);
  const unknownEvidenceBatch = (await response.json()).records[0].envelope.batch;
  assert.equal(unknownEvidenceBatch.rows[0].platformSku, "SKU-NOT-IN-REQUEST");
  assert.equal(unknownEvidenceBatch.rows[0].ledgerScopeRole, "auxiliary");
  assert.equal(unknownEvidenceBatch.rows[0].sourceWarnings.some((warning) => warning.includes("unknown_platform_sku")), false);
  assert.ok(unknownEvidenceBatch.sourceMeta.sourceWarnings.includes("mapping_failure:missing_expected_platform_sku:SKU-EVIDENCE"));
  assert.equal(unknownEvidenceBatch.sourceMeta.mappingFailures[0].warehouseSku, "WH-EVIDENCE");
  assert.ok(unknownEvidenceBatch.warehouseEvidence[0].sourceWarnings.some((warning) => warning.startsWith("mapping_failure:")));

  await post("/erp/v1/requests", {
    request: { id: "EVIDENCE-ONLY", workspaceId: "workspace-evidence", ledgerId: "ledger-evidence-only", platformSkcs: [{ platformSkc: "SKC-EVIDENCE-ONLY" }] },
    expectedSkus: [{ platformSku: "SKU-EVIDENCE-ONLY", platformSkc: "SKC-EVIDENCE-ONLY" }],
  });
  response = await post("/erp/v1/cost-results", {
    resultDeliveryId: "RESULT-EVIDENCE-ONLY",
    requestId: "EVIDENCE-ONLY",
    ledgerId: "ledger-evidence-only",
    workspaceId: "workspace-evidence",
    querySkcs: ["SKC-EVIDENCE-ONLY"],
    rows: [],
    sourceMeta: { sourceWarnings: ["excluded-only"] },
    warehouseEvidence: {
      formatVersion: 1,
      warehouses: [],
      excludedOrders: [{ purchaseOrderId: "PO-ONLY", warehouseSku: "WH-ONLY", supplierName: "供应商 A", exclusionReasons: ["cancelled_or_closed"] }],
    },
  });
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-evidence&ledgerId=ledger-evidence-only`);
  const evidenceOnlyBatch = (await response.json()).records[0].envelope.batch;
  assert.equal(evidenceOnlyBatch.rows[0].platformSku, "");
  assert.equal(evidenceOnlyBatch.rows[0].warehouseSku, "WH-ONLY");
  assert.equal(evidenceOnlyBatch.rows[0].previewUnitCost, null);
  assert.equal(evidenceOnlyBatch.warehouseEvidence[0].excludedRecords[0].purchaseOrderId, "PO-ONLY");
  assert.equal(evidenceOnlyBatch.warehouseEvidence[0].excludedRecords[0].supplierName, "供应商 A");
  assert.deepEqual(evidenceOnlyBatch.sourceMeta.sourceWarnings, [
    "excluded-only",
    "mapping_failure:missing_expected_platform_sku:SKU-EVIDENCE-ONLY",
  ]);

  await post("/erp/v1/requests", {
    request: { id: "GLOBAL-EXCLUSION", workspaceId: "workspace-evidence", ledgerId: "ledger-global-exclusion", platformSkcs: [{ platformSkc: "SKC-GLOBAL-EXCLUSION" }] },
    expectedSkus: [{ platformSku: "SKU-GLOBAL-EXCLUSION", platformSkc: "SKC-GLOBAL-EXCLUSION" }],
  });
  response = await post("/erp/v1/cost-results", {
    resultDeliveryId: "RESULT-GLOBAL-EXCLUSION",
    requestId: "GLOBAL-EXCLUSION",
    ledgerId: "ledger-global-exclusion",
    workspaceId: "workspace-evidence",
    querySkcs: ["SKC-GLOBAL-EXCLUSION"],
    rows: [{ platformSku: "SKU-GLOBAL-EXCLUSION", platformSkc: "SKC-GLOBAL-EXCLUSION", warehouseSku: "WH-GLOBAL-EXCLUSION", unitCost: 2.5 }],
    sourceMeta: {
      exclusionStats: [{ recordId: "GLOBAL-EXCLUDED", warehouseSku: null, exclusionReasons: "cancelled_or_closed" }],
    },
    warehouseEvidence: {
      formatVersion: 1,
      warehouses: [{ warehouseSku: "WH-GLOBAL-EXCLUSION", evidenceComplete: true, purchaseRecords: [{ recordId: "GLOBAL-R1", quantity: 2, unitPrice: 2.5 }] }],
      excludedDetails: [{ recordId: "GLOBAL-EXCLUDED", exclusionReasons: ["cancelled_or_closed"] }],
    },
  });
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-evidence&ledgerId=ledger-global-exclusion`);
  const globalExclusionBatch = (await response.json()).records[0].envelope.batch;
  assert.equal(globalExclusionBatch.evidenceStatus, "complete");
  assert.equal(globalExclusionBatch.warehouseEvidence[0].evidenceComplete, true);
  assert.deepEqual(globalExclusionBatch.warehouseEvidence[0].excludedRecords, []);
  assert.deepEqual(globalExclusionBatch.warehouseEvidence[0].sourceWarnings, []);
  assert.deepEqual(globalExclusionBatch.sourceMeta.exclusionStats, [
    { recordId: "GLOBAL-EXCLUDED", warehouseSku: null, exclusionReasons: "cancelled_or_closed" },
  ]);

  await post("/erp/v1/requests", {
    request: { id: "WARNING-EVIDENCE", workspaceId: "workspace-evidence", ledgerId: "ledger-warning-evidence", platformSkcs: [{ platformSkc: "SKC-WARNING" }] },
    expectedSkus: [{ platformSku: "SKU-WARNING", platformSkc: "SKC-WARNING" }],
  });
  response = await post("/erp/v1/cost-results", {
    resultDeliveryId: "RESULT-WARNING-EVIDENCE",
    requestId: "WARNING-EVIDENCE",
    ledgerId: "ledger-warning-evidence",
    workspaceId: "workspace-evidence",
    querySkcs: ["SKC-WARNING"],
    rows: [{ platformSku: "SKU-WARNING", platformSkc: "SKC-WARNING", warehouseSku: "WH-WARNING", unitCost: 2.5, sourceWarnings: ["row-warning"] }],
    sourceMeta: { queryCapturedAt: "2026-08-19T07:59:00.000Z", registeredBefore: "2026-08-19T07:59:00.000Z" },
    warehouseEvidence: {
      formatVersion: 1,
      warehouses: [{ warehouseSku: "WH-WARNING", evidenceComplete: true, sourceWarnings: ["entry-warning"], purchaseRecords: [] }],
    },
  });
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-evidence&ledgerId=ledger-warning-evidence`);
  const warningEvidenceBatch = (await response.json()).records[0].envelope.batch;
  assert.equal(warningEvidenceBatch.evidenceStatus, "legacy_partial");
  assert.equal(warningEvidenceBatch.warehouseEvidence[0].evidenceComplete, false);
  assert.ok(warningEvidenceBatch.warehouseEvidence[0].sourceWarnings.includes("entry-warning"));
  assert.equal(warningEvidenceBatch.warehouseEvidence[0].sourceWarnings.includes("row-warning"), false);
  assert.ok(warningEvidenceBatch.rows[0].sourceWarnings.includes("row-warning"));
  assert.equal(warningEvidenceBatch.sourceMeta.queryCapturedAt, "2026-08-19T07:59:00.000Z");
  assert.equal(warningEvidenceBatch.sourceMeta.registeredBefore, "2026-08-19T07:59:00.000Z");

  await post("/erp/v1/requests", {
    request: { id: "META-WARNING-ONLY", workspaceId: "workspace-evidence", ledgerId: "ledger-meta-warning-only", platformSkcs: [{ platformSkc: "SKC-META-WARNING" }] },
    expectedSkus: [{ platformSku: "SKU-META-WARNING", platformSkc: "SKC-META-WARNING" }],
  });
  response = await post("/erp/v1/cost-results", {
    resultDeliveryId: "RESULT-META-WARNING-ONLY",
    requestId: "META-WARNING-ONLY",
    ledgerId: "ledger-meta-warning-only",
    workspaceId: "workspace-evidence",
    querySkcs: ["SKC-META-WARNING"],
    rows: [{ platformSku: "SKU-META-WARNING", platformSkc: "SKC-META-WARNING", warehouseSku: "WH-META-WARNING", unitCost: 2.5 }],
    sourceMeta: { sourceWarnings: ["top-level-collection-warning"] },
    warehouseEvidence: {
      formatVersion: 1,
      warehouses: [{ warehouseSku: "WH-META-WARNING", evidenceComplete: true, purchaseRecords: [{ recordId: "META-R1", quantity: 2, unitPrice: 2.5 }] }],
    },
  });
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-evidence&ledgerId=ledger-meta-warning-only`);
  const metaWarningOnlyBatch = (await response.json()).records[0].envelope.batch;
  assert.equal(metaWarningOnlyBatch.warehouseEvidence[0].evidenceComplete, true);
  assert.equal(metaWarningOnlyBatch.sourceMeta.evidenceComplete, false);
  assert.equal(metaWarningOnlyBatch.evidenceStatus, "legacy_partial");

  await post("/erp/v1/requests", {
    request: { id: "INVALID-META-WARNINGS", workspaceId: "workspace-evidence", ledgerId: "ledger-invalid-meta-warnings", platformSkcs: [{ platformSkc: "SKC-INVALID-META" }] },
    expectedSkus: [{ platformSku: "SKU-INVALID-META", platformSkc: "SKC-INVALID-META" }],
  });
  for (const [fixtureId, sourceWarnings] of [
    ["STRING", "top-level-warning"],
    ["OBJECT", { code: "top-level-warning" }],
    ["NUMBER-ITEM", ["valid-warning", 7]],
  ]) {
    response = await post("/erp/v1/cost-results", {
      resultDeliveryId: `RESULT-INVALID-META-${fixtureId}`,
      requestId: "INVALID-META-WARNINGS",
      ledgerId: "ledger-invalid-meta-warnings",
      workspaceId: "workspace-evidence",
      querySkcs: ["SKC-INVALID-META"],
      rows: [{ platformSku: "SKU-INVALID-META", platformSkc: "SKC-INVALID-META", warehouseSku: "WH-INVALID-META", unitCost: 2.5 }],
      sourceMeta: { sourceWarnings },
      warehouseEvidence: {
        formatVersion: 1,
        warehouses: [{ warehouseSku: "WH-INVALID-META", evidenceComplete: true, purchaseRecords: [{ recordId: "INVALID-META-R1", quantity: 2, unitPrice: 2.5 }] }],
      },
    });
    assert.equal(response.status, 400, fixtureId);
    assert.equal((await response.json()).error, "INVALID_ERP_EVIDENCE", fixtureId);
  }

  await post("/erp/v1/requests", {
    request: { id: "INVALID-NESTED-WARNINGS", workspaceId: "workspace-evidence", ledgerId: "ledger-invalid-nested-warnings", platformSkcs: [{ platformSkc: "SKC-INVALID-NESTED" }] },
    expectedSkus: [{ platformSku: "SKU-INVALID-NESTED", platformSkc: "SKC-INVALID-NESTED" }],
  });
  for (const [fixtureId, target, sourceWarnings] of [
    ["ROW-STRING", "row", "row-warning"],
    ["ROW-OBJECT", "row", { code: "row-warning" }],
    ["ROW-NUMBER-ITEM", "row", ["valid-warning", 7]],
    ["EVIDENCE-STRING", "evidence", "entry-warning"],
    ["EVIDENCE-OBJECT", "evidence", { code: "entry-warning" }],
    ["EVIDENCE-NUMBER-ITEM", "evidence", ["valid-warning", 7]],
  ]) {
    response = await post("/erp/v1/cost-results", {
      resultDeliveryId: `RESULT-INVALID-NESTED-${fixtureId}`,
      requestId: "INVALID-NESTED-WARNINGS",
      ledgerId: "ledger-invalid-nested-warnings",
      workspaceId: "workspace-evidence",
      querySkcs: ["SKC-INVALID-NESTED"],
      rows: [{
        platformSku: "SKU-INVALID-NESTED",
        platformSkc: "SKC-INVALID-NESTED",
        warehouseSku: "WH-INVALID-NESTED",
        unitCost: 2.5,
        ...(target === "row" ? { sourceWarnings } : {}),
      }],
      warehouseEvidence: {
        formatVersion: 1,
        warehouses: [{
          warehouseSku: "WH-INVALID-NESTED",
          evidenceComplete: true,
          purchaseRecords: [{ recordId: "INVALID-NESTED-R1", quantity: 2, unitPrice: 2.5 }],
          ...(target === "evidence" ? { sourceWarnings } : {}),
        }],
      },
    });
    assert.equal(response.status, 400, fixtureId);
    assert.equal((await response.json()).error, "INVALID_ERP_EVIDENCE", fixtureId);
  }

  await post("/erp/v1/requests", {
    request: { id: "SERVER-AMB", workspaceId: "workspace-server-amb", ledgerId: "ledger-server-amb", platformSkcs: [{ platformSkc: "SKC-SERVER-AMB" }] },
    expectedSkus: [{ platformSku: "SKU-SERVER-AMB", platformSkc: "SKC-SERVER-AMB" }],
  });
  const ambiguousSpool = JSON.parse(await fs.readFile(spoolPath, "utf8"));
  const registeredAmbiguousRequest = ambiguousSpool.find((item) => item.kind === "request" && item.requestId === "SERVER-AMB");
  ambiguousSpool.push({ ...registeredAmbiguousRequest, duplicateFixture: true, registeredAt: new Date(Date.now() - 1).toISOString() });
  await fs.writeFile(spoolPath, JSON.stringify(ambiguousSpool, null, 2), "utf8");
  response = await post("/erp/v1/cost-results", {
    resultDeliveryId: "RESULT-SERVER-AMB",
    requestId: "SERVER-AMB",
    ledgerId: "ledger-server-amb",
    workspaceId: "workspace-server-amb",
    querySkcs: ["SKC-SERVER-AMB"],
    rows: [{ platformSku: "SKU-SERVER-AMB", warehouseSku: "WH-SERVER-AMB", unitCost: 4 }],
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "ERP_REQUEST_AMBIGUOUS");
  await fs.writeFile(spoolPath, JSON.stringify(ambiguousSpool.filter((item) => !item.duplicateFixture), null, 2), "utf8");

  const idempotentRequestPayload = {
    request: {
      id: "REQUEST-IDEMPOTENCY",
      workspaceId: "workspace-request-idempotency",
      ledgerId: "ledger-request-idempotency",
      platformSkcs: [{ platformSkc: "ＳＫＣ-IDEMPOTENT" }, { platformSkc: "skc-idempotent" }],
    },
    expectedSkus: [{ platformSku: "sku-idempotent", platformSkc: "SKC-IDEMPOTENT" }],
  };
  response = await post("/erp/v1/requests", idempotentRequestPayload);
  assert.equal(response.status, 202);
  response = await post("/erp/v1/requests", {
    ...idempotentRequestPayload,
    request: {
      ...idempotentRequestPayload.request,
      platformSkcs: [{ platformSkc: "skc-idempotent" }],
    },
    expectedSkus: [{ platformSku: "SKU-IDEMPOTENT", platformSkc: "ｓｋｃ－ｉｄｅｍｐｏｔｅｎｔ" }],
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).idempotent, true);
  response = await post("/erp/v1/requests", {
    ...idempotentRequestPayload,
    expectedSkus: [{ platformSku: "SKU-DIFFERENT", platformSkc: "SKC-IDEMPOTENT" }],
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "ERP_REQUEST_CONFLICT");

  await post("/erp/v1/requests", {
    request: {
      id: "SAME-OLD",
      workspaceId: "workspace-same-scope",
      ledgerId: "ledger-same-scope",
      platformSkcs: [{ platformSkc: "SKC-SAME" }],
    },
    expectedSkus: [{ platformSku: "SKU-SAME", platformSkc: "SKC-SAME" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await post("/erp/v1/requests", {
    request: {
      id: "SAME-NEW",
      workspaceId: "workspace-same-scope",
      ledgerId: "ledger-same-scope",
      platformSkcs: [{ platformSkc: "SKC-SAME" }],
    },
    expectedSkus: [{ platformSku: "SKU-SAME", platformSkc: "SKC-SAME" }],
  });
  response = await post("/erp/v1/cost-results", {
    requestId: "SAME-NEW",
    ledgerId: "ledger-same-scope",
    workspaceId: "workspace-same-scope",
    querySkcs: ["SKC-SAME"],
    resultDeliveryId: "RESULT-SAME-NEW",
    rows: [{ platformSku: "SKU-SAME", warehouseSku: "WH-SAME", unitCost: 4 }],
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).requestId, "SAME-NEW");

  response = await post("/erp/v1/cost-batches", { deliveryId: delivered.deliveryId, workspaceId: "workspace-other", status: "acknowledged" });
  assert.equal(response.status, 404);
  response = await post("/erp/v1/cost-batches", { deliveryId: delivered.deliveryId, workspaceId: "workspace-test", status: "acknowledged" });
  assert.equal(response.status, 200);
  response = await post("/erp/v1/cost-batches", { deliveryId: delivered.deliveryId, workspaceId: "workspace-test", status: "acknowledged" });
  assert.equal(response.status, 200);

  response = await post("/erp/v1/cost-batches", directInboxFixture({
    outerVersion: 1,
    innerVersion: 1,
    deliveryId: "ERP-DELIVERY-LEGACY",
    batchId: "ERP-BATCH-LEGACY",
    workspaceId: "workspace-test",
    ledgerId: "ledger-LEGACY",
    requestId: "LEGACY",
    platformSkc: "SKC-LEGACY",
    sentAt: "2026-08-11T08:00:00.000Z",
    rows: [{ platformSku: "SKU-LEGACY", platformSkc: "SKC-LEGACY", warehouseSku: "WH-LEGACY", unitCost: 2 }],
    warehouseEvidence: [],
  }));
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/status`);
  runtimeStatus = await response.json();
  assert.equal(runtimeStatus.latestBatch.sourceFormatVersion, 1);
  assert.equal(runtimeStatus.latestBatch.evidenceStatus, "legacy_partial");

  response = await post("/erp/v1/cost-batches", directInboxFixture({
    deliveryId: "ERP-DELIVERY-DIRECT-WARNING",
    batchId: "ERP-BATCH-DIRECT-WARNING",
    workspaceId: "workspace-direct-warning",
    ledgerId: "ledger-direct-warning",
    requestId: "request-direct-warning",
    platformSkc: "SKC-DIRECT-WARNING",
    rows: [{ platformSku: "SKU-DIRECT-WARNING", platformSkc: "SKC-DIRECT-WARNING", warehouseSku: "WH-DIRECT-WARNING", unitCost: 2, sourceWarnings: ["direct-row-warning"] }],
    warehouseEvidence: [{ warehouseSku: "WH-DIRECT-WARNING", evidenceComplete: true, sourceWarnings: ["direct-entry-warning"], purchaseRecords: [] }],
  }));
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-direct-warning&ledgerId=ledger-direct-warning`);
  const directWarningBatch = (await response.json()).records[0].envelope.batch;
  assert.equal(directWarningBatch.evidenceStatus, "legacy_partial");
  assert.equal(directWarningBatch.warehouseEvidence[0].evidenceComplete, false);
  assert.equal(directWarningBatch.warehouseEvidence[0].sourceWarnings.includes("direct-row-warning"), false);
  assert.ok(directWarningBatch.rows[0].sourceWarnings.includes("direct-row-warning"));
  assert.ok(directWarningBatch.warehouseEvidence[0].sourceWarnings.includes("direct-entry-warning"));

  response = await post("/erp/v1/cost-batches", directInboxFixture({
    deliveryId: "ERP-DELIVERY-DIRECT-META-WARNING",
    batchId: "ERP-BATCH-DIRECT-META-WARNING",
    workspaceId: "workspace-direct-meta-warning",
    ledgerId: "ledger-direct-meta-warning",
    requestId: "request-direct-meta-warning",
    platformSkc: "SKC-DIRECT-META-WARNING",
    sentAt: "2026-08-19T08:01:00.000Z",
    sourceMeta: { sourceWarnings: ["top-level-collection-warning"] },
    rows: [{ platformSku: "SKU-DIRECT-META-WARNING", platformSkc: "SKC-DIRECT-META-WARNING", warehouseSku: "WH-DIRECT-META-WARNING", unitCost: 2 }],
    warehouseEvidence: [{ warehouseSku: "WH-DIRECT-META-WARNING", evidenceComplete: true, purchaseRecords: [] }],
  }));
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-direct-meta-warning&ledgerId=ledger-direct-meta-warning`);
  const directMetaWarningBatch = (await response.json()).records[0].envelope.batch;
  assert.equal(directMetaWarningBatch.evidenceStatus, "legacy_partial");
  assert.equal(directMetaWarningBatch.sourceMeta.evidenceComplete, false);
  assert.deepEqual(directMetaWarningBatch.sourceMeta.sourceWarnings, ["top-level-collection-warning"]);

  for (const failureField of ["detailFailures", "mappingFailures"]) {
    const suffix = failureField === "detailFailures" ? "DETAIL" : "MAPPING";
    response = await post("/erp/v1/cost-batches", directInboxFixture({
      deliveryId: `ERP-DELIVERY-DIRECT-${suffix}-FAILURE`,
      batchId: `ERP-BATCH-DIRECT-${suffix}-FAILURE`,
      workspaceId: "workspace-direct-source-failure",
      ledgerId: `ledger-direct-${suffix.toLowerCase()}-failure`,
      requestId: `request-direct-${suffix.toLowerCase()}-failure`,
      platformSkc: `SKC-DIRECT-${suffix}-FAILURE`,
      sourceMeta: { [failureField]: [{ message: `${suffix.toLowerCase()} failed` }] },
      rows: [{ platformSku: `SKU-DIRECT-${suffix}-FAILURE`, platformSkc: `SKC-DIRECT-${suffix}-FAILURE`, warehouseSku: `WH-DIRECT-${suffix}-FAILURE`, unitCost: 2 }],
      warehouseEvidence: [{ warehouseSku: `WH-DIRECT-${suffix}-FAILURE`, evidenceComplete: true, purchaseRecords: [{ recordId: `${suffix}-R1`, quantity: 1, unitPrice: 2 }] }],
    }));
    assert.equal(response.status, 202, failureField);
    response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-direct-source-failure&ledgerId=${encodeURIComponent(`ledger-direct-${suffix.toLowerCase()}-failure`)}`);
    const batchWithSourceFailure = (await response.json()).records[0].envelope.batch;
    assert.equal(batchWithSourceFailure.evidenceStatus, "legacy_partial", failureField);
    assert.equal(batchWithSourceFailure.sourceMeta.evidenceComplete, false, failureField);
    assert.equal(batchWithSourceFailure.sourceMeta[failureField].length, 1, failureField);
  }

  for (const [fixtureId, sourceWarnings] of [
    ["STRING", "top-level-warning"],
    ["OBJECT", { code: "top-level-warning" }],
    ["NUMBER-ITEM", ["valid-warning", 7]],
  ]) {
    response = await post("/erp/v1/cost-batches", directInboxFixture({
      deliveryId: `ERP-DELIVERY-INVALID-META-${fixtureId}`,
      batchId: `ERP-BATCH-INVALID-META-${fixtureId}`,
      workspaceId: "workspace-invalid-meta-warning",
      ledgerId: `ledger-invalid-meta-warning-${fixtureId}`,
      requestId: `request-invalid-meta-warning-${fixtureId}`,
      platformSkc: `SKC-INVALID-META-${fixtureId}`,
      sentAt: "2026-08-19T08:02:00.000Z",
      sourceMeta: { sourceWarnings },
      rows: [{ platformSku: `SKU-INVALID-META-${fixtureId}`, platformSkc: `SKC-INVALID-META-${fixtureId}`, warehouseSku: `WH-INVALID-META-${fixtureId}`, unitCost: 2 }],
    }));
    assert.equal(response.status, 400, fixtureId);
    assert.equal((await response.json()).error, "INVALID_ERP_EVIDENCE", fixtureId);
  }

  for (const [fixtureId, target, sourceWarnings] of [
    ["ROW-STRING", "row", "row-warning"],
    ["ROW-OBJECT", "row", { code: "row-warning" }],
    ["ROW-NUMBER-ITEM", "row", ["valid-warning", 7]],
    ["EVIDENCE-STRING", "evidence", "entry-warning"],
    ["EVIDENCE-OBJECT", "evidence", { code: "entry-warning" }],
    ["EVIDENCE-NUMBER-ITEM", "evidence", ["valid-warning", 7]],
  ]) {
    response = await post("/erp/v1/cost-batches", directInboxFixture({
      deliveryId: `ERP-DELIVERY-INVALID-NESTED-${fixtureId}`,
      batchId: `ERP-BATCH-INVALID-NESTED-${fixtureId}`,
      workspaceId: "workspace-invalid-nested-warning",
      ledgerId: `ledger-invalid-nested-warning-${fixtureId}`,
      requestId: `request-invalid-nested-warning-${fixtureId}`,
      platformSkc: `SKC-INVALID-NESTED-${fixtureId}`,
      sentAt: "2026-08-19T08:03:00.000Z",
      rows: [{
        platformSku: `SKU-INVALID-NESTED-${fixtureId}`,
        platformSkc: `SKC-INVALID-NESTED-${fixtureId}`,
        warehouseSku: `WH-INVALID-NESTED-${fixtureId}`,
        unitCost: 2,
        ...(target === "row" ? { sourceWarnings } : {}),
      }],
      warehouseEvidence: [{
        warehouseSku: `WH-INVALID-NESTED-${fixtureId}`,
        evidenceComplete: true,
        purchaseRecords: [],
        ...(target === "evidence" ? { sourceWarnings } : {}),
      }],
    }));
    assert.equal(response.status, 400, fixtureId);
    assert.equal((await response.json()).error, "INVALID_ERP_EVIDENCE", fixtureId);
  }

  for (const [fixtureId, outerVersion, innerVersion] of [
    ["OUTER-V1-INNER-V2", 1, 2],
    ["OUTER-V2-INNER-V1", 2, 1],
  ]) {
    response = await post("/erp/v1/cost-batches", directInboxFixture({
      outerVersion,
      innerVersion,
      deliveryId: `ERP-DELIVERY-${fixtureId}`,
      batchId: `ERP-BATCH-${fixtureId}`,
      workspaceId: "workspace-version-mismatch",
      ledgerId: `ledger-${fixtureId}`,
      requestId: `request-${fixtureId}`,
      platformSkc: `SKC-${fixtureId}`,
      sentAt: "2026-08-19T08:04:00.000Z",
      rows: [{ platformSku: `SKU-${fixtureId}`, platformSkc: `SKC-${fixtureId}`, warehouseSku: `WH-${fixtureId}`, unitCost: 2 }],
      warehouseEvidence: innerVersion === 1 ? [] : undefined,
    }));
    assert.equal(response.status, 202, fixtureId);
    response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-version-mismatch&ledgerId=${encodeURIComponent(`ledger-${fixtureId}`)}`);
    const [versionedRecord] = (await response.json()).records;
    assert.equal(versionedRecord.envelope.sourceFormatVersion, 1, fixtureId);
    assert.equal(versionedRecord.envelope.batch.sourceFormatVersion, 1, fixtureId);
    assert.equal(versionedRecord.envelope.batch.evidenceStatus, "legacy_partial", fixtureId);
  }

  const outerLegacyMalformedInner = directInboxFixture({
    outerVersion: 1,
    innerVersion: 2,
    deliveryId: "ERP-DELIVERY-OUTER-LEGACY-MALFORMED-INNER",
    batchId: "ERP-BATCH-OUTER-LEGACY-MALFORMED-INNER",
    workspaceId: "workspace-version-mismatch",
    ledgerId: "ledger-outer-legacy-malformed-inner",
    requestId: "request-outer-legacy-malformed-inner",
    platformSkc: "SKC-OUTER-LEGACY-MALFORMED-INNER",
    rows: [{ platformSku: "SKU-OUTER-LEGACY-MALFORMED-INNER", platformSkc: "SKC-OUTER-LEGACY-MALFORMED-INNER", warehouseSku: "WH-OUTER-LEGACY-MALFORMED-INNER", unitCost: 2, sourceWarnings: "malformed-warning" }],
  });
  response = await post("/erp/v1/cost-batches", outerLegacyMalformedInner);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "INVALID_ERP_EVIDENCE");

  const evidenceOnlyDirect = directInboxFixture({
    deliveryId: "ERP-DELIVERY-DIRECT-EVIDENCE-ONLY",
    batchId: "ERP-BATCH-DIRECT-EVIDENCE-ONLY",
    workspaceId: "workspace-direct-evidence-only",
    ledgerId: "ledger-direct-evidence-only",
    requestId: "request-direct-evidence-only",
    platformSkc: "SKC-DIRECT-EVIDENCE-ONLY",
    rows: [{ platformSku: "SKU-DIRECT-EVIDENCE", platformSkc: "SKC-DIRECT-EVIDENCE-ONLY", warehouseSku: "WH-DIRECT-EVIDENCE", unitCost: 2 }],
    warehouseEvidence: [
      { warehouseSku: "WH-DIRECT-EVIDENCE", evidenceComplete: true, purchaseRecords: [] },
      { warehouseSku: "WH-DIRECT-EVIDENCE-ONLY", evidenceComplete: false, purchaseRecords: [], excludedRecords: [{ recordId: "DIRECT-EXCLUDED", warehouseSku: "WH-DIRECT-EVIDENCE-ONLY", exclusionReasons: ["cancelled_or_closed"] }] },
    ],
  });
  response = await post("/erp/v1/cost-batches", evidenceOnlyDirect);
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-direct-evidence-only&ledgerId=ledger-direct-evidence-only`);
  const [evidenceOnlyDirectRecord] = (await response.json()).records;
  assert.equal(evidenceOnlyDirectRecord.envelope.batch.rows.length, 2);
  assert.equal(evidenceOnlyDirectRecord.envelope.batch.rows.find((row) => row.warehouseSku === "WH-DIRECT-EVIDENCE-ONLY").previewUnitCost, null);
  assert.equal(evidenceOnlyDirectRecord.envelope.batch.warehouseEvidence.find((entry) => entry.warehouseSku === "WH-DIRECT-EVIDENCE-ONLY").excludedRecords[0].recordId, "DIRECT-EXCLUDED");

  for (const [fixtureId, mutate] of [
    ["WRONG-FORMAT", (payload) => ({ ...payload, format: "wrong-format" })],
    ["WRONG-BASELINE", (payload) => ({ ...payload, baseline: { ...payload.baseline, version: "7.9.9" } })],
    ["BROKEN-EVIDENCE-REF", (payload) => ({ ...payload, batch: { ...payload.batch, rows: payload.batch.rows.map((row) => ({ ...row, evidenceRef: "warehouse:OTHER" })) } })],
    ["BROKEN-EVIDENCE-ENTRY-REF", (payload) => ({ ...payload, batch: { ...payload.batch, warehouseEvidence: payload.batch.warehouseEvidence.map((entry) => ({ ...entry, evidenceRef: "warehouse:OTHER" })) } })],
    ["DUPLICATE-EVIDENCE", (payload) => ({ ...payload, batch: { ...payload.batch, warehouseEvidence: [...payload.batch.warehouseEvidence, { ...payload.batch.warehouseEvidence[0] }] } })],
  ]) {
    const valid = directInboxFixture({
      deliveryId: `ERP-DELIVERY-INVALID-CONTRACT-${fixtureId}`,
      batchId: `ERP-BATCH-INVALID-CONTRACT-${fixtureId}`,
      workspaceId: "workspace-invalid-direct-contract",
      ledgerId: `ledger-invalid-direct-contract-${fixtureId}`,
      requestId: `request-invalid-direct-contract-${fixtureId}`,
      rows: [{ platformSku: `SKU-INVALID-CONTRACT-${fixtureId}`, platformSkc: "SKC-DIRECT", warehouseSku: `WH-INVALID-CONTRACT-${fixtureId}`, unitCost: 2 }],
    });
    response = await post("/erp/v1/cost-batches", mutate(valid));
    assert.equal(response.status, 400, fixtureId);
    assert.equal((await response.json()).error, "INVALID_INBOX_MESSAGE", fixtureId);
  }

  await post("/erp/v1/requests", {
    request: {
      id: "MULTI",
      workspaceId: "workspace-test",
      ledgerId: "ledger-MULTI",
      platformSkcs: [{ platformSkc: "SKC-MULTI" }],
    },
    expectedSkus: [
      { platformSku: "SKU-MULTI-RED", platformSkc: "SKC-MULTI" },
      { platformSku: "SKU-MULTI-BLUE", platformSkc: "SKC-MULTI" },
    ],
  });
  response = await post("/erp/v1/cost-results", {
    requestId: "MULTI",
    ledgerId: "ledger-MULTI",
    workspaceId: "workspace-test",
    querySkcs: ["SKC-MULTI"],
    resultDeliveryId: "RESULT-MULTI",
    rows: [
      { platformSku: "SKU-MULTI-RED", warehouseSku: "WH-MULTI", unitCost: 3.5 },
      { platformSku: "SKU-MULTI-BLUE", warehouseSku: "WH-MULTI", unitCost: 3.5 },
    ],
  });
  assert.equal(response.status, 202);
  const multiDelivered = await response.json();
  assert.equal(multiDelivered.requestId, "MULTI");
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-test&ledgerId=ledger-MULTI`);
  assert.equal(response.status, 200);
  const multiPending = await response.json();
  const multiBatch = multiPending.records.find((item) => item.batchId === multiDelivered.batchId);
  assert.equal(multiBatch.envelope.batch.query.platformSkcs[0].platformSkc, "SKC-MULTI");
  assert.deepEqual(multiBatch.envelope.batch.rows.map((row) => row.platformSku).sort(), ["SKU-MULTI-BLUE", "SKU-MULTI-RED"]);
  await post("/erp/v1/cost-batches", { deliveryId: multiDelivered.deliveryId, workspaceId: "workspace-test", status: "acknowledged" });

  const sharedQuerySkcs = [
    "st260608151900573902683",
    "st260606170768328630349",
    "SKC-SHARED-3",
    "SKC-SHARED-4",
    "SKC-SHARED-5",
    "SKC-SHARED-6",
    "SKC-SHARED-7",
  ];
  const sharedExpectedSkus = [
    { platformSku: "I3mqgejkr1vhv7", platformSkc: sharedQuerySkcs[0] },
    ...Array.from({ length: 18 }, (_, index) => ({
      platformSku: `SKU-SHARED-EXPECTED-${String(index + 2).padStart(2, "0")}`,
      platformSkc: sharedQuerySkcs[(index + 2) % sharedQuerySkcs.length],
    })),
  ];
  response = await post("/erp/v1/requests", {
    request: {
      id: "SHARED-WAREHOUSE-REAL",
      workspaceId: "workspace-shared-warehouse-real",
      ledgerId: "ledger-shared-warehouse-real",
      platformSkcs: sharedQuerySkcs.map((platformSkc) => ({ platformSkc })),
    },
    expectedSkus: sharedExpectedSkus,
  });
  assert.equal(response.status, 202);
  const sharedWarehouseSku = "SH25092037232977233-Y";
  const sharedRows = sharedExpectedSkus.map((item, index) => ({
    platformSku: item.platformSku,
    platformSkc: item.platformSkc,
    warehouseSku: index === 0 ? sharedWarehouseSku : `WH-SHARED-EXPECTED-${index + 1}`,
    unitCost: index === 0 ? 1.99 : 4,
  }));
  sharedRows.push({
    platformSku: "I0mr8u67we1unj",
    platformSkc: sharedQuerySkcs[1],
    warehouseSku: sharedWarehouseSku,
    unitCost: 1.99,
    ledgerScopeRole: "expected",
  });
  const sharedEvidence = [
    {
      warehouseSku: sharedWarehouseSku,
      evidenceComplete: true,
      purchaseRecords: Array.from({ length: 12 }, (_, index) => ({
        recordId: `SHARED-REAL-${index + 1}`,
        quantity: 1,
        unitPrice: 1.99,
        purchaseDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
      })),
      excludedRecords: [],
    },
    ...sharedRows.slice(1, 19).map((row, index) => ({
      warehouseSku: row.warehouseSku,
      evidenceComplete: true,
      purchaseRecords: [{ recordId: `EXPECTED-${index + 2}`, quantity: 1, unitPrice: 4, purchaseDate: "2026-07-01" }],
      excludedRecords: [],
    })),
  ];
  response = await post("/erp/v1/cost-results", {
    requestId: "SHARED-WAREHOUSE-REAL",
    ledgerId: "ledger-shared-warehouse-real",
    workspaceId: "workspace-shared-warehouse-real",
    querySkcs: sharedQuerySkcs,
    resultDeliveryId: "RESULT-SHARED-WAREHOUSE-REAL",
    rows: sharedRows,
    sourceMeta: { extensionVersion: "8.0.14" },
    warehouseEvidence: { formatVersion: 1, warehouses: sharedEvidence },
  });
  assert.equal(response.status, 202);
  response = await fetch(`${base}/erp/v1/cost-batches?workspaceId=workspace-shared-warehouse-real&ledgerId=ledger-shared-warehouse-real`);
  const sharedScopeBatch = (await response.json()).records[0].envelope.batch;
  const expectedScopeRows = sharedScopeBatch.rows.filter((row) => row.ledgerScopeRole === "expected");
  const auxiliaryScopeRows = sharedScopeBatch.rows.filter((row) => row.ledgerScopeRole === "auxiliary");
  assert.equal(expectedScopeRows.length, 19);
  assert.equal(auxiliaryScopeRows.length, 1);
  assert.equal(auxiliaryScopeRows[0].platformSku, "I0mr8u67we1unj");
  assert.equal(auxiliaryScopeRows[0].sourceWarnings.some((warning) => warning.includes("unknown_platform_sku")), false);
  assert.equal(expectedScopeRows.find((row) => row.platformSku === "I3mqgejkr1vhv7").sourceWarnings.length, 0);
  assert.equal(sharedScopeBatch.warehouseEvidence.find((entry) => entry.warehouseSku === sharedWarehouseSku).sourceWarnings.length, 0);
  assert.equal(sharedScopeBatch.warehouseEvidence.find((entry) => entry.warehouseSku === sharedWarehouseSku).purchaseRecords.length, 12);
  assert.equal(sharedScopeBatch.evidenceStatus, "complete");
  assert.equal(sharedScopeBatch.sourceMeta.evidenceComplete, true);

  await post("/erp/v1/requests", request("EXPIRED", "SKU-EXPIRED"));
  const spool = JSON.parse(await fs.readFile(spoolPath, "utf8"));
  const expired = spool.find((item) => item.kind === "request" && item.requestId === "EXPIRED");
  expired.registeredAt = "2020-01-01T00:00:00.000Z";
  await fs.writeFile(spoolPath, JSON.stringify(spool, null, 2), "utf8");
  response = await fetch(`${base}/erp/v1/requests?workspaceId=workspace-test&includeHistory=true`);
  assert.equal(response.status, 200);
  const history = await response.json();
  assert.equal(history.records.find((item) => item.requestId === "EXPIRED").status, "expired");

  const persistedSpool = await fs.readFile(spoolPath, "utf8");
  assert.equal(persistedSpool.includes(capability), false, "capability must never enter the spool");
  assert.equal(serverStdout.includes(capability), false, "capability must never enter stdout");
  assert.equal(serverStderr.includes(capability), false, "capability must never enter stderr");

  console.log("ERP inbox server tests passed");
} finally {
  child.kill("SIGINT");
  await fs.rm(spoolPath, { force: true });
}
