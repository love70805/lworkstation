import { describe, expect, it } from "vitest";
import { LEDGER_REPORT_MOVEMENT_TYPES, collectSalesImportFacets, detectLedgerReport, suggestLedgerReportMapping, suggestMappings, validateSalesMapping, validateSalesRows } from "./salesImport";
import { summarizeLedgerRows } from "../domain/ledgerImport";

const standardHeaders = ["变动类型", "结算类型", "供方货号", "SKC", "平台SKU", "商家SKU", "属性集", "数量", "单价", "金额", "币种", "业务单号", "单据号", "添加时间", "商家ID", "商家名称", "销售商家ID", "销售商家名称", "备注", "活动信息"];

describe("sales import mapping", () => {
  it("keeps mapped blank movement rows selectable without inventing a type for templates without that column", () => {
    const rows = [{ 类型: '客单发货' }, { 类型: '' }];
    const facets = collectSalesImportFacets(rows, { movementType: '类型' });
    expect(facets.movementTypes).toEqual(['', '客单发货']);
    expect(facets.movementTypeCounts).toEqual({ '': 1, 客单发货: 1 });
    expect(collectSalesImportFacets(rows, {}).movementTypes).toEqual([]);
  });

  it("includes POP sign-off with either parenthesis width in the default ledger scope", () => {
    const mapping = suggestLedgerReportMapping(standardHeaders);
    const rows = [
      { 变动类型: '客单发货', 数量: '1', 单价: '2.5' },
      { 变动类型: '平台客单发货', 数量: '2', 单价: '3' },
      { 变动类型: '客单签收（POP）', 数量: '3', 单价: '4.125' },
      { 变动类型: '客单签收(POP)', 数量: '1', 单价: '5' },
      { 变动类型: '盘亏', 数量: '1', 单价: '6' },
      { 变动类型: '平台扣款', 数量: '1', 单价: '7' },
    ].map((row, index) => ({ ...row, 供方货号: 'SUP', SKC: 'SKC', 平台SKU: `SKU-${index}`, 属性集: '红', 金额: '999' }));
    const facets = collectSalesImportFacets(rows, mapping);
    expect(facets.movementTypeCounts['客单签收(POP)']).toBe(2);
    const options = { defaultStore: '27店', movementTypes: LEDGER_REPORT_MOVEMENT_TYPES.filter(type => facets.movementTypes.includes(type)), deriveAmountFromUnitPrice: true };
    const result = validateSalesRows(rows, mapping, options);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map(row => row.amountExact)).toEqual(['2.5', '6', '12.375', '5']);
    expect(result.ignored).toHaveLength(2);
    const popOnly = validateSalesRows(rows, mapping, { ...options, movementTypes: ['客单签收(POP)'] });
    expect(popOnly.rows.map(row => row.platformSku)).toEqual(['SKU-2', 'SKU-3']);
    expect(validateSalesRows(rows, mapping, { ...options, movementTypes: [] }).rows).toEqual([]);
  });

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

  it("recognizes the full standard headers without treating settlement amounts or legacy costs as revenue", () => {
    const mapping = suggestLedgerReportMapping([...standardHeaders, "单件成本", "客退罚款"]);
    expect(mapping).toMatchObject({
      platformSku: "平台SKU", quantity: "数量", unitPrice: "单价", sourceAddedAt: "添加时间", activity: "活动信息",
      orderId: "业务单号", orderDate: "", store: "", amount: "", customerAmount: "", platformAmount: "", directUnitCost: "", directPenalty: "",
    });
    const base = { 供方货号: "货号A", SKC: "父A", 平台SKU: "000123", 属性集: "白色", 单价: 10, 添加时间: "2026-08-01 09:00:00", 业务单号: "同一订单", 单件成本: 999, 客退罚款: 99 };
    const validation = validateSalesRows([
      { ...base, 变动类型: "平台客单发货", 数量: 2, 金额: 9999, 单据号: "发货单1" },
      { ...base, 变动类型: "客单发货", 数量: 1, 金额: 8888, 单据号: "发货单2" },
      { ...base, 变动类型: "客退", 数量: -1, 金额: -7777, 单据号: "退货单" },
      { ...base, 变动类型: "平台罚款", 数量: 1, 金额: -6666, 单据号: "罚款单" },
    ], mapping, { defaultStore: "测试店", movementTypes: ["平台客单发货", "客单发货"], deriveAmountFromUnitPrice: true, period: "2026-08" });
    expect(validation.errors).toEqual([]);
    expect(validation.sourceRowCount).toBe(4);
    expect(validation.rows).toHaveLength(2);
    expect(validation.ignored).toHaveLength(2);
    expect(validation.rows.every(row => !row.hasDirectUnitCost && !row.hasDirectPenalty)).toBe(true);
    expect(summarizeLedgerRows(validation.rows)).toMatchObject({ quantity: 3, revenue: 30, penalty: 0, sourceRowCount: 2, realOrderCount: 1 });
  });

  it("prefers explicit platform and order identifiers and keeps document numbers and source dates separate", () => {
    expect(suggestMappings(["商家SKU", "平台SKU", "业务单号", "订单号", "订单日期", "添加时间", "单据号"])).toMatchObject({
      platformSku: "平台SKU", orderId: "订单号", orderDate: "订单日期", sourceAddedAt: "添加时间",
    });
    expect(suggestMappings(["单据号", "添加时间"])).toMatchObject({ orderId: "", orderDate: "", sourceAddedAt: "添加时间" });
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

it('preserves full Beijing business timestamps including Excel fractions independently of import order', () => {
  const mapping = {platformSku:'SKU',platformSkc:'SKC',quantity:'数量',unitPrice:'单价',sourceAddedAt:'添加时间'};
  const result = validateSalesRows([
    {SKU:'001',SKC:'父',数量:1,单价:2,添加时间:46235.75},
    {SKU:'001',SKC:'父',数量:1,单价:3,添加时间:'2026-08-01 18:00:00.123'},
    {SKU:'001',SKC:'父',数量:1,单价:4,添加时间:'2026-08-01T10:00:00.123Z'},
  ], mapping, {defaultStore:'甲',deriveAmountFromUnitPrice:true,period:'2026-08'});
  expect(result.rows.map(row=>row.sourceAddedAt)).toEqual(['2026-08-01T18:00:00.000+08:00','2026-08-01T18:00:00.123+08:00','2026-08-01T18:00:00.123+08:00']);
  expect(result.rows[1].sourceAddedTimestamp).toBe(result.rows[2].sourceAddedTimestamp);
  expect(result.rows[0].sourceTimePrecision).toBe('second');
});
