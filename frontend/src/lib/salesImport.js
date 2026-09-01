import { createLedgerGroupKey, createLedgerSkuKey } from "../domain/ledgerImport";

export const salesFields = [
  { key: "store", label: "店铺", description: "未映射时使用文件名或导入时填写的店铺。", required: false, aliases: ["store", "saleschannel", "sales_channel", "shop", "店铺"] },
  { key: "supplierNumber", label: "供方货号", description: "与平台 SKC 共同组成旧利润工具的一级分组。", required: false, aliases: ["供方货号", "货号", "商家编码", "suppliernumber", "supplier_number", "merchantcode"] },
  { key: "platformSkc", label: "平台 SKC", description: "ERP v8.0 查询使用的父级标识；缺失时仅保留供方货号分组，不能用于 ERP 查询。", required: false, aliases: ["skc", "商品skc", "平台skc", "platformskc", "platform_skc"] },
  { key: "platformSku", label: "平台 SKU", description: "成本匹配和利润计算的全局唯一标识。", required: true, aliases: ["平台sku", "商家sku", "sku", "platformsku", "platform_sku", "seller_sku"] },
  { key: "attribute", label: "属性/规格", description: "与平台 SKU 共同组成利润明细分组。", required: false, aliases: ["属性集", "属性", "规格", "颜色", "attribute", "variant"] },
  { key: "movementType", label: "变动类型", description: "识别盘亏、扣款、罚款和违约记录。", required: false, aliases: ["变动类型", "movementtype", "movement_type", "type"] },
  { key: "quantity", label: "数量", description: "主数量字段；为 0 时回退到客单发货与平台客单之和。", required: false, aliases: ["数量", "件数", "购买数量", "quantity", "qty", "units", "soldquantity"] },
  { key: "unitPrice", label: "单价", description: "标准台账报表的结算单价；可与数量相乘得到销售金额。", required: false, aliases: ["单价", "unitprice", "unit_price", "price"] },
  { key: "customerShipmentQuantity", label: "客单发货", description: "数量回退字段。", required: false, aliases: ["客单发货", "customershipment", "customer_shipment"] },
  { key: "platformOrderQuantity", label: "平台客单", description: "数量回退字段。", required: false, aliases: ["平台客单", "platformorderquantity", "platform_order_quantity"] },
  { key: "amount", label: "金额", description: "主金额字段；为 0 时回退到客单金额与平台金额之和。", required: false, aliases: ["金额", "实付金额", "单据金额", "amount", "revenue", "totalrevenue", "total_revenue", "salesamount"] },
  { key: "customerAmount", label: "客单金额", description: "金额回退字段。", required: false, aliases: ["客单金额", "customeramount", "customer_amount"] },
  { key: "platformAmount", label: "平台金额", description: "金额回退字段。", required: false, aliases: ["平台金额", "platformamount", "platform_amount"] },
  { key: "orderId", label: "订单号", description: "可选，用于计算真实去重订单数。", required: false, aliases: ["orderid", "order_id", "transactionid", "transaction_id", "订单号"] },
  { key: "orderDate", label: "订单日期", description: "可选，用于来源追踪和月份核对。", required: false, aliases: ["orderdate", "order_date", "date", "transactiondate", "交易日期"] },
  { key: "order1688", label: "1688 单号", description: "兼容旧模板的来源单号，不作为 ERP 成本权威证明。", required: false, aliases: ["1688单号", "1688订单号", "order1688"] },
  { key: "directUnitCost", label: "历史单件成本", description: "兼容旧模板并保留为参考；正式利润仍以 ERP 成本或审批兜底为准。", required: false, aliases: ["单件平均成本", "单件成本", "unitcost", "unit_cost"] },
  { key: "directPenalty", label: "客退罚款", description: "存在时按旧程序行为覆盖同一 SKU 已累计的扣款。", required: false, aliases: ["客退罚款", "penalty", "deduction", "罚款"] },
];

export const LEDGER_REPORT_MOVEMENT_TYPES = ["平台客单发货", "客单发货"];
const ledgerReportHeaderAliases = {
  movementType: ["变动类型"],
  supplierNumber: ["供方货号"],
  platformSkc: ["SKC", "平台 SKC", "商品 SKC"],
  platformSku: ["平台SKU", "平台 SKU"],
  attribute: ["属性集"],
  quantity: ["数量", "计数"],
  unitPrice: ["单价"],
};

function mappedValue(row, mapping, key) {
  const header = mapping[key];
  return header ? row[header] : undefined;
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function hasValue(value) {
  return value !== null && value !== undefined && normalizedText(value) !== "";
}

function parsedNumber(row, mapping, key, fallback, issues) {
  const value = mappedValue(row, mapping, key);
  const parsed = parseNumericValue(value, fallback);
  if (!Number.isFinite(parsed)) issues.push(`${salesFields.find((field) => field.key === key)?.label ?? key}不是有效数字`);
  return parsed;
}

export function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s\-./()]+/g, "").replace(/_+/g, "_");
}

