import { describe, expect, it } from "vitest";
import { buildLedgerErpCostRequest } from "./erpRequest";

describe("按账本生成 ERP 成本请求", () => {
  it("绑定工作区、账本和平台 SKC 查询单位", () => {
    const request = buildLedgerErpCostRequest({
      ledger: { id: "LEDGER-2026-07", workspaceId: "workspace-default" },
      platformSkcs: ["SKC-B", "SKC-B", "SKC-W"],
      id: "ERP-REQ-TEST",
      requestedAt: "2026-08-07T00:00:00.000Z",
    });

    expect(request).toMatchObject({
      id: "ERP-REQ-TEST",
      workspaceId: "workspace-default",
      ledgerId: "LEDGER-2026-07",
      queryUnit: "platform_skc",
      currency: "CNY",
    });
    expect(request.platformSkcs.map((item) => item.platformSkc)).toEqual(["SKC-B", "SKC-W"]);
  });

  it("拒绝没有账本的请求", () => {
    expect(() => buildLedgerErpCostRequest({ platformSkcs: ["SKC-1"] })).toThrow("必须提供月度账本");
  });
});
