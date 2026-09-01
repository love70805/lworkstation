import { useLiveQuery } from "dexie-react-hooks";
import { getLatestLedgerSnapshot, getLedgerSnapshot } from "../data/database";

export function useLatestSalesImport(ledgerId = null) {
  return useLiveQuery(async () => {
    const snapshot = ledgerId
      ? await getLedgerSnapshot(ledgerId)
      : await getLatestLedgerSnapshot();
    if (!snapshot) return null;

    const batch = snapshot.batches.toSorted((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
    return {
      ...snapshot,
      batch,
    };
  }, [ledgerId]);
}
