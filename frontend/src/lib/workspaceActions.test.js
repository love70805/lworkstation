import { describe, expect, it } from "vitest";
import { resolveWorkspacePrimaryAction } from "./workspaceActions";

const ledger = { id: "ledger-2026-08", period: "2026-08" };

describe("工作区首页快捷入口", () => {
  it("选中账本成本齐全时沿用月份和店铺查看利润", () => {
    expect(resolveWorkspacePrimaryAction({ selectedLedger: ledger, query: "ledger=other&store=A" })).toMatchObject({
      kind: "profit",
      path: "/profit?ledger=ledger-2026-08&store=A",
    });
  });

  it("本月缺成本的处理入口不会被店铺或商品筛选遮住", () => {
    expect(resolveWorkspacePrimaryAction({ selectedLedger: { ...ledger, costSummary: { missingCount: 2 } }, query: "store=A&q=sku&supplier=B" })).toMatchObject({
      kind: "cost",
      path: "/cost-matching?ledger=ledger-2026-08",
    });
  });

  it("仅未选择账本时创建新导入", () => {
    expect(resolveWorkspacePrimaryAction()).toMatchObject({
      kind: "import",
      path: "/import-preview",
    });
  });
  it("已定稿提供报告入口，不继续导入或修改成本", () => {
    expect(resolveWorkspacePrimaryAction({ selectedLedger: { ...ledger, status: "finalized", costSummary: { missingCount: 2 } } })).toMatchObject({
      kind: "profit", title: "查看本月报告", path: "/profit?ledger=ledger-2026-08",
    });
  });
});
