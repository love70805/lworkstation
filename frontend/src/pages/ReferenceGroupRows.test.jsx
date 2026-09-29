// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReferenceGroupRows from "./ReferenceGroupRows";

let container, root;
const variant = (platformSku, extra = {}) => ({
  platformSku, canonicalPlatformSku: platformSku, attribute: "白色 / L", referenceUnitCost: 4.59, authoritativeSource: "erp", referenceKind: "erp_history",
  latestPeriod: "2026-08", latestLedgerId: `LEDGER-${platformSku}`, latestQuantity: 12, recentRevenue: 300, recentMonthCount: 3, recentQuantity: 30,
  latestProfit: 100, latestProfitRate: 33.3, referenceUnitProfit: 10, referenceProfitRate: 50, averageSalePrice: 15, ...extra,
});
const ledgerIdentity = {
  platformSkcSource: "ledger", attributeSource: "ledger",
  platformSkcEvidence: [{ value: "SKC-1", sources: [{ kind: "ledger", period: "2026-08", store: "甲店", sourceSheet: "销售台账", sourceRow: 3, ledgerId: "LEDGER-UUID-123456789", batchId: "BATCH-UUID-987654321" }] }],
  attributeEvidence: [{ value: "白色 / L", sources: [{ kind: "ledger", period: "2026-08", store: "甲店", sourceSheet: "销售台账", sourceRow: 3, ledgerId: "LEDGER-UUID-123456789" }] }],
};

