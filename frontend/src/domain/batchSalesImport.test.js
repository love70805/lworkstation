import { expect, it } from "vitest";
import { effectiveImportOptions, getSalesImportReplacementRows, planSalesImports, prepareSalesImportItems } from "./batchSalesImport";
import { createLedgerGroupKey, createLedgerSkuKey } from "./ledgerImport";
import { createSalesSourceCoverage } from "./selectionSalesLabels";
const sale = (skc, store="甲店") => { const row={store,platformSkc:skc,platformSku:`SKU-${skc}`,quantity:1,amount:1}; return {...row,groupKey:createLedgerGroupKey(row),skuKey:createLedgerSkuKey(row)}; };
const file = (patch={}) => ({itemId:"I",fileName:"synthetic.csv",fileHash:"H",storeName:"甲店",mapping:{platformSku:"SKU",platformSkc:"SKC"},rows:[sale("NEW")],summary:{errorCount:0,sourceRowCount:1},sourceCoverage:createSalesSourceCoverage({period:"2026-08",storeName:"甲店"}),...patch});
it("normalizes declared coverage and keeps legacy imports unknown",()=>{
 expect(prepareSalesImportItems([file()],{period:"2026-08"})[0].sourceCoverage.scope).toBe("full_month");
 expect(prepareSalesImportItems([file({sourceCoverage:undefined})])[0].sourceCoverage).toBeNull();
 for(const patch of [{period:"2026-07"},{store:"乙店"},{version:2}]) expect(()=>prepareSalesImportItems([file({sourceCoverage:{...file().sourceCoverage,...patch}})],{period:"2026-08"})).toThrow();
});
it("binds completeness and replace mode into import idempotency and input signatures",()=>{
 expect(effectiveImportOptions(file())).not.toEqual(effectiveImportOptions(file({sourceCoverage:createSalesSourceCoverage({period:"2026-08",storeName:"甲店",scope:"partial"})})));
 expect(effectiveImportOptions(file())).not.toEqual(effectiveImportOptions(file({importMode:"replace_store_month"})));
});
it("does not expand deletion scope merely because an import declares a complete month",()=>{
 const rows=[sale("NEW"),sale("RETAIN"),sale("OTHER","乙店")];
 expect(getSalesImportReplacementRows(rows,[file()])).toEqual([rows[0]]);
});
it("requires full declared coverage for an explicit store-month replacement",()=>{
 expect(()=>prepareSalesImportItems([file({importMode:"replace_store_month",sourceCoverage:null})])).toThrow();
 expect(()=>prepareSalesImportItems([file({importMode:"replace_store_month",sourceCoverage:createSalesSourceCoverage({period:"2026-08",storeName:"甲店",scope:"partial"})})])).toThrow();
});
it("previews absent old groups as removed only during an explicit store-month replacement",()=>{
 const rows=[sale("NEW"),sale("REMOVED"),sale("OTHER","乙店")], incoming=file({importMode:"replace_store_month"});
 expect(getSalesImportReplacementRows(rows,[incoming])).toEqual(rows.slice(0,2));
 const plan=planSalesImports({existingRows:rows,batches:[],items:[incoming],ledgerId:"L"});
 expect(plan.items[0]).toMatchObject({replacementScope:"store_month",removedGroupCount:1,replacedGroupCount:1});
 expect(plan.items[0].overlaps.find(group=>group.platformSkc==="REMOVED")).toMatchObject({removed:true,after:{rowCount:0,quantity:0}});
 expect(plan.requiresOverwrite).toBe(true);expect(plan.finalSummary.quantity).toBe(2);
});

it("does not skip an explicit whole-month replacement when unrelated appended groups changed its target",()=>{
 const incoming=file({importMode:"replace_store_month"});
 const persisted=incoming.rows.map(row=>({...row,batchId:"B"}));
 const batch={...incoming,id:"B",store:incoming.storeName,status:"completed",validRowCount:incoming.rows.length};
 const plan=planSalesImports({existingRows:[...persisted,sale("ADDED")],batches:[batch],items:[incoming],ledgerId:"L"});
 expect(plan.items[0]).toMatchObject({status:"ready",removedGroupCount:1});
 expect(plan.finalSummary.quantity).toBe(1);
});
