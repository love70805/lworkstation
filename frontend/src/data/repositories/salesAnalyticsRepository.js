import { db } from "../db/clientDatabase";
import { getActiveMemberContext } from "./selectionRepository";
import { aggregateDailySales } from "../../domain/salesAnalytics";
import { canonicalStore } from "../../domain/batchSalesImport";

export async function readLedgerSalesAnalytics({ workspaceId, ledgerId, store = "all" }) {
  return db.transaction("r", db.ledgers, db.salesRows, db.settings, async () => {
    const current = await getActiveMemberContext();
    const ledger = await db.ledgers.get(ledgerId);
    if (!workspaceId || current.workspaceId !== workspaceId || !ledger || ledger.workspaceId !== workspaceId) throw new Error("账本不属于当前工作区。");
    const rows = (await db.salesRows.where("ledgerId").equals(ledgerId).toArray()).filter((row) => row.workspaceId === workspaceId);
    if (store !== "all" && !rows.some((row) => canonicalStore(row.store) === canonicalStore(store))) throw new Error("店铺不属于当前账本。");
    return aggregateDailySales(store === "all" ? rows : rows.filter((row) => canonicalStore(row.store) === canonicalStore(store)), { period: ledger.period });
  });
}
