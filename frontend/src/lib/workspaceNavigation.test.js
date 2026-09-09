import { describe, expect, it } from "vitest";
import { validatedLedgerSearch, workspaceLedgerQuery } from "./workspaceNavigation";
describe("首页与账本侧栏上下文", () => {
  const ledger = { id: "L1", workspaceId: "W1" };
  it("只携带当前工作区已验证账本和筛选", () => {
    expect(validatedLedgerSearch("?ledger=L1&q=中文&store=甲&supplier=A&supplier=B&missing=1&foreign=value", ledger, "W1"))
      .toBe("?ledger=L1&q=%E4%B8%AD%E6%96%87&store=%E7%94%B2&supplier=A&supplier=B&missing=1");
  });
  it("不携带不存在、跨工作区或已切换账本上下文", () => {
    expect(validatedLedgerSearch("?ledger=L1&q=秘密", ledger, "W2")).toBe("");
    expect(validatedLedgerSearch("?ledger=L1", null, "W1")).toBe("");
    expect(validatedLedgerSearch("?ledger=L2", ledger, "W1")).toBe("");
    expect(validatedLedgerSearch("?q=秘密", ledger, "W1")).toBe("");
  });
  it("切换月份只保留新账本存在的店铺和货号，显式重置缺省值", () => {
    const rows = [{ store: "甲店", supplierNumber: "A" }];
    const query = workspaceLedgerQuery("L2", "?store=甲店&q=关键词&supplier=A&supplier=B&missing=1", rows, true);
    expect(query.get("store")).toBe("甲店");
    expect(query.getAll("supplier")).toEqual(["A"]);
    expect(query.get("q")).toBe("关键词");
    expect(query.get("missing")).toBe("1");
    expect(workspaceLedgerQuery("L2", "?store=乙店", rows, true).get("store")).toBe("all");
    expect(workspaceLedgerQuery("L2", "?supplier=", rows, true).getAll("supplier")).toEqual([""]);
    expect(workspaceLedgerQuery("L2", query.toString(), rows, false).toString()).toBe("ledger=L2&store=all&missing=0");
  });
});
