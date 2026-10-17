import { expect,it } from 'vitest';
import { recoverDispatchOrdersFromSources } from './dispatchOrderRecovery';
const source={fileHash:'ORIGINAL',fileName:'原表.xlsx',sheetName:'来源',sourceFormat:'xlsx',headerRow:1,sourceRows:[1,2,3,4],cells:[['登记人','SKC','订单号','数量','1688'],['人员','A','O1',2,'0003316999476150011698'],['人员','B','O2',3,''],['人员','C','O3',4,'']],merges:[{s:{r:1,c:4},e:{r:2,c:4}}]};
const row={fileHash:'ORIGINAL',sourceSheet:'来源',sourceRow:3,platformSkc:'B',businessId:'O2',quantityExact:'3',order1688:''};
it('recovers a missing merged order from the exact original file and row without changing the frozen record',()=>{
 const frozen=Object.freeze({...row}),result=recoverDispatchOrdersFromSources([frozen],[source]);
 expect(result).toEqual([{...row,order1688:'0003316999476150011698'}]);expect(frozen.order1688).toBe('');
 expect(recoverDispatchOrdersFromSources([{...row,sourceRow:4,platformSkc:'C',businessId:'O3',quantityExact:'4'}],[source])[0].order1688).toBe('');
 expect(recoverDispatchOrdersFromSources([{...row,order1688:'PRESERVED'}],[source])[0].order1688).toBe('PRESERVED');
});
it('refuses a different file, stale identities, wrong quantities and imprecise numeric orders',()=>{
 expect(()=>recoverDispatchOrdersFromSources([row],[{...source,fileHash:'CHANGED'}])).toThrow('原始来源不一致');
 for(const patch of [{platformSkc:'OTHER'},{businessId:'OTHER'},{quantityExact:'9'}])expect(()=>recoverDispatchOrdersFromSources([{...row,...patch}],[source])).toThrow('冻结记录不一致');
 const numeric={...source,cells:source.cells.map((values,i)=>i===1?[...values.slice(0,4),3316999476150011698]:values)};
 expect(()=>recoverDispatchOrdersFromSources([row],[numeric])).toThrow('丢失精度');
});
