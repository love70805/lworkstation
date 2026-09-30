import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, getProductEditorSnapshot, getSelectionReferenceSnapshot, listProductCatalogRecords, saveProductCatalogRecord, setActiveMemberContext } from "./database";
import { erpCatalogReferenceCosts } from "../domain/erpCatalogReference";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";
import { erpProductCatalogFixture } from "../testFixtures/erpProductCatalog";
import { saveErpCatalogRequest } from "./repositories/erpCatalogRepository";
import { buildErpCatalogRequest } from "../domain/erpCatalogRequest";
import { buildErpCostRequest } from "../domain/erpCosts";
import { buildErpCostBatchEnvelope } from "../domain/erpCostBatchEnvelope";
import { buildErpCostInboxEnvelope } from "../domain/erpInboxContract";

const workspace="workspace-default";
const conversion=sku=>({warehouseUnits:2,platformUnits:1,source:"erp_platform_mapping",sourceRef:`mapping:WH:${sku}`});
const evidence=(warehouseSku="WH", price=4)=>({warehouseSku,evidenceRef:`warehouse:${warehouseSku}`,evidenceComplete:true,purchaseRecords:[{recordId:`PURCHASE-${warehouseSku}`,warehouseSku,purchaseDate:"2026-08-28",quantity:6,unitPrice:price}]});
const envelope=()=>({workspaceId:workspace,query:{platformSkcs:["SKC"]},rows:[{platformSku:"SKU-A",platformSkc:"SKC",warehouseSku:"WH",unitConversion:conversion("SKU-A")}],warehouseEvidence:[evidence()]});
const pricedDraft=()=>({name:"合成旧报价",platformSkc:"SKC-CATALOG",supplierName:"合成供应商",sourceUrl:"https://detail.1688.com/offer/12345678901.html",imageUrl:"https://images.example.invalid/manual.jpg",shippingAmount:12,handlingFee:0.5,variants:[{platformSku:"SKU-RED",purchaseUnitPrice:4,purchasePackCount:2,unitsPerPack:1}]});
beforeEach(async()=>{await db.delete();await db.open();await setActiveMemberContext({workspaceId:workspace});});
afterEach(async()=>{db.close();await db.delete();});

