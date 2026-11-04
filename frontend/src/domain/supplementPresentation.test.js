import {expect,it} from 'vitest';
import {adoptedSupplementOrdinal,orderSupplementPresentation} from './supplementPresentation';

const source=Array.from({length:15},(_,index)=>({id:`B:${index}`,batchId:'B',fileHash:'F',sourceSheet:index<8?'页二 ':'页一',sourceRow:index<8?20+index:index-5,businessId:`ORDER-${index}`}));
const stored=source.toSorted((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
it('restores the exact numeric adoption sequence from IndexedDB string-key order, including multiple sheets',()=>{
 expect(stored.map(row=>row.businessId)).not.toEqual(source.map(row=>row.businessId));
 const before=structuredClone(stored),ordered=orderSupplementPresentation(stored,{rememberAdoptedOrdinal:true});
 expect(ordered.map(row=>row.businessId)).toEqual(source.map(row=>row.businessId));
 expect(ordered.map(row=>row.adoptedRowOrdinal)).toEqual(source.map((_,i)=>i));
 expect(stored).toEqual(before);
 const frozen=ordered.map((row,index)=>({...row,id:`REPORT:${index}`}));
 expect(orderSupplementPresentation(frozen.toReversed()).map(row=>row.businessId)).toEqual(source.map(row=>row.businessId));
});
it('restores old frozen positions within each exact file/sheet without grouping equal values',()=>{
 const rows=[{fileHash:'F',sourceSheet:'页二 ',sourceRow:15,platformSkc:'A'},
  {fileHash:'F',sourceSheet:'页一',sourceRow:9,platformSkc:'A'},
  {fileHash:'F',sourceSheet:'页二 ',sourceRow:13,platformSkc:'B'},
  {fileHash:'F',sourceSheet:'页二 ',sourceRow:14,platformSkc:'A'},
  {fileHash:'SECOND',sourceSheet:'页二 ',sourceRow:2,platformSkc:'A'}];
 expect(orderSupplementPresentation(rows)).toEqual([rows[2],rows[3],rows[0],rows[1],rows[4]]);
 expect(rows[0].sourceRow).toBe(15);
});
it('preserves manually selected positions when adoption metadata is known and leaves unknown records independent',()=>{
 const rows=source.map((row,index)=>index===3?{id:row.id,batchId:row.batchId,manual:true,businessId:'MANUAL'}:row);
 expect(orderSupplementPresentation(rows.toReversed()).map(row=>row.businessId)).toEqual(rows.map(row=>row.businessId));
 const unknown=[{businessId:'Z'},{businessId:'A',manual:true},{businessId:'X',fileHash:'F',sourceSheet:'CSV',sourceRow:'2'}];
 expect(orderSupplementPresentation(unknown)).toEqual(unknown);
 for(const id of ['B:1oops','OTHER:2','B:-1','B:1.5','B:9007199254740992'])expect(adoptedSupplementOrdinal({id,batchId:'B'})).toBeNull();
});