export function suggestMappings(headers) {
  const normalized = headers.map((header) => ({ header, value: normalizeHeader(header) }));
  return Object.fromEntries(salesFields.map((field) => {
    const match = normalized.find((item) => field.aliases.some((alias) => normalizeHeader(alias) === item.value));
    return [field.key, match?.header ?? ""];
  }));
}

function findHeader(headers, aliases) {
  const normalized = headers.map((header) => ({ header, value: normalizeHeader(header) }));
  return normalized.find((item) => aliases.some((alias) => normalizeHeader(alias) === item.value))?.header ?? "";
}

export function detectLedgerReport(headers = []) {
  const mapping = Object.fromEntries(Object.entries(ledgerReportHeaderAliases).map(([key, aliases]) => [key, findHeader(headers, aliases)]));
  const required = ["movementType", "supplierNumber", "platformSkc", "platformSku", "attribute", "quantity", "unitPrice"];
  return required.every((key) => Boolean(mapping[key]));
}

export function suggestLedgerReportMapping(headers = []) {
  if (!detectLedgerReport(headers)) return null;
  const mapping = suggestMappings(headers);
  for (const [key, aliases] of Object.entries(ledgerReportHeaderAliases)) mapping[key] = findHeader(headers, aliases);
  // 标准台账只把 H 列计数和 I 列单价带入利润；J 列及之后的扩展字段不参与金额映射。
  mapping.amount = "";
  mapping.customerAmount = "";
  mapping.platformAmount = "";
  mapping.directUnitCost = "";
  mapping.directPenalty = "";
  return mapping;
}

export function collectSalesImportFacets(rawRows = [], mapping = {}) {
  const supplierCounts = new Map();
  const movementTypeCounts = new Map();
  rawRows.forEach((row) => {
    const supplier = normalizedText(mappedValue(row, mapping, "supplierNumber"));
    const movementType = normalizedText(mappedValue(row, mapping, "movementType"));
    if (supplier) supplierCounts.set(supplier, (supplierCounts.get(supplier) ?? 0) + 1);
    if (movementType) movementTypeCounts.set(movementType, (movementTypeCounts.get(movementType) ?? 0) + 1);
  });
  return {
    supplierNumbers: [...supplierCounts.keys()].toSorted(),
    supplierCounts: Object.fromEntries(supplierCounts),
    movementTypes: [...movementTypeCounts.keys()].toSorted(),
    movementTypeCounts: Object.fromEntries(movementTypeCounts),
  };
}

export function validateSalesMapping(mapping, { defaultStore = "" } = {}) {
  const issues = [];
  if (!mapping.platformSku) issues.push({ key: "platformSku", message: "必须映射平台 SKU。" });
  if (!mapping.platformSkc && !mapping.supplierNumber) {
    issues.push({ key: "platformSkc", message: "平台 SKC 与供方货号至少映射一个。" });
  }
  if (!mapping.store && !normalizedText(defaultStore)) issues.push({ key: "store", message: "必须映射店铺或填写默认店铺。" });
  return issues;
}

export function parseNumericValue(value, fallback) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  if (typeof value === "number") return value;
  const source = String(value).trim();
  const negative = /^\(.*\)$/.test(source);
  const cleaned = source.replace(/[,$¥￥%\s()]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return negative ? -parsed : parsed;
}

