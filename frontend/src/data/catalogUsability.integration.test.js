import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { db, getProductEditorSnapshot, listProductCatalogRecords, saveProductCatalogRecord, setActiveMemberContext } from "./database";
import { erpProductCatalogFixture } from "../testFixtures/erpProductCatalog";

beforeEach(async () => { await db.delete(); await db.open(); await setActiveMemberContext({ workspaceId: "workspace-default" }); });
afterEach(async () => { db.close(); await db.delete(); });

it("shows reference profit independently of finalization and keeps all financial records unchanged", async () => {
  const source = { ...erpProductCatalogFixture(), attribute: "B-粉色", catalogMappings: [] };
  await db.erpCostRows.add(source);
  const { product } = await saveProductCatalogRecord({ draft: { name: "顺序测试", platformSkc: source.platformSkc, store: "测试店", variants: [{ platformSku: source.platformSku, attribute: "粉色-B", salePrice: 6.83, warehouseSku: source.warehouseSku }] } });
  const costsBefore = await db.erpCostRows.toArray();
  const editor = await getProductEditorSnapshot({ productId: product.id });
  expect(editor.prefill.conflicts.filter(item => item.field === "attribute")).toEqual([]);
  expect(editor.draft.variants[0].attribute).toBe("粉色-B");
  const [record] = await listProductCatalogRecords();
  expect(record.dataReadiness).toMatchObject({ referenceProfit: { status: "complete" }, profit: { status: "missing" }, hasGaps: false });
  expect(record.skuReferences[0].referenceUnitProfit).toBe(1.54);
  expect(await db.erpCostRows.toArray()).toEqual(costsBefore);
  expect(await db.profitLines.count()).toBe(0);
  expect(await db.profitReports.count()).toBe(0);
  db.close(); await db.open();
  expect((await listProductCatalogRecords())[0].dataReadiness.referenceProfit.status).toBe("complete");
});
