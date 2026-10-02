import { expect, it } from "vitest";
import { compactSalesImportPlan, effectiveImportOptions, getSalesImportReplacementRows, planSalesImports, prepareSalesImportItems } from "./batchSalesImport";
import { createLedgerGroupKey, createLedgerSkuKey } from "./ledgerImport";
import { createSalesSourceCoverage } from "./selectionSalesLabels";
const sale = (skc, store="甲店") => { const row={store,platformSkc:skc,platformSku:`SKU-${skc}`,quantity:1,amount:1}; return {...row,groupKey:createLedgerGroupKey(row),skuKey:createLedgerSkuKey(row)}; };
const file = (patch={}) => ({itemId:"I",fileName:"synthetic.csv",fileHash:"H",storeName:"甲店",mapping:{platformSku:"SKU",platformSkc:"SKC"},rows:[sale("NEW")],summary:{errorCount:0,sourceRowCount:1},sourceCoverage:createSalesSourceCoverage({period:"2026-08",storeName:"甲店"}),...patch});
it('classifies legacy raw timestamp evidence against the requested new ledger month', async () => {
 const item = file({sourceCoverage:null, rows:[{...sale('NEW'),rawAddedAt:'2026-09-01 12:00:00'}]});
 const plan = await planSalesImports({existingRows:[], batches:[], items:[item], ledgerId:'L', period:'2026-08'});
 expect(plan.items[0].dateEvidence).toMatchObject({outOfPeriodRowCount:1, validDateRowCount:0});
});
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
it("requires full declared coverage for an explicit store-month replacement",async()=>{
 expect(()=>prepareSalesImportItems([file({importMode:"replace_store_month",sourceCoverage:null})])).toThrow();
 expect(()=>prepareSalesImportItems([file({importMode:"replace_store_month",sourceCoverage:createSalesSourceCoverage({period:"2026-08",storeName:"甲店",scope:"partial"})})])).toThrow();
});
it("previews absent old groups as removed only during an explicit store-month replacement",async()=>{
 const rows=[sale("NEW"),sale("REMOVED"),sale("OTHER","乙店")], incoming=file({importMode:"replace_store_month"});
 expect(getSalesImportReplacementRows(rows,[incoming])).toEqual(rows.slice(0,2));
 const plan=await planSalesImports({existingRows:rows,batches:[],items:[incoming],ledgerId:"L"});
 expect(plan.items[0]).toMatchObject({replacementScope:"store_month",removedGroupCount:1,replacedGroupCount:1});
 expect(plan.items[0].overlaps.find(group=>group.platformSkc==="REMOVED")).toMatchObject({removed:true,after:{rowCount:0,quantity:0}});
 expect(plan.requiresOverwrite).toBe(true);expect(plan.finalSummary.quantity).toBe(2);
});

it("does not skip an explicit whole-month replacement when unrelated appended groups changed its target",async()=>{
 const incoming=file({importMode:"replace_store_month"});
 const persisted=incoming.rows.map(row=>({...row,batchId:"B"}));
 const batch={...incoming,id:"B",store:incoming.storeName,status:"completed",validRowCount:incoming.rows.length};
 const plan=await planSalesImports({existingRows:[...persisted,sale("ADDED")],batches:[batch],items:[incoming],ledgerId:"L"});
 expect(plan.items[0]).toMatchObject({status:"ready",removedGroupCount:1});
 expect(plan.finalSummary.quantity).toBe(1);
});

it('uses bounded cryptographic snapshots that still detect an interior row change across chunks',async()=>{
 const incoming=file({rows:Array.from({length:300},(_,index)=>sale('G'+index))});
 const before=await planSalesImports({existingRows:[],batches:[],items:[incoming],ledgerId:'L'});
 expect(before.inputSignature).toMatch(/^[a-f0-9]{64}$/);
 incoming.rows[129].amount=2;
 const after=await planSalesImports({existingRows:[],batches:[],items:[incoming],ledgerId:'L'});
 expect(after.inputSignature).not.toBe(before.inputSignature);
 expect(after.targetSignature).toBe(before.targetSignature);
});

it('produces exactly the full-source plan after releasing source objects, including duplicates and changed raw fields', async () => {
 const rows = Array.from({length:270},(_,i)=>({...sale('G'+(i%7)),id:'R'+i,batchId:'B',sourceRow:i+2,sourceAddedDate:'2026-08-02',rawAddedAt:'2026-08-02 23:59:59',quantity:0.000019,amount:0.019,orderId:'000000000000000000000000'+i,raw:{detail:'unchanged-'+i}}));
 rows[20] = {...rows[20],isDeduction:true,deductionAmount:0.019};
 rows[40] = {...rows[40],hasDirectPenalty:true,directPenalty:0.019,hasDirectUnitCost:true,directUnitCost:0.001};
 const incoming = file({rows:rows.map(({id,batchId,...row})=>row)});
 const batch = {...incoming,rows:undefined,id:'B',store:incoming.storeName,status:'completed',validRowCount:rows.length};
 for (const mode of ['append','replace_store_month']) for (const changed of [false,true]) {
  const item = structuredClone({...incoming,importMode:mode});
  if(changed) item.rows[129].raw.detail = 'changed-original-value';
  const input = {ledger:{period:'2026-08'},existingRows:[...rows,{...sale('RETAIN'),id:'retained',batchId:'OLD'}],batches:[{...batch,importMode:mode}],items:[item],ledgerId:'L',period:'2026-08'};
  const full = await planSalesImports(input);
  expect(await compactSalesImportPlan(structuredClone(input),async source=>source)).toEqual(full);
  expect(full.items[0].status).toBe(!changed && mode==='append' ? 'skipped_duplicate' : 'ready');
 }
});
