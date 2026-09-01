export const ERP_DIRECT_V2_BASELINE = Object.freeze({
  application: "ERP Assistant",
  version: "8.0.0",
  releaseSha256: "199561b86755b93000f3fc0197e8cd4ed5e699072a76d11d48e00c18f8e4a0ed",
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createValidDirectV2Envelope({
  deliveryId = "ERP-DELIVERY-SHARED-DIRECT-V2",
  batchId = "ERP-BATCH-SHARED-DIRECT-V2",
} = {}) {
  return {
    type: "shopeers.erp.cost.batch",
    source: "erp-assistant-v8",
    format: "shopeers-erp-cost-inbox",
    formatVersion: 2,
    deliveryId,
    sentAt: "2026-08-19T08:00:00.000Z",
    transport: "local-http",
    baseline: ERP_DIRECT_V2_BASELINE,
    batch: {
      format: "shopeers-erp-cost-batch",
      formatVersion: 2,
      batchId,
      workspaceId: "workspace-shared-direct-v2",
      ledgerId: "ledger-shared-direct-v2",
      requestId: "request-shared-direct-v2",
      generatedAt: "2026-08-19T08:00:00.000Z",
      complete: true,
      status: "completed",
      currency: "CNY",
      baseline: ERP_DIRECT_V2_BASELINE,
      algorithmVersion: "erp-v8.0-compatible@1",
      query: {
        unit: "platform_skc",
        platformSkcs: [
          { platformSkc: "SKC-SHARED-A" },
          { platformSkc: "skc-shared-b" },
          { platformSkc: "ＳＫＣ－ＳＨＡＲＥＤ－Ａ" },
        ],
      },
      summary: {
        outputRowCount: 1,
        warehouseSkuCount: 1,
        mappingFallbackCount: 0,
        querySkcCount: 2,
      },
      sourceMeta: { evidenceVersion: 1, evidenceComplete: true },
      rows: [{
        platformSku: "SKU-SHARED-DIRECT-V2",
        platformSkc: "SKC-SHARED-A",
        warehouseSku: "WH-SHARED-DIRECT-V2",
        evidenceRef: "warehouse:WH-SHARED-DIRECT-V2",
        calculationCount: 1,
        totalQuantity: 2,
        totalPrice: 8,
        previewUnitCost: 4,
        unitCost: 4,
        currency: "CNY",
        mappingFallback: false,
        sourceWarnings: [],
      }],
      warehouseEvidence: [{
        evidenceRef: "warehouse:WH-SHARED-DIRECT-V2",
        warehouseSku: "WH-SHARED-DIRECT-V2",
        evidenceComplete: true,
        sourceWarnings: [],
        purchaseRecords: [{
          recordId: "PURCHASE-SHARED-DIRECT-V2",
          warehouseSku: "WH-SHARED-DIRECT-V2",
          quantity: 2,
          unitPrice: 4,
          totalPrice: 8,
          purchaseDate: "2026-07-01",
        }],
        excludedRecords: [],
      }],
    },
  };
}

export function createInvalidDirectV2Fixtures() {
  const fixtures = [];
  const add = (id, mutate) => {
    const payload = clone(createValidDirectV2Envelope({
      deliveryId: `ERP-DELIVERY-SHARED-${id}`,
      batchId: `ERP-BATCH-SHARED-${id}`,
    }));
    mutate(payload);
    fixtures.push({ id, payload });
  };
  add("BATCH-CURRENCY", (payload) => { payload.batch.currency = "USD"; });
  add("ROW-CURRENCY", (payload) => { payload.batch.rows[0].currency = "USD"; });
  add("NEGATIVE-UNIT-COST", (payload) => {
    payload.batch.rows[0].previewUnitCost = -1;
    payload.batch.rows[0].unitCost = -1;
  });
  add("MISMATCHED-PREVIEW-COST", (payload) => {
    payload.batch.rows[0].previewUnitCost = 4;
    payload.batch.rows[0].unitCost = 5;
  });
  add("NEGATIVE-PURCHASE-UNIT-PRICE", (payload) => {
    payload.batch.warehouseEvidence[0].purchaseRecords[0].unitPrice = -1;
  });
  add("NEGATIVE-PURCHASE-QUANTITY", (payload) => {
    payload.batch.warehouseEvidence[0].purchaseRecords[0].quantity = -2;
  });
  add("NEGATIVE-PURCHASE-TOTAL-PRICE", (payload) => {
    payload.batch.warehouseEvidence[0].purchaseRecords[0].totalPrice = -1;
  });
  add("NEGATIVE-ROW-TOTAL-QUANTITY", (payload) => {
    payload.batch.rows[0].totalQuantity = -1;
  });
  add("NEGATIVE-ROW-TOTAL-PRICE", (payload) => {
    payload.batch.rows[0].totalPrice = -1;
  });
  add("NON-INTEGER-CALCULATION-COUNT", (payload) => {
    payload.batch.rows[0].calculationCount = 1.5;
  });
  add("NON-FINITE-UNIT-COST", (payload) => {
    payload.batch.rows[0].previewUnitCost = "Infinity";
    payload.batch.rows[0].unitCost = "Infinity";
  });
  add("INVALID-QUERY-ITEM", (payload) => {
    payload.batch.query.platformSkcs.push({ platformSku: "SKU-NOT-SKC" });
  });
  add("MISMATCHED-QUERY-SUMMARY", (payload) => {
    payload.batch.summary.querySkcCount = 3;
  });
  add("MISMATCHED-EVIDENCE-REF", (payload) => {
    payload.batch.rows[0].evidenceRef = "warehouse:OTHER";
  });
  add("INVALID-PURCHASE-RECORD", (payload) => {
    payload.batch.warehouseEvidence[0].purchaseRecords = ["not-a-record"];
  });
  add("UNKNOWN-OUTER-FORMAT-VERSION", (payload) => {
    payload.formatVersion = 999;
  });
  add("UNKNOWN-OUTER-SOURCE-VERSION", (payload) => {
    payload.sourceFormatVersion = 999;
  });
  add("UNKNOWN-INNER-FORMAT-VERSION", (payload) => {
    payload.batch.formatVersion = 999;
  });
  add("UNKNOWN-INNER-SOURCE-VERSION", (payload) => {
    payload.batch.sourceFormatVersion = 999;
  });
  return fixtures;
}
