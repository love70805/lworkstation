import Papa from "papaparse";
import { parseErpCostBatchJson } from "../domain/erpCostBatchEnvelope";
import { ERP_INBOX_FORMAT, ERP_INBOX_MESSAGE_TYPE, parseErpInboxMessage } from "../domain/erpInboxContract";
import { buildErpBridgeBatchEnvelope } from "../domain/erpBridgeContract";
import { normalizeHeader, parseNumericValue } from "./salesImport";

const fields = {
  platformSku: ["平台sku", "平台 SKU", "platformsku", "platform_sku", "sku"],
  warehouseSku: ["仓库sku", "仓库 SKU", "warehousesku", "warehouse_sku", "产品sku"],
  orderNumber: ["1688单号", "1688订单号", "采购单号", "订单号", "ordernumber", "order_number"],
  orderType: ["单号类型", "来源类型", "ordertype", "order_type", "sourcetype"],
  unitCost: ["单件平均成本", "单件成本", "unitcost", "unit_cost", "cost"],
  platformSkc: ["平台skc", "skc", "商品skc", "platformskc", "platform_skc"],
  productName: ["产品名称", "商品名称", "productname", "product_name", "name"],
  calculationCount: ["核算次数", "计算次数", "calctimes", "calculationcount", "calculation_count"],
  dateRange: ["核算日期范围", "日期范围", "daterange", "date_range"],
  totalQuantity: ["总采购量", "采购总量", "totalqty", "totalquantity", "total_quantity"],
  totalPrice: ["总采购价(￥)", "总采购价", "采购总价", "totalprice", "total_price"],
  supplierName: ["供应商", "供应商名称", "supplier", "suppliername", "supplier_name"],
  supplier1688Url: ["供应商1688链接", "1688采购链接", "1688来源链接", "supplier1688url", "supplier_offer_url", "sourceurl", "source_url"],
  mappingFallback: ["映射兜底", "mappingfallback", "mapping_fallback"],
};

function findHeader(headers, aliases) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return headers.find((header) => normalizedAliases.has(normalizeHeader(header))) ?? null;
}

export function suggestErpCostMappings(headers) {
  return Object.fromEntries(Object.entries(fields).map(([key, aliases]) => [key, findHeader(headers, aliases)]));
}

function optionalNumericValue(value) {
  const parsed = parseNumericValue(value, null);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value) {
  const normalized = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  return ["1", "true", "yes", "y", "是", "兜底"].includes(normalized);
}

export function parseErpCostText(text) {
  const source = String(text ?? "").trim();
  if (!source) throw new Error("请先粘贴或上传 ERP 成本数据。");

  const parsed = Papa.parse(source, {
    header: true,
    skipEmptyLines: "greedy",
    delimiter: "",
    transformHeader: (header) => header.trim(),
  });
  const fatalError = parsed.errors.find((error) => error.type === "Quotes" || error.type === "Delimiter");
  if (fatalError) throw new Error(`成本文件解析失败：${fatalError.message}`);

  const headers = parsed.meta.fields ?? [];
  const mapping = suggestErpCostMappings(headers);
  if (!mapping.unitCost) throw new Error("成本数据缺少“单件平均成本”列。");
  if (!mapping.platformSku && !mapping.warehouseSku) throw new Error("成本数据至少需要平台 SKU 或仓库 SKU 列。");

  const rows = parsed.data.map((row, index) => ({
    platformSku: mapping.platformSku ? String(row[mapping.platformSku] ?? "").trim() : "",
    warehouseSku: mapping.warehouseSku ? String(row[mapping.warehouseSku] ?? "").trim() : "",
    orderNumber: mapping.orderNumber ? String(row[mapping.orderNumber] ?? "").trim() : "",
    orderType: mapping.orderType ? String(row[mapping.orderType] ?? "").trim() : "",
    unitCost: parseNumericValue(row[mapping.unitCost], Number.NaN),
    platformSkc: mapping.platformSkc ? String(row[mapping.platformSkc] ?? "").trim() : "",
    productName: mapping.productName ? String(row[mapping.productName] ?? "").trim() : "",
    calculationCount: mapping.calculationCount ? optionalNumericValue(row[mapping.calculationCount]) : null,
    dateRange: mapping.dateRange ? String(row[mapping.dateRange] ?? "").trim() : "",
    totalQuantity: mapping.totalQuantity ? optionalNumericValue(row[mapping.totalQuantity]) : null,
    totalPrice: mapping.totalPrice ? optionalNumericValue(row[mapping.totalPrice]) : null,
    supplierName: mapping.supplierName ? String(row[mapping.supplierName] ?? "").trim() : "",
    supplier1688Url: mapping.supplier1688Url ? String(row[mapping.supplier1688Url] ?? "").trim() : "",
    mappingFallback: mapping.mappingFallback ? booleanValue(row[mapping.mappingFallback]) : false,
    currency: "CNY",
    sourceRow: index + 2,
    raw: row,
  }));

  return { headers, mapping, rows };
}

export function parseErpCostInput(text, options = {}) {
  const source = String(text ?? "").trim();
  if (!source) throw new Error("请先粘贴或上传 ERP 成本数据。");
  if (source.startsWith("{")) {
    let payload;
    try { payload = JSON.parse(source); } catch { throw new Error("ERP 成本批次 JSON 无法解析。"); }
    if (payload?.format === ERP_INBOX_FORMAT || payload?.type === ERP_INBOX_MESSAGE_TYPE) {
      const result = parseErpInboxMessage(payload, options);
      return {
        kind: "batch",
        envelope: result.batch,
        transportEnvelope: result.envelope,
        rows: result.rows,
        headers: [],
        mapping: null,
      };
    }
    const result = parseErpCostBatchJson(source, options);
    return {
      kind: "batch",
      envelope: result.envelope,
      rows: result.rows,
      headers: [],
      mapping: null,
    };
  }
  const parsed = parseErpCostText(source);
  if (options.requestPayload && Array.isArray(options.expectedSkus) && options.expectedSkus.length > 0) {
    const envelope = buildErpBridgeBatchEnvelope({
      requestPayload: options.requestPayload,
      rows: parsed.rows,
      expectedSkus: options.expectedSkus,
      sourceMeta: {
        sourceFormat: "erp-v8-legacy-text",
        sourceName: options.sourceName,
      },
    });
    return {
      kind: "legacy_batch",
      envelope,
      rows: envelope.rows,
      headers: parsed.headers,
      mapping: parsed.mapping,
    };
  }
  return {
    kind: "text",
    envelope: null,
    ...parsed,
  };
}

export function buildErpCostTemplate() {
  return "平台SKU\t平台SKC\t仓库SKU\t1688单号\t单件平均成本\t供应商1688链接\n";
}
