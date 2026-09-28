import {expect,it} from 'vitest';
import {inspectSupplementSource,normalizeSupplementCandidate,suggestSupplementMapping,suggestSupplementStore} from './monthlySupplements';
const headers=['日期','登记人','店铺','skc','订单号','sku数量','特殊情况','1688订单号','网供名字',''];
const source=cells=>({fileHash:'HASH',fileName:'synthetic.csv',sheetName:'CSV',headerRow:1,cells:[headers,...cells]});
const context={ledger:{id:'L',workspaceId:'W',period:'2026-08'},stores:['甲']};
const candidate=(kind,rows,extra={})=>normalizeSupplementCandidate({kind,ledgerId:'L',workspaceId:'W',period:'2026-08',mode:'files',rows,...extra},context);
it('suggests only a unique same-number store alias without removing supplier/channel prefixes',()=>{
 expect(suggestSupplementStore('680',['680店','20店'])).toBe('680店');
 expect(suggestSupplementStore('sh20',['20店'])).toBe('');
 expect(suggestSupplementStore('680',['680店',' 680店 '])).toBe('');
 expect(suggestSupplementStore('680',['680','680店'])).toBe('680');
 const s={fileHash:'F',fileName:'test.xlsx',sheetName:'680',cells:[['店铺','货号','扣款金额'],['680','C',1]]};
 expect(inspectSupplementSource(s,{kind:'deduction',ownerMarker:'C',stores:['680店']}).rows[0]).toMatchObject({store:'680店',originalStore:'680'});
});
it('matches trimmed registrant names exactly and retains all remarks and source quantities',()=>{
 const result=inspectSupplementSource(source([
  ['8/1',' 李一 ','甲','SKC','00001',2,'不发','00000000000000000001','供方','退款备注'],
  ['','','','','00002',3,'引流','','','尾列备注'],
  ['8/1','李一一','甲','OTHER','00003',10,'退款'],
 ]),{kind:'dispatch',ownerMarker:'李一'});
 expect(result.errors).toEqual([]);expect(result.rows).toHaveLength(2);
 expect(result.rows[1]).toMatchObject({ownerMarker:'李一',store:'甲',platformSkc:'SKC',order1688:'00000000000000000001',inheritedFrom:2,inheritedIdentifiers:{platformSkc:2,order1688:2},quantityExact:'3'});
 expect(result.rows[1].remarks.map(row=>row.value)).toEqual(['引流','尾列备注']);
 expect(candidate('dispatch',result.rows,{adoptedQuantityExact:'99'}).adoptedQuantityExact).toBe('5');
});
it('resets identity inheritance at changes of SKC, owner, date, store and blank separators',()=>{
 const result=inspectSupplementSource(source([
  ['8/1','甲人','甲','S1','O1',1,'','P1'],
  ['','','','','O2',1,'','P2'],
  ['','','','S2','O3',1],
  ['','','','','O4',1],
  ['8/2','','','','O5',1],
  ['8/2','甲人','甲','S3','O6',1,'','P3'],
  [],['','','','','O7',1],
  ['8/2','乙人','甲','','O8',1],
  ['','','乙','','O9',1],
 ]),{kind:'dispatch',includeAll:true});
 expect(result.errors.map(row=>row.sourceRow)).toEqual([6,9]);
 expect(result.rows.map(row=>[row.businessId,row.platformSkc,row.order1688])).toEqual([['O1','S1','P1'],['O2','S1','P2'],['O3','S2',''],['O4','S2',''],['O6','S3','P3'],['O8','',''],['O9','','']]);
});
it.each(['扣款金额','金额','分摊金额','运费金额','分摊后运费'])('reads %s by supplier code with exact sign and traceable classification',header=>{
 const s={...source([]),sheetName:'甲',cells:[['补扣款单号','SKC','货号',header,'分类'],['00001','S','CODE-X','-4.1525','运费']]};
 const result=inspectSupplementSource(s,{kind:'deduction',ownerMarker:'CODE-X',store:'甲'});
 expect(result.rows[0]).toMatchObject({signedAmountExact:'-4.1525',amountHeader:header,remarks:[{column:5,header:'分类',value:'运费'}]});
 expect(inspectSupplementSource(s,{kind:'deduction',ownerMarker:'X',store:'甲'}).rows).toHaveLength(0);
 expect(inspectSupplementSource(s,{kind:'deduction',ownerMarker:'X',matchMode:'contains',store:'甲'}).rows).toHaveLength(1);
});
it('selects allocated amounts before source totals without adding semantic columns twice',()=>{
 expect(suggestSupplementMapping(['金额','运费金额','扣款金额','分摊金额','分摊后运费']).amount).toBe('4');
 expect(suggestSupplementMapping(['数量','sku数量']).quantity).toBe('1');
});
it('preserves equal legitimate allocations, rejects duplicate coordinates, and reports cross-file overlaps',()=>{
 const row={kind:'deduction',fileHash:'H',sourceSheet:'甲',sourceRow:2,store:'甲',businessId:'0001',platformSkc:'S',supplierNumber:'C',signedAmountExact:'0.899'};
 const rows=[row,{...row,sourceRow:3}];
 expect(candidate('deduction',rows).signedAmountExact).toBe('1.798');
 expect(()=>candidate('deduction',[row,row])).toThrow('重复源行');
 const review=candidate('deduction',[...rows,{...row,fileHash:'other'}]);
 expect(review.rows).toHaveLength(3);expect(review.conflicts).toHaveLength(1);
 expect(review.reviewedCrossFileConflicts).toBe(false);
});
it.each(['-1','1.5'])('flags invalid dispatch quantity %s',value=>{
 const result=inspectSupplementSource(source([['8/1','甲人','甲','S','O',value]]),{kind:'dispatch',ownerMarker:'甲人'});
 expect(result.errors).toHaveLength(1);expect(result.rows).toHaveLength(0);
});
