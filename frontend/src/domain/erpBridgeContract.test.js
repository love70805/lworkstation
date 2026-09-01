import { describe, expect, it } from "vitest";
import { buildErpCostBatchEnvelope } from "./erpCostBatchEnvelope.js";
import {
  ERP_BRIDGE_REQUEST_FORMAT,
  buildErpBridgeBatchEnvelope,
  buildErpBridgeRequest,
  validateErpBridgeRequest,
  validateErpBridgeResponse,
} from "./erpBridgeContract.js";
import { buildErpCostRequest } from "./erpCosts.js";

function requestFixture() {
  return buildErpCostRequest({
    id: "ERP-REQ-1",
    workspaceId: "workspace-default",
    ledgerId: "LEDGER-1",
    platformSkcs: ["SKC-1", "skc-1", "SKC-2"],
    requestedBy: "local-user",
    requestedAt: "2026-08-07T08:00:00.000Z",
  });
}

describe("ERP bridge contract", () => {
  it("builds a versioned request package from the existing request", () => {
    const result = buildErpBridgeRequest({ request: requestFixture() });
    expect(result).toMatchObject({
      format: ERP_BRIDGE_REQUEST_FORMAT,
      requestId: "ERP-REQ-1",
      query: { unit: "platform_skc" },
      summary: { querySkcCount: 2 },
      currency: "CNY",
    });
    expect(result.query.platformSkcs.map((item) => item.canonicalPlatformSkc)).toEqual(["SKC-1", "SKC-2"]);
  });

  it("rejects tampered request metadata", () => {
    const request = buildErpBridgeRequest({ request: requestFixture() });
    expect(() => validateErpBridgeRequest({ ...request, currency: "USD" })).toThrow("CNY");
    expect(() => validateErpBridgeRequest({ ...request, summary: { querySkcCount: 9 } })).toThrow("数量校验失败");
  });

  it("requires response query scope to equal the request scope", () => {
    const request = buildErpBridgeRequest({ request: requestFixture() });
    const response = buildErpCostBatchEnvelope({
      batchId: "ERP-BATCH-1",
      workspaceId: "workspace-default",
      ledgerId: "LEDGER-1",
      requestId: "ERP-REQ-1",
      platformSkcs: ["SKC-1", "SKC-2"],
      generatedAt: "2026-08-07T09:00:00.000Z",
      results: [{ warehouseSku: "WH-1", platformSkc: "SKC-1", mappings: [{ platformSku: "SKU-1" }], unitCost: 4 }],
      warehouseEvidence: [{ warehouseSku: "WH-1", evidenceComplete: true, purchaseRecords: [{ recordId: "R-1", quantity: 2, unitPrice: 4, purchaseDate: "2026-06-01" }] }],
    });
    expect(validateErpBridgeResponse(response, request).rows).toHaveLength(1);
    expect(() => validateErpBridgeResponse({ ...response, query: { ...response.query, platformSkcs: [{ platformSkc: "SKC-1" }] }, summary: { ...response.summary, querySkcCount: 1 } }, request)).toThrow("集合");
  });

  it("wraps the real v8.0 legacy rows and enriches SKC only from the ledger mapping", () => {
    const request = requestFixture();
    const envelope = buildErpBridgeBatchEnvelope({
      requestPayload: request,
      expectedSkus: [{ platformSku: "SKU-1", platformSkc: "SKC-1" }],
      rows: [{
        platformSku: "SKU-1",
        warehouseSku: "WH-1",
        orderNumber: "A-100",
        orderType: "1688",
        unitCost: 4.25,
        calculationCount: 2,
        totalQuantity: 5,
        totalPrice: 21.25,
        supplier1688Url: "https://detail.1688.com/offer/730242606884.html",
        confirmed: true,
        formalCost: 99,
      }],
      generatedAt: "2026-08-07T10:00:00.000Z",
      sourceMeta: { sourceFormat: "erp-v8-legacy-text", sourceName: "clipboard.tsv" },
    });
    expect(envelope).toMatchObject({
      requestId: "ERP-REQ-1",
      sourceMeta: { sourceFormat: "erp-v8-legacy-text", sourceName: "clipboard.tsv" },
      rows: [{ platformSku: "SKU-1", platformSkc: "SKC-1", supplier1688Url: "https://detail.1688.com/offer/730242606884.html", previewUnitCost: 4.25 }],
    });
    expect(envelope.evidenceStatus).toBe("legacy_partial");
    expect(envelope.rows[0]).not.toHaveProperty("confirmed");
    expect(envelope.rows[0]).not.toHaveProperty("formalCost");
  });
});
