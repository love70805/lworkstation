import { describe, expect, it } from "vitest";
import { erpProductTitle, suggestErpProductTitles } from "./erpProductTitles";

describe("bounded ERP Chinese title suggestions", () => {
  it("converges observed color variants while preserving accessory as a separate choice", () => {
    const rows = ["1个蓝色收腰神器-HHX sh680", "1个黑色收腰神器-HHX sh680", "1pc备用毛巾扣sh672LYY"].map((value, index) => ({ platformSku: `S${index}`, canonicalPlatformSku: `S${index}`, erpCatalogFields: { productName: { candidates: [{ value }] } } }));
    expect(suggestErpProductTitles(rows.slice(0, 2))).toMatchObject({ name: "收腰神器", needsChoice: false });
    expect(suggestErpProductTitles(rows)).toMatchObject({ name: "", suggestedName: "收腰神器", needsChoice: true, candidates: [{ name: "收腰神器" }, { name: "备用毛巾扣" }] });
  });
  it("does not strip semantic model, quantity, color, or arbitrary personnel strings", () => {
    for (const name of ["蓝色妖姬 12件组合", "3合1收纳架", "2个装 毛巾扣", "型号 X200 黑色", "收腰神器-HHX", "ERP 合成商品"]) expect(erpProductTitle(name)).toBe(name);
  });
});
