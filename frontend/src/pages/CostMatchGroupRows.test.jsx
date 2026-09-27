// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CostMatchGroupRows from "./CostMatchGroupRows";

let container, root;
const variant = (platformSku, extra = {}) => ({ platformSku, canonicalPlatformSku: platformSku, platformSkc: "SKC-1", sourcePlatformSku: platformSku, status: "matched", unitCost: 4.59, attribute: "白色 / L", ...extra });
const storeLine = (id, store, extra = {}) => ({ id, store, decision: { eligibleForExactProfit: true, unitCost: 4.59 }, erpCost: { publishedAt: "2026-09-01T00:00:00Z" }, ...extra });

async function render(variants, reviewRowsBySku = new Map(), extra = {}) {
  const props = {
    group: { id: "GROUP-1", platformSkc: "SKC-1", skuCount: variants.length, variants }, reviewRowsBySku,
    candidateSkuSet: new Set(), adoptionItemsBySku: new Map(), expanded: false, locked: false,
    onDetails: vi.fn(), onCorrect: vi.fn(), onToggle: vi.fn(), ...extra,
  };
  await act(async () => root.render(<CostMatchGroupRows {...props} />));
  return props;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe("cost matching shared SKU and store rows", () => {
  it("keeps four SKU identities, candidates, current costs and actions in the same actual rows", async () => {
    const longSku = "SKU-1234567890123456789012345678901234567890";
    const variants = [variant(longSku, { attribute: "象牙白色 / 加长袖口 / 最大尺寸 / 双层面料 / 长属性文本" }), variant("SKU-B"), variant("SKU-C"), variant("SKU-D")];
    const rowsBySku = new Map(variants.map((item, index) => [item.canonicalPlatformSku, [storeLine(`R-${index}`, `店铺${index + 1}`, { decision: { eligibleForExactProfit: true, unitCost: index + 1 } })]]));
    await render(variants, rowsBySku);
    const rows = [...container.querySelectorAll("tbody > tr")];
    expect(rows).toHaveLength(4);
    expect(container.querySelector(".cost-match-skc-cell").rowSpan).toBe(4);
    rows.forEach((row, index) => {
      expect(row.dataset.platformSku).toBe(variants[index].platformSku);
      expect(row.querySelector(".cost-match-sku-cell").textContent).toContain(variants[index].platformSku);
      expect(row.querySelector(".cost-match-candidate-cell").textContent).toContain("4.5900");
      expect(row.querySelector(".cost-match-current-cell").textContent).toContain(`店铺${index + 1}`);
      expect(row.querySelector(".cost-match-current-cell").textContent).toContain(`${index + 1}.0000`);
      expect(row.querySelector("button").getAttribute("aria-label")).toContain(variants[index].platformSku);
    });
    expect(rows[0].querySelector(".cost-match-identity").textContent).toContain(variants[0].attribute);
  });

  it("uses SKU and evidence row spans for multiple stores with distinct effective values and matching actions", async () => {
    const erp = storeLine("ERP", "甲店");
    const manual = storeLine("MANUAL", "名称较长的乙店", { manualOverride: { approvedAt: "2026-09-02T00:00:00Z" }, decision: { eligibleForExactProfit: true, unitCost: 0 } });
    const missing = storeLine("MISSING", "丙店", { erpCost: null, decision: { eligibleForExactProfit: false } });
    const props = await render([variant("SKU-A"), variant("SKU-B")], new Map([["SKU-A", [erp, manual]], ["SKU-B", [missing]]]));
    const rows = [...container.querySelectorAll("tbody > tr")];
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector(".cost-match-sku-cell").rowSpan).toBe(2);
    expect(rows[0].querySelector(".cost-match-candidate-cell").rowSpan).toBe(2);
    expect(rows[1].querySelector(".cost-match-sku-cell")).toBeNull();
    expect(rows[0].textContent).toContain("2 个店铺，分别采用成本");
    expect(rows[1].querySelector(".cost-match-current-cell").textContent).toContain("人工更正有效");
    expect(rows[1].querySelector(".cost-match-current-cell").textContent).toContain("¥0");
    expect(rows[2].textContent).toContain("待补成本");
    await act(async () => { rows[1].querySelector("button").click(); rows[2].querySelector("button:last-child").click(); });
    expect(props.onDetails).toHaveBeenCalledExactlyOnceWith(manual);
    expect(props.onCorrect).toHaveBeenCalledExactlyOnceWith(missing);
    const buttons = rows[1].querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(rows[2].querySelector("button:last-child").textContent).toBe("人工更正");
    buttons[0].focus(); expect(document.activeElement).toBe(buttons[0]);
  });

  it("preserves candidate and manual adopted statuses without mislabelling the effective store cost", async () => {
    await render([variant("SKU-A", { status: "anomaly_pending", unitCost: 9, evidenceComplete: true, costDecision: { selectedRecords: [{}] } })], new Map([["SKU-A", [storeLine("M", "甲店", { manualOverride: {}, decision: { eligibleForExactProfit: true, unitCost: 0.00001 } })]]]), { candidateSkuSet: new Set(["SKU-A"]) });
    expect(container.querySelector(".cost-match-candidate-cell").textContent).toContain("采购异常待处理");
    expect(container.querySelector(".cost-match-current-cell").textContent).toContain("0.00001");
    expect(container.querySelector(".cost-match-current-cell").textContent).toContain("人工更正有效");
  });

  it("keeps conflicting attribute provenance in the shared identity cell", async () => {
    await render([variant("SKU-A", { attribute: "红 / L、红 / XL", attributeEvidence: [
      { attribute: "红 / L", sources: [{ store: "甲店", sourceSheet: "台账", sourceRow: 2 }] },
      { attribute: "红 / XL", sources: [{ store: "乙店", sourceSheet: "台账", sourceRow: 8 }] },
    ] })], new Map([["SKU-A", [storeLine("A", "甲店"), storeLine("B", "乙店")]]]));
    const summary = container.querySelector(".cost-match-identity summary");
    expect(summary.textContent).toBe("查看 2 种属性来源");
    expect(summary.closest("td").rowSpan).toBe(2);
    expect(container.querySelector(".cost-match-identity details").textContent).toContain("乙店/台账 第8行");
  });

  it.each([true, false])("preserves unmapped evidence collapsing with mapped rows present: %s", async mapped => {
    const variants = [...(mapped ? [variant("SKU-A")] : []), variant("WH-X", { sourceWarehouseSku: "WH-X", sourcePlatformSku: "", mappingFallback: true })];
    function Harness() {
      const [expanded, setExpanded] = useState(false);
      return <CostMatchGroupRows group={{ id: "GROUP-1", platformSkc: "SKC-1", skuCount: variants.length, variants }} reviewRowsBySku={new Map([["SKU-A", [storeLine("A", "甲店")]]])} candidateSkuSet={new Set()} adoptionItemsBySku={new Map()} expanded={expanded} onToggle={() => setExpanded(value => !value)} evidencePreview={<span>原始采购证据</span>} locked />;
    }
    await act(async () => root.render(<Harness />));
    expect(container.querySelector('[data-platform-sku="WH-X"]')).toBeNull();
    expect(container.querySelector(".cost-match-skc-cell").rowSpan).toBe(mapped ? 2 : 1);
    await act(async () => container.querySelector(".cost-group-toggle").click());
    expect(container.querySelector('[data-platform-sku="WH-X"]').textContent).toContain("仅原始证据");
    expect(container.querySelector('[data-platform-sku="WH-X"] .cost-match-actions-cell button')).toBeNull();
    expect(container.querySelector(".cost-match-evidence-row").textContent).toContain("原始采购证据");
    expect(container.querySelector(".cost-match-skc-cell").rowSpan).toBe(mapped ? 3 : 2);
    expect(container.querySelector(".cost-group-toggle").getAttribute("aria-expanded")).toBe("true");
    await act(async () => container.querySelector(".cost-group-toggle").click());
    expect(container.querySelector(".cost-match-evidence-row")).toBeNull();
  });

  it("offers only a named details button on a locked ledger", async () => {
    const line = storeLine("L", "甲店", { manualOverride: {} });
    const props = await render([variant("SKU-A")], new Map([["SKU-A", [line]]]), { locked: true });
    const buttons = container.querySelectorAll(".cost-match-row-actions button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].getAttribute("aria-label")).toBe("甲店 · SKU-A · 详情");
    await act(async () => buttons[0].click());
    expect(props.onDetails).toHaveBeenCalledExactlyOnceWith(line);
    expect(props.onCorrect).not.toHaveBeenCalled();
  });
});
