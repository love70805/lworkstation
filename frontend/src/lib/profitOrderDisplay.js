const identifier = value => {
  if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) return "";
  return String(value).trim();
};

// Export presentation only. The selected evidence already has the accounting
// order; do not re-sort it or prefer an older 1688 order over a newer purchase.
export function profitOrderNumberForExport(row) {
  if (Array.isArray(row.costPurchaseRecords)) {
    for (const record of row.costPurchaseRecords) {
      const order = identifier(record?.order1688) || identifier(record?.purchaseOrderNo) || identifier(record?.purchaseOrderId);
      if (order) return order;
    }
    return "";
  }
  // This exact separator was used for old joined display strings. A slash
  // inside one order identifier is not a list separator.
  const legacy = typeof row.orderNumber === "string" ? row.orderNumber : identifier(row.orderNumber);
  return legacy.split(" / ").map(identifier).find(Boolean) ?? "";
}
