import { buildErpCostRequest } from "../domain/erpCosts";

export function buildLedgerErpCostRequest({
  ledger,
  platformSkcs,
  expectedSkus = [],
  ledgerVersion = null,
  requestedBy = "local-user",
  id = `ERP-REQ-${crypto.randomUUID()}`,
  requestedAt = new Date().toISOString(),
}) {
  if (!ledger) throw new Error("生成 ERP 请求前必须提供月度账本。");
  return buildErpCostRequest({
    id,
    workspaceId: ledger.workspaceId,
    ledgerId: ledger.id,
    ledgerPeriod: ledger.period ?? null,
    ledgerVersion,
    platformSkcs,
    expectedSkus,
    requestedBy,
    requestedAt,
  });
}