describe("0.3.3 independent read-only review regressions",()=>{
 it("keeps third and subsequent contradictory SKU mappings excluded without crashing the projection",()=>{
   const source=envelope();
   source.rows=["WH1","WH2","WH3"].map(warehouseSku=>({...source.rows[0],warehouseSku}));
   source.warehouseEvidence=source.rows.map(row=>evidence(row.warehouseSku));
   expect(erpCatalogReferenceCosts(source,{period:"2026-08",batchId:"B"})).toEqual([]);
 });
 it("uses each explicit warehouse mapping without requiring a unit conversion",()=>{
   const source=envelope();source.rows[0].catalogMappings=[{platformSku:"SKU-B",platformSkc:"SKC",warehouseSku:"WH"}];
   const result=erpCatalogReferenceCosts(source,{period:"2026-08",batchId:"B"});
   expect(result.map(row=>row.platformSku)).toEqual(["SKU-A", "SKU-B"]);
   expect(result.map(row=>row.unitCost)).toEqual([4, 4]);
 });
 it("does not treat a blank purchase price as a verified true zero",()=>{
   const source=envelope();source.warehouseEvidence=[evidence("WH","")];
   expect(erpCatalogReferenceCosts(source,{period:"2026-08",batchId:"B"})).toEqual([]);
 });
 it("preserves an explicitly cleared supplier URL through old-quote merging and reopening",async()=>{
   const {product}=await saveProductCatalogRecord({draft:pricedDraft()});
   const quotes=await db.supplierOffers.toArray();
   const {draft}=await getProductEditorSnapshot({productId:product.id});
   draft.sourceUrl="";draft.suppliers[0].sourceUrl="";
   draft.fieldEdits={sourceUrl:true,suppliers:{[draft.suppliers[0].supplierId]:{sourceUrl:true}}};
   draft.quoteEditIntent={supplierIds:[]};
   await saveProductCatalogRecord({productId:product.id,draft});
   db.close();await db.open();
   const reopened=await getProductEditorSnapshot({productId:product.id});
   expect(reopened.draft.sourceUrl).toBe("");expect(reopened.draft.suppliers[0].sourceUrl).toBe("");
   expect(await db.supplierOffers.toArray()).toEqual(quotes);
 });
 it("preserves a cleared cover in reference projections as well as the editor",async()=>{
   const {product}=await saveProductCatalogRecord({draft:pricedDraft()});
   await db.erpCostRows.add(erpProductCatalogFixture());
   const {draft}=await getProductEditorSnapshot({productId:product.id});
   draft.imageUrl="";draft.fieldEdits={...draft.fieldEdits,imageUrl:true};draft.quoteEditIntent={supplierIds:[]};
   await saveProductCatalogRecord({productId:product.id,draft});
   expect((await getProductEditorSnapshot({productId:product.id})).draft.imageUrl).toBe("");
   expect(buildSelectionReferenceRows(await getSelectionReferenceSnapshot()).find(row=>row.platformSku==="SKU-RED").imageUrl).toBe("");
 });
 it("does not read, adopt, or delete foreign-workspace children even when they point to a visible product ID",async()=>{
   const {product}=await saveProductCatalogRecord({draft:{name:"本工作区档案",platformSkc:"SKC-CATALOG",variants:[{platformSku:"SKU-RED"}]}});
   const foreignSku={id:"FOREIGN-SKU-ID",workspaceId:"W-FOREIGN",productId:product.id,platformSku:"FOREIGN-SKU",canonicalPlatformSku:"FOREIGN-SKU",platformSkc:"FOREIGN-SKC",attribute:"外工作区私有属性",status:"active"};
   const foreignOffer={id:"FOREIGN-OFFER-ID",workspaceId:"W-FOREIGN",productId:product.id,platformSku:"FOREIGN-SKU",canonicalPlatformSku:"FOREIGN-SKU",supplierName:"外工作区私有供应商",sourceUrl:"https://detail.1688.com/offer/99999999999.html",purchaseUnitPrice:3,landedUnitCost:3,status:"active"};
   await db.platformSkus.put(foreignSku);await db.supplierOffers.put(foreignOffer);
   const editor=await getProductEditorSnapshot({productId:product.id});
   expect(editor.draft.variants.map(row=>row.platformSku)).toEqual(["SKU-RED"]);
   expect(editor.draft.suppliers.some(row=>row.supplierName===foreignOffer.supplierName)).toBe(false);
   const list=await listProductCatalogRecords();expect(list[0].skuCount).toBe(1);
   await saveProductCatalogRecord({productId:product.id,draft:editor.draft});
   expect(await db.platformSkus.get(foreignSku.id)).toEqual(foreignSku);
   expect(await db.supplierOffers.get(foreignOffer.id)).toEqual(foreignOffer);
 });
 it("restricts catalog reference costs to the original registered SKC query as strictly as metadata",async()=>{
   await db.ledgers.put({id:"L",workspaceId:workspace,period:"2026-08",status:"cost_pending"});
   await db.erpCostRequests.put({id:"REQ",workspaceId:workspace,ledgerId:"L",ledgerPeriod:"2026-08",platformSkcs:["SKC"]});
   const rows=["SKC","UNREGISTERED"].map((platformSkc,index)=>({platformSku:`SKU-${index}`,platformSkc,warehouseSku:"WH",workspaceId:workspace,ledgerId:"L",batchId:"B",unitConversion:conversion(`SKU-${index}`)}));
   await db.erpCostBatches.put({id:"B",workspaceId:workspace,ledgerId:"L",requestId:"REQ",status:"published",publishedAt:"2026-09-29T00:00:00.000Z",sourceContract:{requestId:"REQ",query:{unit:"platform_skc",platformSkcs:["SKC","UNREGISTERED"]},catalogRows:rows,warehouseEvidence:[evidence()]}});
   const snapshot=await getSelectionReferenceSnapshot();
   expect(snapshot.erpCatalogRows.map(row=>row.platformSku)).toEqual(["SKU-0"]);
   expect(snapshot.erpCatalogReferences.map(row=>row.platformSku)).toEqual(["SKU-0"]);
   expect(buildSelectionReferenceRows(snapshot).some(row=>row.platformSku==="SKU-1")).toBe(false);
 });
 it("retains a valid zero ERP cost in the official catalog coverage",async()=>{
   await saveProductCatalogRecord({draft:{name:"真实零成本档案",platformSkc:"SKC",variants:[{platformSku:"SKU-ZERO"}]}});
   await db.erpCostRows.add({workspaceId:workspace,platformSku:"SKU-ZERO",canonicalPlatformSku:"SKU-ZERO",unitCost:0,resolutionStatus:"resolved",publishedAt:"2026-09-29T00:00:00.000Z"});
   const [product]=await listProductCatalogRecords();
   expect(product.skuReferences[0]).toMatchObject({unitCost:0,source:"erp"});
   expect(product.referenceCostCoverage.coveredSkuCount).toBe(1);
 });
});

