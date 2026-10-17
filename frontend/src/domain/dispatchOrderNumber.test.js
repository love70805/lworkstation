import { expect, it } from 'vitest';
import { dispatchOrderNumberForExport } from './dispatchOrderNumber';
import { inspectSupplementSource, suggestSupplementMapping } from './monthlySupplements';

it.each(['1688', '1688单号', '1688订单号', ' １６８８\n '])('recognizes the exact source header %s and keeps long identifiers as text', header => {
  const headers = ['登记人', '订单号', '数量', header];
  expect(suggestSupplementMapping(headers).order1688).toBe('3');
  const result = inspectSupplementSource({sheetName:'来源',sourceFormat:'xlsx',cells:[headers,['人员','O',2,'0003316999476150011698']]},{kind:'dispatch',includeAll:true});
  expect(result.rows[0]).toMatchObject({order1688:'0003316999476150011698',quantityExact:'2'});
  expect(result.rows[0].remarks).toEqual([]);
});
it('recovers only an unambiguous same-row numeric text identifier and prefers explicit mapped values', () => {
  const remarks = [{header:'1688',value:'0003316999476150011698'}];
  expect(dispatchOrderNumberForExport({order1688:'',remarks})).toBe('0003316999476150011698');
  expect(dispatchOrderNumberForExport({order1688:'EXPLICIT',remarks})).toBe('EXPLICIT');
  expect(dispatchOrderNumberForExport({remarks:[...remarks,{header:'1688单号',value:'999'}]})).toBe('');
  for (const value of [3.3e18,'3.3e18','备注','',null]) expect(dispatchOrderNumberForExport({remarks:[{header:'1688',value}]})).toBe('');
  expect(dispatchOrderNumberForExport({remarks:[{header:'网供名字',value:'3316999476150011698'}]})).toBe('');
});
