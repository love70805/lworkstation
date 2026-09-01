export const DEFAULT_WORKSPACE_ID = "workspace-default";
export const DEFAULT_WORKSPACE_NAME = "默认工作区";
export const DEFAULT_MEMBER_ID = "local-user";
export const ACTIVE_MEMBER_CONTEXT_KEY = "active-member-context";

export function normalizeLedgerPeriod(value) {
  const period = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new Error("账本月份必须使用 YYYY-MM 格式。");
  }
  return period;
}

export function monthlyLedgerId(workspaceId, period) {
  return `LEDGER-${workspaceId}-${normalizeLedgerPeriod(period)}`;
}

export function formatLedgerPeriod(period) {
  const [year, month] = normalizeLedgerPeriod(period).split("-");
  return `${year} 年 ${Number(month)} 月`;
}