describe("0.3.3 inferred manual clears",()=>{
 it("preserves inferred top-level supplier name and URL clears without requiring nested UI flags",async()=>{
   const {product}=await saveProductCatalogRecord({draft:pricedDraft()});
   const {draft}=await getProductEditorSnapshot({productId:product.id});
   const oldQuotes=await db.supplierOffers.toArray();
   draft.supplierName="";draft.sourceUrl="";
   draft.suppliers[0].supplierName="";draft.suppliers[0].sourceUrl="";
   delete draft.fieldEdits;
   draft.quoteEditIntent={supplierIds:[]};
   await saveProductCatalogRecord({productId:product.id,draft});
   expect(await db.products.get(product.id)).toMatchObject({supplierName:"",sourceUrl:""});
   const reopened=await getProductEditorSnapshot({productId:product.id});
   expect(reopened.draft.supplierName).toBe("");expect(reopened.draft.sourceUrl).toBe("");
   expect(await db.supplierOffers.toArray()).toEqual(oldQuotes);
 });
});

describe("0.3.3 reference missing-value guards",()=>{
 it("does not promote a blank legacy supplier cost into a true-zero reference",()=>{
   const [row]=buildSelectionReferenceRows({platformSkus:[{platformSku:"SKU-BLANK",canonicalPlatformSku:"SKU-BLANK",platformSkc:"SKC"}],supplierOffers:[{id:"BLANK",platformSku:"SKU-BLANK",landedUnitCost:"",status:"active"}]});
   expect(row.referenceUnitCost).toBeNull();
   expect(row.referenceKind).toBeNull();
 });
 it("does not infer a current zero sale price or reference profit from a blank price",()=>{
   const [row]=buildSelectionReferenceRows({platformSkus:[{platformSku:"SKU-BLANK",canonicalPlatformSku:"SKU-BLANK",platformSkc:"SKC",salePrice:""}],erpCosts:[{id:"COST",platformSku:"SKU-BLANK",unitCost:4,resolutionStatus:"resolved"}]});
   expect(row.catalogSalePrice).toBeNull();
   expect(row.averageSalePrice).toBeNull();
   expect(row.referenceUnitProfit).toBeNull();
 });
});

