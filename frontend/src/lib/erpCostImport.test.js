import { describe, expect, it } from "vitest";
import { buildErpCostTemplate, parseErpCostInput, parseErpCostText } from "./erpCostImport";
import { buildErpCostBatchEnvelope } from "../domain/erpCostBatchEnvelope";
import { buildErpCostInboxEnvelope } from "../domain/erpInboxContract";
import { buildErpCostRequest } from "../domain/erpCosts";
import { createValidDirectV2Envelope } from "../../../tools/fixtures/erp-direct-v2-contract.mjs";

describe("ERP cost import", () => {
  it("parses the v8.0 clipboard TSV contract", () => {
    const result = parseErpCostText([
      "平台SKU\t仓库SKU\t1688单号\t单件平均成本",
      "SKU-1\tWH-1\tA-100\t4.25",
      "SKU-2\tWH-2\tP-200\t¥5.20",
    ].join("\n"));

    expect(result.rows).toEqual([
      expect.objectContaining({ platformSku: "SKU-1", warehouseSku: "WH-1", orderNumber: "A-100", unitCost: 4.25, sourceRow: 2 }),
      expect.objectContaining({ platformSku: "SKU-2", warehouseSku: "WH-2", orderNumber: "P-200", unitCost: 5.2, sourceRow: 3 }),
    ]);
  });

  it("requires the cost column and emits the canonical template", () => {
    expect(() => parseErpCostText("平台SKU\t仓库SKU\nSKU-1\tWH-1")).toThrow("单件平均成本");
    expect(buildErpCostTemplate()).toBe("平台SKU\t平台SKC\t仓库SKU\t1688单号\t单件平均成本\t供应商1688链接\n");
  });

  it("ignores extension confirmation and manual correction columns", () => {
    const result = parseErpCostText([
      "平台SKU\t仓库SKU\t单件平均成本\t成本异常\t异常原因\t人工确认\t异常审计JSON",
      "SKU-1\tWH-1\t2\t1\t采购单价为 1\t是\t[]",
    ].join("\n"));
    expect(result.rows[0]).not.toHaveProperty("anomalyConfirmed");
    expect(result.rows[0]).not.toHaveProperty("anomalyRecords");
  });

  it("preserves the richer v8.0 CSV evidence columns", () => {
    const result = parseErpCostText([
      "仓库SKU,平台SKU,平台SKC,单号类型,1688单号,产品名称,供应商,供应商1688链接,核算次数,核算日期范围,总采购量,总采购价(￥),单件平均成本",
      "WH-1,SKU-1,SKC-1,1688,A-100,测试商品,义乌市鑫颉日用品有限公司,https://detail.1688.com/offer/730242606884.html,2,2026-06-01 ~ 2026-07-01,5,31.00,6.2000",
    ].join("\n"));

    expect(result.rows[0]).toMatchObject({
      platformSku: "SKU-1",
      platformSkc: "SKC-1",
      warehouseSku: "WH-1",
      orderType: "1688",
      productName: "测试商品",
      calculationCount: 2,
      dateRange: "2026-06-01 ~ 2026-07-01",
      totalQuantity: 5,
      totalPrice: 31,
      supplierName: "义乌市鑫颉日用品有限公司",
      supplier1688Url: "https://detail.1688.com/offer/730242606884.html",
      unitCost: 6.2,
    });
  });

  it("detects and validates a versioned JSON cost batch", () => {
    const envelope = buildErpCostBatchEnvelope({
      batchId: "ERP-BATCH-1",
      workspaceId: "workspace-default",
      ledgerId: "LEDGER-1",
      requestId: "ERP-REQ-1",
      platformSkcs: ["SKC-1"],
      generatedAt: "2026-08-07T08:00:00.000Z",
      results: [{
        warehouseSku: "WH-1",
        mappings: [{ platformSku: "SKU-1" }],
        orderNumber: "A-100",
        sourceType: "1688",
        calcTimes: 1,
        totalQty: 2,
        totalPrice: 8,
        unitCost: 4,
      }],
      warehouseEvidence: [{ warehouseSku: "WH-1", evidenceComplete: true, purchaseRecords: [{ recordId: "R-1", quantity: 2, unitPrice: 4, purchaseDate: "2026-06-01" }] }],
    });

    const result = parseErpCostInput(JSON.stringify(envelope), {
      expectedWorkspaceId: "workspace-default",
      expectedLedgerId: "LEDGER-1",
      expectedRequestId: "ERP-REQ-1",
    });
    expect(result.kind).toBe("batch");
    expect(result.envelope.batchId).toBe("ERP-BATCH-1");
    expect(result.rows[0]).toMatchObject({ platformSku: "SKU-1", previewUnitCost: 4 });
  });

  it("detects and validates a complete inbox envelope without losing transport legacy semantics", () => {
    const batch = buildErpCostBatchEnvelope({
      batchId: "ERP-BATCH-INBOX-IMPORT",
      workspaceId: "workspace-default",
      ledgerId: "LEDGER-1",
      requestId: "ERP-REQ-1",
      platformSkcs: ["SKC-1"],
      generatedAt: "2026-08-07T08:00:00.000Z",
      results: [{ warehouseSku: "WH-1", mappings: [{ platformSku: "SKU-1", platformSkc: "SKC-1" }], unitCost: 4 }],
      warehouseEvidence: [{ warehouseSku: "WH-1", evidenceComplete: true, purchaseRecords: [{ recordId: "R-1", quantity: 1, unitPrice: 4, purchaseDate: "2026-07-01" }] }],
    });
    const inbox = buildErpCostInboxEnvelope({ batch, deliveryId: "DELIVERY-INBOX-IMPORT" });
    const current = parseErpCostInput(JSON.stringify(inbox), {
      expectedWorkspaceId: "workspace-default",
      expectedLedgerId: "LEDGER-1",
      expectedRequestId: "ERP-REQ-1",
      expectedPlatformSkcs: ["SKC-1"],
    });
    expect(current.kind).toBe("batch");
    expect(current.envelope).toMatchObject({ batchId: "ERP-BATCH-INBOX-IMPORT", evidenceStatus: "complete" });

    const legacy = parseErpCostInput(JSON.stringify({ ...inbox, formatVersion: 1 }), {
      expectedWorkspaceId: "workspace-default",
      expectedLedgerId: "LEDGER-1",
      expectedRequestId: "ERP-REQ-1",
      expectedPlatformSkcs: ["SKC-1"],
    });
    expect(legacy.envelope).toMatchObject({ sourceFormatVersion: 1, evidenceStatus: "legacy_partial" });
  });

  it("passes the expected complete SKC set through the inbox import path", () => {
    expect(() => parseErpCostInput(JSON.stringify(createValidDirectV2Envelope()), {
      expectedWorkspaceId: "workspace-shared-direct-v2",
      expectedLedgerId: "ledger-shared-direct-v2",
      expectedRequestId: "request-shared-direct-v2",
      expectedPlatformSkcs: ["SKC-SHARED-A"],
    })).toThrow("查询 SKC 集合");
  });

  it("wraps the actual v8.0 clipboard output when a request and SKU/SKC mapping are present", () => {
    const request = buildErpCostRequest({
      id: "ERP-REQ-LEGACY",
      workspaceId: "workspace-default",
      ledgerId: "LEDGER-1",
      platformSkcs: ["SKC-1"],
      requestedBy: "local-user",
      requestedAt: "2026-08-07T08:00:00.000Z",
    });
    const result = parseErpCostInput([
      "平台SKU\t仓库SKU\t1688单号\t单件平均成本",
      "SKU-1\tWH-1\tA-100\t4.25",
    ].join("\n"), {
      requestPayload: request,
      expectedSkus: [{ platformSku: "SKU-1", platformSkc: "SKC-1" }],
      sourceName: "clipboard.tsv",
    });
    expect(result.kind).toBe("legacy_batch");
    expect(result.envelope).toMatchObject({
      requestId: "ERP-REQ-LEGACY",
      sourceMeta: { sourceFormat: "erp-v8-legacy-text", sourceName: "clipboard.tsv" },
      rows: [{ platformSku: "SKU-1", platformSkc: "SKC-1", previewUnitCost: 4.25 }],
    });
    expect(result.envelope.evidenceStatus).toBe("legacy_partial");
  });
});
