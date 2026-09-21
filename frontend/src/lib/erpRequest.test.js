import { describe, expect, it } from "vitest";
import { buildLedgerErpCostRequest } from "./erpRequest";

describe("按账本生成 ERP 成本请求", () => {
  it("绑定工作区、账本和平台 SKC 查询单位", () => {
    const request = buildLedgerErpCostRequest({
      ledger: { id: "LEDGER-2026-07", workspaceId: "workspace-default", period: "2026-07" },
      platformSkcs: ["SKC-B", "SKC-B", "SKC-W"],
      id: "ERP-REQ-TEST",
      requestedAt: "2026-08-07T00:00:00.000Z",
    });

    expect(request).toMatchObject({
      id: "ERP-REQ-TEST",
      workspaceId: "workspace-default",
      ledgerId: "LEDGER-2026-07",
      ledgerPeriod: "2026-07",
      queryUnit: "platform_skc",
      currency: "CNY",
    });
    expect(request.platformSkcs.map((item) => item.platformSkc)).toEqual(["SKC-B", "SKC-W"]);
  });

  it("拒绝没有账本的请求", () => {
    expect(() => buildLedgerErpCostRequest({ platformSkcs: ["SKC-1"] })).toThrow("必须提供月度账本");
  });

  it("uses ledger data even when the request date and ledger identifier imply another month", () => {
    const request = buildLedgerErpCostRequest({
      ledger: { id: "LEDGER-2026-09", workspaceId: "workspace-default", period: "2026-08" },
      platformSkcs: ["SKC-1"], requestedAt: "2026-09-22T00:00:00.000Z",
    });
    expect(request.ledgerPeriod).toBe("2026-08");
    expect(buildLedgerErpCostRequest({ ledger: { id: "LEDGER-2026-09", workspaceId: "workspace-default" }, platformSkcs: ["SKC-1"] }).ledgerPeriod).toBeNull();
  });

  it.each(["2026-13", "2026-00", "2026-8", "2026-08-01", "", 202608])("rejects invalid period %s", (period) => {
    expect(() => buildLedgerErpCostRequest({ ledger: { id: "L", workspaceId: "W", period }, platformSkcs: ["A"] })).toThrow("YYYY-MM");
  });
});
