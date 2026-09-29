import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it } from "vitest";
import { db, DEFAULT_WORKSPACE_ID, previewSalesImports, saveSalesImports, createWorkspaceBackupPayload, restoreWorkspaceBackupPayload } from "./database";
import { validateSalesRows } from "../lib/salesImport";
import { buildSelectionSalesLabels, createSalesSourceCoverage } from "../domain/selectionSalesLabels";

const mapping={platformSku:"SKU",platformSkc:"SKC",quantity:"数量",amount:"金额",sourceAddedAt:"添加时间"};
const file=(month="2026-08", options={})=>{
 const raw=options.raw??[{SKU:"SYN-SKU-A",SKC:"SYN-SKC-A",数量:100,金额:300,添加时间:`${month}-29`}];
 const validated=validateSalesRows(raw,mapping,{defaultStore:"合成甲店",period:month});
 return {itemId:"A",fileName:"synthetic-ledger.csv",fileHash:`hash-${month}-${options.hash??"A"}`,storeName:"合成甲店",mapping,sourceCoverage:createSalesSourceCoverage({period:month,storeName:"合成甲店"}),rows:validated.rows,summary:{sourceRowCount:raw.length,errorCount:validated.errors.length,ignoredCount:validated.ignored.length},...options};
};
const commit=async(month, items)=>{const input={period:month,items};const preview=await previewSalesImports(input);return saveSalesImports({...input,preview,overwriteSignature:preview.targetSignature});};
const project=async()=>buildSelectionSalesLabels({workspaceId:DEFAULT_WORKSPACE_ID,salesRows:await db.salesRows.toArray(),importBatches:await db.importBatches.toArray(),ledgers:await db.ledgers.toArray(),products:await db.products.toArray(),productSkus:await db.platformSkus.toArray()});
beforeEach(async()=>{await db.delete();await db.open();});
afterEach(async()=>{db.close();await db.delete();});

it("persists full source range independently of row dates and keeps latest bad-date month", async()=>{
 await commit("2026-08",[file()]);
 await commit("2026-09",[file("2026-09",{raw:[{SKU:"SYN-SKU-A",SKC:"SYN-SKC-A",数量:300,金额:900,添加时间:""}]})]);
 const batch=(await db.importBatches.toArray()).find(row=>row.period==="2026-09");
 expect(batch.sourceCoverage).toMatchObject({version:1,scope:"full_month",period:"2026-09"});
 expect(batch.dateEvidence).toMatchObject({status:"missing",salesRowCount:1,missingDateRowCount:1,validDateRowCount:0});
 expect(await project()).toMatchObject({period:"2026-09",endDate:"2026-09-30",items:[{label:null,reason:"missing_dates",monthQuantityExact:"300"}]});
});
it("recomputes after a duplicate, explicit whole-month replacement, withdrawal and restart without touching costs or manual tags", async()=>{
 const initial=file("2026-08",{raw:[{SKU:"SYN-SKU-A",SKC:"SYN-SKC-A",数量:100,金额:300,添加时间:"2026-08-29"},{SKU:"SYN-SKU-B",SKC:"SYN-SKC-B",数量:10,金额:40,添加时间:"2026-08-31"}]});
 await commit("2026-08",[initial]);
 await db.products.put({id:"SYN-P",workspaceId:DEFAULT_WORKSPACE_ID,platformSkc:"SYN-SKC-A",name:"合成档案",tags:["人工重点"],status:"active"});
 const beforeProduct=await db.products.get("SYN-P");
 const duplicate=await commit("2026-08",[initial]);expect(duplicate.items[0].status).toBe("skipped_duplicate");
 expect((await project()).items.find(row=>row.platformSkc==="SYN-SKC-A").quantityExact).toBe("100");
 const replacement=file("2026-08",{hash:"replacement",importMode:"replace_store_month",raw:[{SKU:"SYN-SKU-A",SKC:"SYN-SKC-A",数量:700,金额:2100,添加时间:"2026-08-25"}]});
 const result=await commit("2026-08",[replacement]);expect(result.items[0].removedGroupCount).toBe(1);
 expect(await db.salesRows.count()).toBe(1);
 expect((await project()).items.find(row=>row.platformSkc==="SYN-SKC-A")).toMatchObject({label:"爆款",quantityExact:"700"});
 const backup=await createWorkspaceBackupPayload();await restoreWorkspaceBackupPayload(backup);
 db.close();await db.open();
 expect((await project()).items.find(row=>row.platformSkc==="SYN-SKC-A").label).toBe("爆款");
 expect(await db.products.get("SYN-P")).toEqual(beforeProduct);
 expect(await db.erpCostRows.count()).toBe(0);expect(await db.profitLines.count()).toBe(0);
 await db.importBatches.update(result.items[0].batchId,{status:"withdrawn"});
 expect((await project()).status).toBe("no_complete_month");
});
it("rejects a complete-label projection when default append retains old source groups", async()=>{
 await commit("2026-08",[file("2026-08",{raw:[{SKU:"SYN-SKU-A",SKC:"SYN-SKC-A",数量:100,金额:300,添加时间:"2026-08-29"},{SKU:"SYN-SKU-B",SKC:"SYN-SKC-B",数量:10,金额:40,添加时间:"2026-08-31"}]})]);
 await commit("2026-08",[file("2026-08",{hash:"new-file"})]);
 expect(await db.salesRows.count()).toBe(2);
 expect(await project()).toMatchObject({period:null,status:"no_complete_month"});
});
