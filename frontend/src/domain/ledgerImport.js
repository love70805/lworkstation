import Decimal from "decimal.js";
import { assertDomain } from "./errors";
import { canonicalPlatformSku, normalizePlatformSku } from "./identifiers";

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function canonicalKeyPart(value) {
  return normalizedText(value).toUpperCase();
}

function money(value) {
  return new Decimal(value ?? 0);
}

export function createLedgerGroupKey({ store, platformSkc, supplierNumber, legacyFallbackSku = "" }) {
  const normalizedStore = normalizedText(store);
  const normalizedSupplier = normalizedText(supplierNumber);
  const groupSkc = normalizedText(platformSkc) || normalizedSupplier || normalizedText(legacyFallbackSku);

  assertDomain(normalizedStore, "ledger_store_required", "店铺不能为空");
  assertDomain(groupSkc, "ledger_group_identifier_required", "平台 SKC 与供方货号不能同时为空");

  return [
    canonicalKeyPart(normalizedStore),
    canonicalKeyPart(groupSkc),
    canonicalKeyPart(normalizedSupplier),
  ].join("\u001f");
}

export function createLedgerSkuKey({ platformSku, attribute }) {
  const normalizedSku = normalizePlatformSku(platformSku);
  return [canonicalPlatformSku(normalizedSku), canonicalKeyPart(attribute)].join("\u001f");
}

export function aggregateLedgerRows(rows) {
  const groups = new Map();

  rows.forEach((row) => {
    const groupKey = row.groupKey ?? createLedgerGroupKey({ ...row, legacyFallbackSku: row.platformSku ?? row.sku });
    const skuKey = row.skuKey ?? createLedgerSkuKey(row);
    const groupSkc = normalizedText(row.platformSkc) || normalizedText(row.supplierNumber);
    const platformSku = normalizePlatformSku(row.platformSku ?? row.sku);

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupKey,
        store: normalizedText(row.store),
        platformSkc: normalizedText(row.platformSkc),
        groupSkc,
        supplierNumber: normalizedText(row.supplierNumber),
        skus: new Map(),
      });
    }

    const group = groups.get(groupKey);
    if (!group.skus.has(skuKey)) {
      group.skus.set(skuKey, {
        skuKey,
        platformSku,
        canonicalPlatformSku: canonicalPlatformSku(platformSku),
        attribute: normalizedText(row.attribute),
        quantity: new Decimal(0),
        revenue: new Decimal(0),
        penalty: new Decimal(0),
        sourceRowCount: 0,
        orderIds: new Set(),
        order1688: normalizedText(row.order1688) || null,
        legacyImportedUnitCost: null,
        sourceRows: [],
      });
    }

    const sku = group.skus.get(skuKey);
    sku.sourceRows.push(row.sourceRow ?? null);

    if (row.isDeduction) {
      sku.penalty = sku.penalty.plus(money(row.deductionAmount ?? row.penalty).abs());
    } else {
      sku.quantity = sku.quantity.plus(money(row.quantity));
      sku.revenue = sku.revenue.plus(money(row.amount));
      sku.sourceRowCount += 1;
      const orderId = normalizedText(row.orderId);
      if (orderId) sku.orderIds.add(orderId);
    }

    if (row.hasDirectUnitCost) {
      sku.legacyImportedUnitCost = money(row.directUnitCost).toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber();
    }
    if (row.hasDirectPenalty) {
      sku.penalty = money(row.directPenalty);
    }
  });

  return [...groups.values()].map((group) => ({
    ...group,
    skus: [...group.skus.values()].map((sku) => ({
      ...sku,
      quantity: sku.quantity.toNumber(),
      revenue: sku.revenue.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber(),
      penalty: sku.penalty.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber(),
      realOrderCount: sku.orderIds.size,
      orderIds: [...sku.orderIds],
    })),
  }));
}

export function flattenLedgerGroups(groups) {
  return groups.flatMap((group) => group.skus.map((sku) => ({
    id: `${group.groupKey}::${sku.skuKey}`,
    groupKey: group.groupKey,
    skuKey: sku.skuKey,
    store: group.store,
    platformSkc: group.platformSkc,
    groupSkc: group.groupSkc,
    supplierNumber: group.supplierNumber,
    platformSku: sku.platformSku,
    sku: sku.platformSku,
    canonicalPlatformSku: sku.canonicalPlatformSku,
    attribute: sku.attribute,
    qty: sku.quantity,
    quantity: sku.quantity,
    revenue: sku.revenue,
    amount: sku.revenue,
    penalty: sku.penalty,
    sourceRowCount: sku.sourceRowCount,
    realOrderCount: sku.realOrderCount,
    order1688: sku.order1688,
    legacyImportedUnitCost: sku.legacyImportedUnitCost,
    orderIds: sku.orderIds,
    sourceRows: sku.sourceRows,
  })));
}

export function summarizeLedgerRows(rows) {
  const flattened = flattenLedgerGroups(aggregateLedgerRows(rows));
  const summary = flattened.reduce((total, row) => ({
    quantity: total.quantity.plus(row.quantity),
    revenue: total.revenue.plus(row.revenue),
    penalty: total.penalty.plus(row.penalty),
    sourceRowCount: total.sourceRowCount + row.sourceRowCount,
    realOrderIds: new Set([...total.realOrderIds, ...(row.orderIds ?? [])]),
  }), {
    quantity: new Decimal(0),
    revenue: new Decimal(0),
    penalty: new Decimal(0),
    sourceRowCount: 0,
    realOrderIds: new Set(),
  });

  return {
    groupCount: new Set(flattened.map((row) => row.groupKey)).size,
    skuLineCount: flattened.length,
    quantity: summary.quantity.toNumber(),
    revenue: summary.revenue.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber(),
    penalty: summary.penalty.toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber(),
    sourceRowCount: summary.sourceRowCount,
    realOrderCount: summary.realOrderIds.size,
  };
}