describe("0.3.3 cleared SKU reference fields",()=>{
 it("keeps a deliberately cleared SKU attribute and warehouse relation empty in the reference projection",async()=>{
   const initial=pricedDraft();initial.variants[0].attribute="人工属性";initial.variants[0].warehouseSku="WH-MANUAL";
   const {product}=await saveProductCatalogRecord({draft:initial});
   await db.erpCostRows.add(erpProductCatalogFixture());
   const {draft}=await getProductEditorSnapshot({productId:product.id});
   const variant=draft.variants.find(row=>row.platformSku==="SKU-RED");
   variant.attribute="";variant.warehouseSku="";
   await saveProductCatalogRecord({productId:product.id,draft});
   const reopened=await getProductEditorSnapshot({productId:product.id});
   expect(reopened.draft.variants.find(row=>row.platformSku==="SKU-RED")).toMatchObject({attribute:"",warehouseSku:""});
   const reference=buildSelectionReferenceRows(await getSelectionReferenceSnapshot()).find(row=>row.platformSku==="SKU-RED");
   expect(reference).toMatchObject({attribute:"",warehouseSku:""});
 });
});

describe("0.3.3 catalog request source closure",()=>{
 const request=(id,confirmedSkus,sourceProductIds,platformSkcs=[...new Set(confirmedSkus.map(row=>row.platformSkc))])=>buildErpCatalogRequest({id,workspaceId:workspace,ledgerPeriod:"2026-08",platformSkcs,confirmedSkus,sourceProductIds,idempotencyKey:id});
 const productDraft=(skc,sku)=>({name:"合成来源档案 "+sku,platformSkc:skc,variants:[{platformSku:sku}]});
 const tables=()=>Promise.all(db.tables.map(table=>table.toArray()));
 it("rejects an unrelated visible product used as the source of another confirmed SKC",async()=>{
   const {product:first}=await saveProductCatalogRecord({draft:productDraft("SKC-A","SKU-A")});
   await saveProductCatalogRecord({draft:productDraft("SKC-B","SKU-B")});
   const before=await tables();
   await expect(saveErpCatalogRequest(request("SOURCE-WRONG-SKC",[{platformSku:"SKU-B",platformSkc:"SKC-B"}],[first.id]))).rejects.toThrow("来源");
   expect(await tables()).toEqual(before);
 });
 it("requires the declared source product to carry at least one declared confirmed SKU",async()=>{
   const {product:first}=await saveProductCatalogRecord({draft:productDraft("SKC-SHARED","SKU-A")});
   const {product:second}=await saveProductCatalogRecord({draft:productDraft("SKC-SHARED","SKU-B")});
   const before=await tables();
   await expect(saveErpCatalogRequest(request("SOURCE-WRONG-SKU",[{platformSku:"SKU-A",platformSkc:"SKC-SHARED"}],[second.id]))).rejects.toThrow("来源");
   expect(await tables()).toEqual(before);
   await expect(saveErpCatalogRequest(request("SOURCE-CORRECT-SKU",[{platformSku:"SKU-A",platformSkc:"SKC-SHARED"}],[first.id]))).resolves.toMatchObject({sourceProductIds:[first.id]});
 });
 it("requires every target SKC to be covered by the selected product sources when no original cost request is used",async()=>{
   const {product:first}=await saveProductCatalogRecord({draft:productDraft("SKC-A","SKU-A")});
   await saveProductCatalogRecord({draft:productDraft("SKC-B","SKU-B")});
   const before=await tables();
   await expect(saveErpCatalogRequest(request("SOURCE-PARTIAL",[{platformSku:"SKU-A",platformSkc:"SKC-A"},{platformSku:"SKU-B",platformSkc:"SKC-B"}],[first.id]))).rejects.toThrow("来源");
   expect(await tables()).toEqual(before);
 });
 it("rejects request creation from a private product invisible to the current member",async()=>{
   const {product}=await saveProductCatalogRecord({draft:{...productDraft("SKC-PRIVATE","SKU-PRIVATE"),visibility:"private",ownerId:"OWNER"}});
   await setActiveMemberContext({workspaceId:workspace,memberId:"OTHER-MEMBER",role:"selection"});
   const before=await tables();
   await expect(saveErpCatalogRequest(request("SOURCE-PRIVATE",[{platformSku:"SKU-PRIVATE",platformSkc:"SKC-PRIVATE"}],[product.id]))).rejects.toThrow();
   expect(await tables()).toEqual(before);
 });
});

