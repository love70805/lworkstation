import { canonicalPlatformSku } from "../domain/identifiers";
import { aggregateLedgerRows, flattenLedgerGroups } from "../domain/ledgerImport";
import { sumMoney } from "./money";

export function groupImportedSales(rows, knownCosts = []) {
  const costs = new Map(knownCosts
    .filter((row) => row.unitCost != null)
    .map((row) => [canonicalPlatformSku(row.platformSku ?? row.sku), row]));
  const grouped = flattenLedgerGroups(aggregateLedgerRows(rows));

  return grouped.map((row) => {
    const cost = costs.get(row.canonicalPlatformSku);
    return {
      ...row,
      name: cost?.name ?? row.platformSku,
      image: cost?.image ?? null,
      unitCost: cost?.unitCost ?? null,
      costSource: cost?.costSource ?? cost?.source ?? null,
      status: cost?.unitCost != null ? "Matched" : "Missing",
    };
  });
}

export function groupProfitRowsBySkc(rows = []) {
  const groups = new Map();

  rows.forEach((row) => {
    const key = row.groupKey ?? [row.store, row.groupSkc, row.supplierNumber].join("\u001f");
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        groupKey: key,
        store: row.store,
        platformSkc: row.platformSkc,
        groupSkc: row.groupSkc,
        supplierNumber: row.supplierNumber,
        variants: [],
      });
    }
    groups.get(key).variants.push(row);
  });

  return [...groups.values()].map((group) => {
    const variants = group.variants.toSorted((left, right) => (
      String(left.attribute ?? "").localeCompare(String(right.attribute ?? ""), "zh-CN")
      || String(left.platformSku ?? "").localeCompare(String(right.platformSku ?? ""), "zh-CN")
    ));
    const allFinalizable = variants.every((row) => row.finalizable);

    return {
      ...group,
      variants,
      skuCount: variants.length,
      qty: variants.reduce((sum, row) => sum + Number(row.qty ?? 0), 0),
      revenue: sumMoney(variants.map((row) => row.revenue)),
      purchaseCost: allFinalizable ? sumMoney(variants.map((row) => row.purchaseCost)) : null,
      warehouseCost: sumMoney(variants.map((row) => row.warehouseCost)),
      penalty: sumMoney(variants.map((row) => row.penalty)),
      profit: allFinalizable ? sumMoney(variants.map((row) => row.profit)) : null,
      finalizable: allFinalizable,
      missingCount: variants.filter((row) => !row.finalizable).length,
    };
  });
}
