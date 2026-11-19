import { expect, it } from 'vitest';
import { packProfitSaleGroups,prepareProfitPageSales,unpackProfitSaleGroups } from './profitPageSales';
import { buildReportProducts } from './profitReports';
import { calculateLedgerCostCoverage } from './costCoverage';
import { computeDerived } from '../workers/derivedComputations';
import { presentReportProducts } from '../lib/profitPresentation';

const ledger = {id:'L',workspaceId:'W',period:'2026-10',warehouseRate:'0.17'};
const source = {workspaceId:'W',ledgerId:'L',store:'甲',platformSku:'SKU',platformSkc:'A',supplierNumber:'S',
  quantity:2,quantityExact:'2',amount:12.34,amountExact:'12.345678901234567891',sourceSheet:'销售',batchId:'B'};
it('uses exact original sales totals, attributes, references and parent conflicts for every store',()=>{
  const rows=[{...source,id:1,sourceRow:2,order1688:'采购1',hasDirectUnitCost:true,directUnitCost:3.256},
    {...source,id:2,sourceRow:4,store:'乙',amountExact:'-0.85',quantityExact:'-1'},
    {...source,id:3,sourceRow:9,hasDirectUnitCost:true,directUnitCost:2.579},
    {...source,id:4,platformSku:'sku',platformSkc:'a',attribute:'红'},
    {...source,id:5,platformSkc:'B',movementType:'盘亏'}];
  const args={ ledger,salesRows:rows,approvals:[],erpCosts:[],allowMissing:true };
  const facts=prepareProfitPageSales(rows);
  const page=unpackProfitSaleGroups(structuredClone(packProfitSaleGroups(facts)));
  expect(page).toStrictEqual(facts);
  const raw=computeDerived('profit-page',args);
  const visible=computeDerived('profit-page',{...args,salesRows:page.rows,pageGroups:page.groups});
  expect(visible).toEqual(raw);
  expect(visible.find(r=>r.sourceRowCount===2)).toMatchObject({ revenueExact:'24.691357802469135782',sourceRows:[{id:1,sourceRow:2}],costIdentityIssue:{code:'ledger_sku_skc_conflict'} });
  expect(presentReportProducts(visible,{ledger,rows:page.rows,pageSales:page})).toEqual(presentReportProducts(raw,{ledger,rows}));
  expect(presentReportProducts(visible,{ledger,rows:page.rows,pageSales:page}).find(r=>r.sourceRowCount===2).reference1688Cost).toEqual({unitCost:2.57,orderNumber:'采购1'});
  expect(calculateLedgerCostCoverage({...args,salesRows:page.rows})).toEqual(calculateLedgerCostCoverage(args));
  // Export always builds from the original rows and keeps all references.
  expect(buildReportProducts({...args,pageGroups:[]}).find(r=>r.sourceRows.length===2).sourceRows.map(r=>r.id)).toEqual([1,3]);
});
it.each([{amountExact:'broken'},{isDeduction:true},{movementType:'盘亏'}])('preserves the original report error for %j',patch=>{
  const rows=[{...source,id:1,...patch}];
  const view=prepareProfitPageSales(rows);
  expect(view.lines).toHaveLength(1);
  expect(()=>buildReportProducts({ledger,salesRows:rows,erpCosts:[],approvals:[],allowMissing:true})).toThrow(view.reportError);
});
