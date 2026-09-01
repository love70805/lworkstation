import { describe, expect, it } from "vitest";
import { buildErpCostBatchEnvelope } from "./erpCostBatchEnvelope.js";
import {
  ERP_INBOX_MESSAGE_TYPE,
  buildErpCostInboxEnvelope,
  parseErpInboxMessage,
  validateErpCostInboxEnvelope,
} from "./erpInboxContract.js";
import {
  createInvalidDirectV2Fixtures,
  createValidDirectV2Envelope,
} from "../../../tools/fixtures/erp-direct-v2-contract.mjs";

function batchFixture() {
  return buildErpCostBatchEnvelope({
    batchId: "ERP-BATCH-INBOX-1",
    workspaceId: "workspace-default",
    ledgerId: "LEDGER-1",
    requestId: "ERP-REQ-1",
    platformSkcs: ["SKC-1"],
    generatedAt: "2026-08-08T01:00:00.000Z",
    results: [{ warehouseSku: "WH-1", mappings: [{ platformSku: "SKU-1", platformSkc: "SKC-1" }], unitCost: 4.2 }],
  });
}

describe("ERP cost inbox contract", () => {
  it("builds and validates a browser delivery envelope", () => {
    const envelope = buildErpCostInboxEnvelope({ batch: batchFixture(), deliveryId: "DELIVERY-1" });
    expect(envelope).toMatchObject({ type: ERP_INBOX_MESSAGE_TYPE, deliveryId: "DELIVERY-1", batch: { batchId: "ERP-BATCH-INBOX-1" } });
    expect(validateErpCostInboxEnvelope(envelope, { expectedLedgerId: "LEDGER-1" }).rows).toHaveLength(1);
  });

  it("parses serialized messages and rejects wrong sources or scope", () => {
    const envelope = buildErpCostInboxEnvelope({ batch: batchFixture(), deliveryId: "DELIVERY-2" });
    expect(parseErpInboxMessage(JSON.stringify(envelope)).batch.requestId).toBe("ERP-REQ-1");
    expect(() => parseErpInboxMessage({ ...envelope, source: "unknown" })).toThrow("来源");
    expect(() => parseErpInboxMessage(envelope, { expectedWorkspaceId: "workspace-other" })).toThrow("工作区");
  });

  it("keeps outer v1 and inner v2 envelopes legacy_partial", () => {
    const envelope = buildErpCostInboxEnvelope({ batch: batchFixture(), deliveryId: "DELIVERY-LEGACY" });
    const parsed = validateErpCostInboxEnvelope({ ...envelope, formatVersion: 1 });
    expect(parsed.envelope).toMatchObject({
      formatVersion: 2,
      sourceFormatVersion: 1,
      batch: { sourceFormatVersion: 1, evidenceStatus: "legacy_partial" },
    });
  });

  it("does not let an outer v1 transport relax inner v2 warning validation", () => {
    const envelope = buildErpCostInboxEnvelope({ batch: batchFixture(), deliveryId: "DELIVERY-LEGACY-STRICT" });
    envelope.formatVersion = 1;
    envelope.batch.rows[0] = { ...envelope.batch.rows[0], sourceWarnings: "malformed-warning" };
    expect(() => validateErpCostInboxEnvelope(envelope)).toThrow("来源警告");
  });

  it("keeps outer v2 and inner v1 envelopes legacy_partial", () => {
    const envelope = buildErpCostInboxEnvelope({ batch: batchFixture(), deliveryId: "DELIVERY-INNER-LEGACY" });
    envelope.batch = { ...envelope.batch, formatVersion: 1 };
    const parsed = validateErpCostInboxEnvelope(envelope);
    expect(parsed.envelope).toMatchObject({
      formatVersion: 2,
      sourceFormatVersion: 1,
      batch: { formatVersion: 1, sourceFormatVersion: 1, evidenceStatus: "legacy_partial" },
    });
  });

  it("keeps pure v1 envelopes legacy_partial", () => {
    const envelope = buildErpCostInboxEnvelope({ batch: batchFixture(), deliveryId: "DELIVERY-PURE-LEGACY" });
    const parsed = validateErpCostInboxEnvelope({
      ...envelope,
      formatVersion: 1,
      batch: { ...envelope.batch, formatVersion: 1 },
    });
    expect(parsed.envelope.sourceFormatVersion).toBe(1);
    expect(parsed.batch).toMatchObject({ formatVersion: 1, sourceFormatVersion: 1, evidenceStatus: "legacy_partial" });
  });

  it("validates canonical multi-SKC direct v2 envelopes", () => {
    const parsed = validateErpCostInboxEnvelope(createValidDirectV2Envelope());
    expect(parsed.batch.query.platformSkcs.map((item) => item.canonicalPlatformSkc)).toEqual(["SKC-SHARED-A", "SKC-SHARED-B"]);
  });

  it.each(createInvalidDirectV2Fixtures())("rejects shared invalid direct v2 fixture: $id", ({ payload }) => {
    expect(() => validateErpCostInboxEnvelope(payload)).toThrow();
  });

  it("rejects an inbox whose complete SKC set differs from the expected scope", () => {
    const envelope = createValidDirectV2Envelope();
    expect(() => validateErpCostInboxEnvelope(envelope, {
      expectedWorkspaceId: "workspace-shared-direct-v2",
      expectedLedgerId: "ledger-shared-direct-v2",
      expectedRequestId: "request-shared-direct-v2",
      expectedPlatformSkcs: ["SKC-SHARED-A"],
    })).toThrow("查询 SKC 集合");
  });
});

