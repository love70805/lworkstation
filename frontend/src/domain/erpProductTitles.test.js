import { describe, expect, it } from "vitest";
import { erpProductTitle, suggestErpProductTitles } from "./erpProductTitles";

describe("bounded ERP Chinese title suggestions", () => {
  const specRow = (sku, name, spec, patch = {}) => ({ platformSku: sku, canonicalPlatformSku: sku, platformSkc: 'SKC',
    erpCatalogFields: { productName: { candidates: [{ value: name }] } },
    erpCatalogPurchases: [{ platformSku: sku, platformSkc: 'SKC', purchaseCatalog: { purchaseSpecificationAndModel1688: spec }, ...patch }] });
  it('converges variant labels only when the same SKU selling specification supports them', () => {
    expect(suggestErpProductTitles([specRow('A', '红色-收纳盒', '颜色:红色'), specRow('B', '蓝色-收纳盒', '颜色:蓝色')])).toMatchObject({ name: '收纳盒', needsChoice: false });
    expect(suggestErpProductTitles([specRow('A', '大号-3合1收纳架', '规格:大号'), specRow('B', '小号-3合1收纳架', '规格:小号')]).name).toBe('3合1收纳架');
    expect(suggestErpProductTitles([specRow('A', '2个装-收纳盒', '规格:2个装'), specRow('B', '4个装-收纳盒', '规格:4个装')]).name).toBe('收纳盒');
  });
  it('retains real differences and ignores missing, unrelated or mismatched purchase evidence', () => {
    for (const patch of [{ platformSku: 'OTHER' }, { platformSkc: 'OTHER' }, { purchaseCatalog: { specificationAndModel: '红色' } }]) {
      expect(suggestErpProductTitles([specRow('A', '红色-收纳盒', '颜色:红色', patch), specRow('B', '蓝色-收纳盒', '颜色:蓝色')]).needsChoice).toBe(true);
    }
    expect(suggestErpProductTitles([specRow('A', '红色-收纳盒', '颜色:红色'), specRow('B', '蓝色-沙滩帐篷', '颜色:蓝色')]).needsChoice).toBe(true);
    expect(suggestErpProductTitles([specRow('A', '型号 X200 黑色', '颜色:黑色')]).name).toBe('型号 X200 黑色');
  });
  it("converges observed color variants while preserving accessory as a separate choice", () => {
    const rows = ["1个蓝色收腰神器-HHX sh680", "1个黑色收腰神器-HHX sh680", "1pc备用毛巾扣sh672LYY"].map((value, index) => ({ platformSku: `S${index}`, canonicalPlatformSku: `S${index}`, erpCatalogFields: { productName: { candidates: [{ value }] } } }));
    expect(suggestErpProductTitles(rows.slice(0, 2))).toMatchObject({ name: "收腰神器", needsChoice: false });
    expect(suggestErpProductTitles(rows)).toMatchObject({ name: "", suggestedName: "收腰神器", needsChoice: true, candidates: [{ name: "收腰神器" }, { name: "备用毛巾扣" }] });
  });
  it("does not strip semantic model, quantity, color, or arbitrary personnel strings", () => {
    for (const name of ["蓝色妖姬 12件组合", "3合1收纳架", "2个装 毛巾扣", "型号 X200 黑色", "收腰神器-HHX", "ERP 合成商品"]) expect(erpProductTitle(name)).toBe(name);
  });
  it("normalizes compound colors and attached internal suffixes", () => {
    expect(erpProductTitle("1个灰粉色保暖手套-LBYsh680")).toBe("保暖手套");
    expect(erpProductTitle("1个黑灰色保暖手套-LBYsh680")).toBe("保暖手套");
  });
});
