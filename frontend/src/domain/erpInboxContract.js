import { ERP_V8_BASELINE, validateErpCostBatchEnvelope } from "./erpCostBatchEnvelope.js";

export const ERP_INBOX_MESSAGE_TYPE = "shopeers.erp.cost.batch";
export const ERP_INBOX_SOURCE = "erp-assistant-v8";
export const ERP_INBOX_FORMAT = "shopeers-erp-cost-inbox";
export const ERP_INBOX_VERSION = 2;
export const ERP_INBOX_LEGACY_VERSION = 1;

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function validTimestamp(value, label) {
  const text = requiredText(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label}不是有效时间。`);
  return text;
}

function makeDeliveryId() {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `ERP-DELIVERY-${random}`;
}

export function buildErpCostInboxEnvelope({
  batch,
  deliveryId = makeDeliveryId(),
  sentAt = new Date().toISOString(),
  transport = "browser-message",
} = {}) {
  const validated = validateErpCostBatchEnvelope(batch).envelope;
  return validateErpCostInboxEnvelope({
    type: ERP_INBOX_MESSAGE_TYPE,
    source: ERP_INBOX_SOURCE,
    format: ERP_INBOX_FORMAT,
    formatVersion: ERP_INBOX_VERSION,
    deliveryId,
    sentAt,
    transport,
    baseline: ERP_V8_BASELINE,
    batch: validated,
  }).envelope;
}

export function validateErpCostInboxEnvelope(payload, {
  expectedWorkspaceId = null,
  expectedLedgerId = null,
  expectedRequestId = null,
  expectedPlatformSkcs = null,
  expectedSkus = null,
} = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("ERP 收件包内容无效。");
  if (payload.type !== ERP_INBOX_MESSAGE_TYPE || payload.source !== ERP_INBOX_SOURCE) throw new Error("ERP 收件包来源不受支持。");
  const formatVersion = Number(payload.formatVersion);
  const declaredSourceFormatVersion = payload.sourceFormatVersion == null
    ? formatVersion
    : Number(payload.sourceFormatVersion);
  if (payload.format !== ERP_INBOX_FORMAT
    || ![ERP_INBOX_LEGACY_VERSION, ERP_INBOX_VERSION].includes(formatVersion)
    || ![ERP_INBOX_LEGACY_VERSION, ERP_INBOX_VERSION].includes(declaredSourceFormatVersion)) {
    throw new Error("ERP 收件包版本不受支持。");
  }
  const deliveryId = requiredText(payload.deliveryId, "ERP 收件投递 ID");
  const sentAt = validTimestamp(payload.sentAt, "ERP 收件时间");
  const transport = requiredText(payload.transport ?? "browser-message", "ERP 收件传输方式");
  const baseline = payload.baseline ?? {};
  if (baseline.application !== ERP_V8_BASELINE.application
    || baseline.version !== ERP_V8_BASELINE.version
    || String(baseline.releaseSha256 ?? "").toLowerCase() !== ERP_V8_BASELINE.releaseSha256) {
    throw new Error("ERP 收件包未声明受支持的 ERP Assistant v8.0.0 权威基线。");
  }
  const innerFormatVersion = Number(payload.batch?.formatVersion);
  const innerSourceFormatVersion = payload.batch?.sourceFormatVersion == null
    ? innerFormatVersion
    : Number(payload.batch.sourceFormatVersion);
  if (![ERP_INBOX_LEGACY_VERSION, ERP_INBOX_VERSION].includes(innerFormatVersion)
    || ![ERP_INBOX_LEGACY_VERSION, ERP_INBOX_VERSION].includes(innerSourceFormatVersion)) {
    throw new Error("ERP 收件包内层成本批次版本不受支持。");
  }
  const sourceFormatVersion = [formatVersion, declaredSourceFormatVersion, innerFormatVersion, innerSourceFormatVersion].includes(ERP_INBOX_LEGACY_VERSION)
    ? ERP_INBOX_LEGACY_VERSION
    : ERP_INBOX_VERSION;
  const batchResult = validateErpCostBatchEnvelope({
    ...payload.batch,
    sourceFormatVersion,
  }, {
    expectedWorkspaceId,
    expectedLedgerId,
    expectedRequestId,
    expectedPlatformSkcs,
    expectedSkus,
  });
  return {
    envelope: {
      type: ERP_INBOX_MESSAGE_TYPE,
      source: ERP_INBOX_SOURCE,
      format: ERP_INBOX_FORMAT,
      formatVersion: ERP_INBOX_VERSION,
      sourceFormatVersion,
      deliveryId,
      sentAt,
      transport,
      baseline: ERP_V8_BASELINE,
      batch: batchResult.envelope,
    },
    deliveryId,
    batch: batchResult.envelope,
    rows: batchResult.rows,
  };
}

export function parseErpInboxMessage(message, options = {}) {
  let payload = message;
  if (typeof message === "string") {
    try { payload = JSON.parse(message); } catch { throw new Error("ERP 收件消息 JSON 无法解析。"); }
  }
  if (payload?.type !== ERP_INBOX_MESSAGE_TYPE) throw new Error("不是 Shopeers ERP 成本收件消息。");
  return validateErpCostInboxEnvelope(payload, options);
}

