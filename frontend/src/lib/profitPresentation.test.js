import { expect, it } from 'vitest';
import { buildReportProducts } from '../domain/profitReports';
import { presentReportProducts } from './profitPresentation';
it('keeps the last explicitly supplied reference without treating it as formal cost',()=>{
 const ledger={id:'L',workspaceId:'W',warehouseRate:'0.7'};
 const base={store:'甲',platformSkc:'S',platformSku:'SKU',quantity:1,amount:10};
 const rows=[{...base,id:'1',hasDirectUnitCost:false,order1688:'ORDER'},{...base,id:'2',hasDirectUnitCost:true,directUnitCost:3.239}];
 const snapshot={ledger,rows,costs:[],approvals:[]};
 const products=buildReportProducts({ledger,salesRows:rows,erpCosts:[],approvals:[],allowMissing:true});
 const [shown]=presentReportProducts(products,snapshot);
 expect(shown.reference1688Cost).toEqual({unitCost:3.23,orderNumber:'ORDER'});
 expect(shown.unitCost).toBeNull();expect(shown.finalizable).toBe(false);
 expect(shown.revenueExact).toBe('20');
});
