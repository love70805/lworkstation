import { describe, expect, it } from "vitest";
import { collectSalesImportFacets, detectLedgerReport, suggestLedgerReportMapping, suggestMappings, validateSalesMapping, validateSalesRows } from "./salesImport";

describe("sales import mapping", () => {
  it("suggests legacy and modern field mappings", () => {
    expect(suggestMappings(["店铺", "供方货号", "商品SKC", "商家SKU", "属性集", "变动类型", "客单发货", "平台客单", "客单金额", "平台金额"])).toMatchObject({
      store: "店铺",
      supplierNumber: "供方货号",
      platformSkc: "商品SKC",
      platformSku: "商家SKU",
      attribute: "属性集",
      movementType: "变动类型",
      customerShipmentQuantity: "客单发货",
      platformOrderQuantity: "平台客单",
      customerAmount: "客单金额",
      platformAmount: "平台金额",
    });
  });

  it("accepts a default store and either SKC or supplier number", () => {
    expect(validateSalesMapping({ platformSku: "SKU", supplierNumber: "货号" }, { defaultStore: "美国店" })).toEqual([]);
    expect(validateSalesMapping({ platformSku: "SKU" }, { defaultStore: "美国店" })).toEqual([
      expect.objectContaining({ key: "platformSkc" }),
    ]);
  });

  it("recognizes the standard ledger report and maps only its core columns", () => {
    const headers = ["变动类型", "结算类型", "供方货号", "SKC", "平台SKU", "商家SKU", "属性集", "数量", "单价", "金额", "备注"];
    expect(detectLedgerReport(headers)).toBe(true);
    expect(suggestLedgerReportMapping(headers)).toMatchObject({
      movementType: "变动类型",
      supplierNumber: "供方货号",
      platformSkc: "SKC",
      platformSku: "平台SKU",
      attribute: "属性集",
      quantity: "数量",
      unitPrice: "单价",
      amount: "",
    });
  });
});

describe("sales import row compatibility", () => {
  const mapping = {
    supplierNumber: "供方货号",
    platformSkc: "SKC",
    platformSku: "平台SKU",
    attribute: "属性",
    movementType: "变动类型",
    quantity: "数量",
    customerShipmentQuantity: "客单发货",
    platformOrderQuantity: "平台客单",
    amount: "金额",
    customerAmount: "客单金额",
    platformAmount: "平台金额",
    orderId: "订单号",
    directPenalty: "客退罚款",
  };

  it("uses fallback quantity and amount fields and keeps source traceability", () => {
    const result = validateSalesRows([{
      供方货号: "SUP-1",
      SKC: "SKC-1",
      平台SKU: "sku-1",
      属性: "黑色",
      数量: "0",
      客单发货: "2",
      平台客单: "1",
      金额: "0",
      客单金额: "10.10",
      平台金额: "5.20",
      订单号: "A-1",
    }], mapping, { defaultStore: "美国店" });

    expect(result.rows[0]).toMatchObject({
      store: "美国店",
      platformSkc: "SKC-1",
      platformSku: "sku-1",
      quantity: 3,
      amount: 15.3,
      sourceRow: 2,
    });
    expect(result.errors).toEqual([]);
  });

  it("excludes inventory loss, skips empty activity, and isolates deduction rows", () => {
    const result = validateSalesRows([
      { 供方货号: "SUP-1", 平台SKU: "SKU-1", 变动类型: "盘亏", 数量: "2", 金额: "10" },
      { 供方货号: "SUP-1", 平台SKU: "SKU-1", 数量: "0", 金额: "0" },
      { 供方货号: "SUP-1", 平台SKU: "SKU-1", 变动类型: "平台扣款", 数量: "2", 金额: "-12.50" },
    ], mapping, { defaultStore: "美国店" });

    expect(result.ignored).toEqual([
      { sourceRow: 2, reason: "inventory_loss" },
      { sourceRow: 3, reason: "zero_quantity_and_amount" },
    ]);
    expect(result.rows[0]).toMatchObject({
      isDeduction: true,
      quantity: 0,
      amount: 0,
      deductionAmount: 12.5,
    });
  });

  it("filters standard ledger movement types and suppliers, deriving revenue from quantity times unit price", () => {
    const mapping = {
      supplierNumber: "供方货号",
      platformSkc: "SKC",
      platformSku: "平台SKU",
      attribute: "属性集",
      movementType: "变动类型",
      quantity: "数量",
      unitPrice: "单价",
    };
    const result = validateSalesRows([
      { 供方货号: "YW-A", SKC: "SKC-A", 平台SKU: "SKU-A", 属性集: "红", 变动类型: "平台客单发货", 数量: "2", 单价: "6.4" },
      { 供方货号: "YW-B", SKC: "SKC-B", 平台SKU: "SKU-B", 属性集: "蓝", 变动类型: "客单发货", 数量: "1", 单价: "8" },
      { 供方货号: "YW-A", SKC: "SKC-A", 平台SKU: "SKU-C", 属性集: "黑", 变动类型: "退款", 数量: "1", 单价: "9" },
    ], mapping, {
      defaultStore: "680店",
      movementTypes: ["平台客单发货", "客单发货"],
      supplierNumbers: ["YW-A"],
      deriveAmountFromUnitPrice: true,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ supplierNumber: "YW-A", quantity: 2, unitPrice: 6.4, amount: 12.8 });
    expect(result.ignored).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "supplier_filtered" }),
      expect.objectContaining({ reason: "movement_type_filtered" }),
    ]));
    expect(collectSalesImportFacets([
      { 供方货号: "YW-A", 变动类型: "平台客单发货" },
      { 供方货号: "YW-B", 变动类型: "客单发货" },
    ], mapping)).toMatchObject({ supplierNumbers: ["YW-A", "YW-B"], movementTypes: expect.arrayContaining(["平台客单发货", "客单发货"]) });
  });
});