async function render(variants, extra = {}) {
  const props = { group: { platformSkc: "SKC-1", productName: "合成参考商品", skuCount: variants.length, variants }, onEdit: vi.fn(), onOpenLedger: vi.fn(), ...extra };
  await act(async () => root.render(<ReferenceGroupRows {...props} />));
  return props;
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe("selection reference shared SKU rows", () => {
  it("shows verified ERP purchase references separately with zero and small positive precision", async () => {
    await render([variant("UNSOLD-ZERO", { referenceKind: "erp_catalog_reference", authoritativeSource: "erp_reference", referenceUnitCost: 0, latestLedgerId: null, latestPeriod: null }), variant("UNSOLD-TINY", { referenceKind: "erp_catalog_reference", authoritativeSource: "erp_reference", referenceUnitCost: 0.0003 })]);
    const rows = [...container.querySelectorAll("tbody > tr")];
    expect(rows[0].querySelector(".reference-cost-cell").textContent).toContain("¥0.0000");
    expect(rows[0].querySelector(".reference-cost-cell").textContent).toContain("ERP 采购参考");
    expect(rows[1].querySelector(".reference-cost-cell").textContent).toContain("¥0.0003");
  });

  it("keeps each SKU, source, cost and profit in one actual row when long identity evidence expands", async () => {
    const longSku = "SKU-1234567890123456789012345678901234567890";
    const variants = [variant(longSku, { attribute: "象牙白色 / 加长袖口 / 最大尺寸 / 双层面料", ...ledgerIdentity }), variant("SKU-B", { referenceUnitCost: 7.34, latestProfit: -5 }), variant("SKU-C", { referenceUnitCost: 0 })];
    const props = await render(variants);
    const rows = [...container.querySelectorAll("tbody > tr")];
    expect(rows).toHaveLength(3);
    rows.forEach((row, index) => {
      expect(row.dataset.platformSku).toBe(variants[index].platformSku);
      expect(row.querySelector(".reference-identity-cell").textContent).toContain(variants[index].platformSku);
      expect(row.querySelector(".reference-cost-cell .reference-money").textContent).toBe(["¥4.5900", "¥7.3400", "¥0.0000"][index]);
      expect(row.querySelectorAll("td")).toHaveLength(7);
    });
    const details = rows[0].querySelector(".reference-identity-evidence");
    details.open = true;
    expect(details.closest("tr")).toBe(rows[0]);
    expect(rows[0].querySelector(".reference-cost-cell").textContent).toContain("ERP 历史");
    expect(rows[1].querySelector(".reference-profit-cell").textContent).toContain("-¥5.00");
    expect(details.textContent).toContain("销售台账 第 3 行");
    await act(async () => details.querySelector("summary").click());
    expect(props.onOpenLedger).not.toHaveBeenCalled();
  });

  it("keeps source IDs available on demand while the first provenance level shows business context", async () => {
    await render([variant("SKU-A", ledgerIdentity)]);
    const details = container.querySelector(".reference-identity-evidence");
    const firstSource = details.querySelector("p small");
    expect(firstSource.textContent).toBe("台账 · 2026-08 · 甲店 · 销售台账 第 3 行");
    expect(firstSource.title).toContain("账本 LEDGER-UUID-123456789 · 批次 BATCH-UUID-987654321");
    const identifiers = details.querySelector(".reference-source-identifiers");
    expect(identifiers.open).toBe(false);
    expect(identifiers.textContent).toContain("账本 LEDGER-UUID-123456789");
    expect(identifiers.textContent).toContain("批次 BATCH-UUID-987654321");
  });

  it("opens the matching SKU ledger by row, keyboard or period link without navigating on source details", async () => {
    const props = await render([variant("SKU-A", ledgerIdentity), variant("SKU-B", { latestLedgerId: "OTHER-LEDGER" })]);
    const rows = [...container.querySelectorAll("tbody > tr")];
    await act(async () => rows[1].querySelector(".reference-profit-cell").click());
    expect(props.onOpenLedger).toHaveBeenLastCalledWith("OTHER-LEDGER");
    await act(async () => rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(props.onOpenLedger).toHaveBeenLastCalledWith("LEDGER-SKU-A");
    await act(async () => rows[1].querySelector(".reference-period-link").click());
    expect(props.onOpenLedger).toHaveBeenCalledTimes(3);
    expect(props.onOpenLedger).toHaveBeenLastCalledWith("OTHER-LEDGER");
    await act(async () => { rows[0].querySelector("summary").click(); rows[0].querySelector("summary").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(props.onOpenLedger).toHaveBeenCalledTimes(3);
  });

  it("keeps the archive action at group level and existing product editing distinct from ledger navigation", async () => {
    const props = await render([variant("SKU-A"), variant("SKU-B")], { group: { platformSkc: "SKC-1", skuCount: 2, productId: "PRODUCT-1", productName: "商品档案", variants: [variant("SKU-A"), variant("SKU-B")] } });
    const action = container.querySelector("caption button");
    expect(action.textContent).toBe("查看档案");
    await act(async () => action.click());
    expect(props.onEdit).toHaveBeenCalledOnce();
    expect(props.onOpenLedger).not.toHaveBeenCalled();
    expect(container.querySelectorAll("caption button")).toHaveLength(1);
  });

  it("preserves missing, manual and negative reference states and cannot open a missing ledger", async () => {
    await render([
      variant("MISSING", { latestPeriod: null, latestLedgerId: null, referenceUnitCost: null, averageSalePrice: null, latestProfit: null, referenceUnitProfit: null }),
      variant("MANUAL", { referenceKind: "manual_confirmed", authoritativeSource: "manual", referenceUnitCost: 5, referenceUpdatedAt: "2026-09-01", manualCostHistoryCount: 2 }),
      variant("NEGATIVE", { hasNegativeProfit: true, referenceUnitProfit: -10 }),
      variant("NO-PRICE", { averageSalePrice: null }),
    ]);
    const rows = [...container.querySelectorAll("tbody > tr")];
    expect(rows[0].querySelector(".reference-status-cell").textContent).toBe("缺参考成本");
    expect(rows[0].getAttribute("tabindex")).toBeNull();
    expect(rows[0].querySelector(".reference-period-link")).toBeNull();
    expect(rows[1].querySelector(".reference-cost-cell").textContent).toContain("人工确认");
    expect(rows[1].querySelector(".reference-cost-cell").textContent).toContain("2 条记录");
    expect(rows[2].querySelector(".reference-status-cell").textContent).toBe("出现负利润");
    expect(rows[3].querySelector(".reference-status-cell").textContent).toBe("等待售价历史");
  });
});