describe("0.3.3 durable cost inbox catalog binding",()=>{
 it("reads blocked-adoption metadata only through a valid current workspace, original request, delivery and ledger chain",async()=>{
   const {product}=await saveProductCatalogRecord({draft:{name:"合成收件档案",platformSkc:"SKC-INBOX",variants:[{platformSku:"SKU-INBOX"}]}});
   const ledger={id:"INBOX-LEDGER",workspaceId:workspace,period:"2026-08",status:"cost_pending"};
   await db.ledgers.put(ledger);
   const expectedSkus=[{platformSku:"SKU-INBOX",platformSkc:"SKC-INBOX"}];
   const request=buildErpCostRequest({id:"INBOX-REQUEST",workspaceId:workspace,ledgerId:ledger.id,ledgerPeriod:ledger.period,platformSkcs:["SKC-INBOX"],expectedSkus,requestedBy:"local-user",requestedAt:"2026-09-29T00:00:00.000Z"});
   await db.erpCostRequests.put(request);
   const batch=buildErpCostBatchEnvelope({batchId:"INBOX-BATCH",workspaceId:workspace,ledgerId:ledger.id,requestId:request.id,platformSkcs:["SKC-INBOX"],expectedSkus,
     results:[{warehouseSku:"WH-INBOX",mappings:[{...expectedSkus[0],attribute:"明确属性"},{platformSku:"SKU-UNSOLD-INBOX",platformSkc:"SKC-INBOX",attribute:"未售属性"}],previewUnitCost:3}],
     warehouseEvidence:[{warehouseSku:"WH-INBOX",evidenceComplete:false,purchaseRecords:[{recordId:"INBOX-PURCHASE",purchaseDate:"2026-08-28",quantity:1,unitPrice:3}]}]});
   const envelope=buildErpCostInboxEnvelope({batch,deliveryId:"INBOX-DELIVERY"});
   const inbox={id:"INBOX-RECORD",workspaceId:workspace,ledgerId:ledger.id,requestId:request.id,batchId:batch.batchId,deliveryId:envelope.deliveryId,status:"pending",receivedAt:envelope.sentAt,adoption:{status:"blocked"},envelope};
   await db.erpCostInbox.put(inbox);
   const before=await Promise.all(db.tables.map(table=>table.toArray()));
   const rows=buildSelectionReferenceRows(await getSelectionReferenceSnapshot());
   expect(rows.find(row=>row.platformSku==="SKU-UNSOLD-INBOX")).toMatchObject({platformSkc:"SKC-INBOX",referenceUnitCost:null,productId:null});
   expect(await Promise.all(db.tables.map(table=>table.toArray()))).toEqual(before);
   for(const mutation of [{workspaceId:"FOREIGN"},{ledgerId:"MISSING"},{requestId:"MISSING"},{batchId:"OTHER-BATCH"},{deliveryId:"OTHER-DELIVERY"},{status:"rejected"}]){
     await db.erpCostInbox.put({...inbox,...mutation});
     expect((await getSelectionReferenceSnapshot()).erpCatalogRows).toEqual([]);
   }
   await db.erpCostInbox.put(inbox);
   for(const mutation of [{ledgerPeriod:"2026-09"},{status:"cancelled"},{platformSkcs:["OTHER-SKC"]}]){
     await db.erpCostRequests.put({...request,...mutation});
     expect((await getSelectionReferenceSnapshot()).erpCatalogRows).toEqual([]);
   }
   await db.erpCostRequests.put(request);
   await db.products.update(product.id,{visibility:"private",ownerId:"OWNER"});
   await setActiveMemberContext({workspaceId:workspace,memberId:"OTHER-MEMBER",role:"selection"});
   expect((await getSelectionReferenceSnapshot()).erpCatalogRows).toEqual([]);
   expect(await db.erpCostRows.count()).toBe(0);expect(await db.erpCostBatches.count()).toBe(0);expect(await db.profitLines.count()).toBe(0);
 });
});
