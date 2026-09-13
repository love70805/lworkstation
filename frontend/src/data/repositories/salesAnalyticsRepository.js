import { db } from "../db/clientDatabase";
import { getActiveMemberContext } from "./selectionRepository";
import { aggregateDailySales, aggregateDailySalesDetails } from "../../domain/salesAnalytics";
import { canonicalStore } from "../../domain/batchSalesImport";

async function readScopedSales({ workspaceId, ledgerId, store = "all" }, aggregate) {
  return db.transaction("r", db.ledgers, db.salesRows, db.settings, async () => {
    const current = await getActiveMemberContext();
    const ledger = await db.ledgers.get(ledgerId);
    if (!workspaceId || current.workspaceId !== workspaceId || !ledger || ledger.workspaceId !== workspaceId) throw new Error("账本不属于当前工作区。");
    const rows = (await db.salesRows.where("ledgerId").equals(ledgerId).toArray()).filter((row) => row.workspaceId === workspaceId);
    if (store !== "all" && !rows.some((row) => canonicalStore(row.store) === canonicalStore(store))) throw new Error("店铺不属于当前账本。");
    return aggregate(store === "all" ? rows : rows.filter((row) => canonicalStore(row.store) === canonicalStore(store)), ledger.period);
  });
}

export async function readLedgerSalesAnalytics(scope) {
  return readScopedSales(scope, (rows, period) => aggregateDailySales(rows, { period }));
}

export async function readLedgerDailySalesDetails({ workspaceId, ledgerId, store = "all", date }) {
  const scope = { workspaceId, ledgerId, store, date };
  return readScopedSales(scope, (rows, period) => ({ ...aggregateDailySalesDetails(rows, { period, date }), scope }));
}