export function validateSalesRows(rawRows, mapping, {
  defaultStore = "",
  movementTypes,
  supplierNumbers,
  deriveAmountFromUnitPrice = false,
} = {}) {
  const rows = [];
  const errors = [];
  const ignored = [];
  const mappingIssues = validateSalesMapping(mapping, { defaultStore });

  if (mappingIssues.length > 0) {
    return {
      rows,
      ignored,
      errors: mappingIssues.map((issue) => ({ sourceRow: 1, messages: [issue.message], field: issue.key })),
      sourceRowCount: rawRows.length,
    };
  }

  const movementTypeFilter = Array.isArray(movementTypes) ? new Set(movementTypes.map(normalizedText)) : null;
  const supplierFilter = Array.isArray(supplierNumbers) ? new Set(supplierNumbers.map(normalizedText)) : null;

  rawRows.forEach((rawRow, index) => {
    const sourceRow = index + 2;
    const issues = [];
    const store = normalizedText(mappedValue(rawRow, mapping, "store")) || normalizedText(defaultStore);
    const supplierNumber = normalizedText(mappedValue(rawRow, mapping, "supplierNumber"));
    const platformSkc = normalizedText(mappedValue(rawRow, mapping, "platformSkc"));
    const platformSku = normalizedText(mappedValue(rawRow, mapping, "platformSku"));
    const attribute = normalizedText(mappedValue(rawRow, mapping, "attribute"));
    const movementType = normalizedText(mappedValue(rawRow, mapping, "movementType"));
    const groupSkc = platformSkc || supplierNumber;

    if (movementTypeFilter && !movementTypeFilter.has(movementType)) {
      ignored.push({ sourceRow, reason: "movement_type_filtered", value: movementType });
      return;
    }
    if (supplierFilter && !supplierFilter.has(supplierNumber)) {
      ignored.push({ sourceRow, reason: "supplier_filtered", value: supplierNumber });
      return;
    }

    if (!store) issues.push("店铺不能为空");
    if (!groupSkc) issues.push("平台 SKC 与供方货号不能同时为空");
    if (!platformSku) issues.push("平台 SKU 不能为空");

    if (movementType.includes("盘亏")) {
      ignored.push({ sourceRow, reason: "inventory_loss" });
      return;
    }

    let quantity = parsedNumber(rawRow, mapping, "quantity", 0, issues);
    if (quantity === 0) {
      quantity = parsedNumber(rawRow, mapping, "customerShipmentQuantity", 0, issues)
        + parsedNumber(rawRow, mapping, "platformOrderQuantity", 0, issues);
    }

    const unitPriceRaw = mappedValue(rawRow, mapping, "unitPrice");
    const hasUnitPrice = hasValue(unitPriceRaw);
    const unitPrice = hasUnitPrice ? parseNumericValue(unitPriceRaw, Number.NaN) : null;
    if (hasUnitPrice && (!Number.isFinite(unitPrice) || unitPrice < 0)) issues.push("单价必须大于或等于 0");

    let amount = deriveAmountFromUnitPrice && hasUnitPrice
      ? quantity * unitPrice
      : parsedNumber(rawRow, mapping, "amount", 0, issues);
    if (!deriveAmountFromUnitPrice && amount === 0) {
      amount = parsedNumber(rawRow, mapping, "customerAmount", 0, issues)
        + parsedNumber(rawRow, mapping, "platformAmount", 0, issues);
    }

    if (quantity === 0 && amount === 0) {
      ignored.push({ sourceRow, reason: "zero_quantity_and_amount" });
      return;
    }

    const directUnitCostRaw = mappedValue(rawRow, mapping, "directUnitCost");
    const directPenaltyRaw = mappedValue(rawRow, mapping, "directPenalty");
    const hasDirectUnitCost = hasValue(directUnitCostRaw);
    const hasDirectPenalty = hasValue(directPenaltyRaw);
    const directUnitCost = hasDirectUnitCost ? parseNumericValue(directUnitCostRaw, Number.NaN) : null;
    const directPenalty = hasDirectPenalty ? parseNumericValue(directPenaltyRaw, Number.NaN) : null;

    if (hasDirectUnitCost && (!Number.isFinite(directUnitCost) || directUnitCost <= 0)) issues.push("历史单件成本必须大于 0");
    if (hasDirectPenalty && (!Number.isFinite(directPenalty) || directPenalty < 0)) issues.push("客退罚款必须大于或等于 0");

    if (issues.length > 0) {
      errors.push({ sourceRow, messages: [...new Set(issues)] });
      return;
    }

    const isDeduction = ["扣款", "罚款", "违约"].some((keyword) => movementType.includes(keyword));
    const normalizedRow = {
      orderId: normalizedText(mappedValue(rawRow, mapping, "orderId")),
      orderDate: normalizedText(mappedValue(rawRow, mapping, "orderDate")),
      store,
      supplierNumber,
      platformSkc,
      groupSkc,
      platformSku,
      sku: platformSku,
      attribute,
      movementType,
      quantity: isDeduction ? 0 : quantity,
      amount: isDeduction ? 0 : amount,
      unitPrice,
      isDeduction,
      deductionAmount: isDeduction ? Math.abs(amount) : 0,
      penalty: hasDirectPenalty ? directPenalty : isDeduction ? Math.abs(amount) : 0,
      order1688: normalizedText(mappedValue(rawRow, mapping, "order1688")),
      hasDirectUnitCost,
      directUnitCost,
      hasDirectPenalty,
      directPenalty,
      sourceRow,
    };
    normalizedRow.groupKey = createLedgerGroupKey(normalizedRow);
    normalizedRow.skuKey = createLedgerSkuKey(normalizedRow);
    rows.push(normalizedRow);
  });

  return {
    rows,
    errors,
    ignored,
    sourceRowCount: rawRows.length,
    platformSkcMissingCount: rows.filter((row) => !row.platformSkc).length,
  };
}
