import { describe, expect, it } from "vitest";
import { resolveWorkspacePrimaryAction } from "./workspaceActions";

const ledger = { id: "ledger-2026-08", period: "2026-08" };

describe("工作区首页快捷入口", () => {
  it("在成本待办存在时指向利润核算，避免与待办条重复", () => {
    expect(resolveWorkspacePrimaryAction({ alertPath: "/cost-matching?ledger=ledger-2026-08", latestOpenLedger: ledger })).toMatchObject({
      kind: "profit",
      path: "/profit?ledger=ledger-2026-08",
    });
  });

  it("在利润复核待办存在时指向 ERP 成本证据", () => {
    expect(resolveWorkspacePrimaryAction({ alertPath: "/profit?ledger=ledger-2026-08", latestOpenLedger: ledger })).toMatchObject({
      kind: "cost",
      path: "/cost-matching?ledger=ledger-2026-08",
    });
  });

  it("没有互补待办时回到销售台账导入", () => {
    expect(resolveWorkspacePrimaryAction({ latestOpenLedger: ledger })).toMatchObject({
      kind: "import",
      path: "/import-preview",
    });
  });
});
