import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { productArchiveRows } from './productArchiveImport';
import { projectProductArchiveRows } from '../domain/productArchive';

it('reads real cells despite a broken dimension, extracts literal IMAGE URLs and ignores prices and truncated mapping fragments', () => {
  const sheet=XLSX.utils.aoa_to_sheet([['图片链接','商品ID','商品名称','商品颜色','采购单价','平台SKU片段','1688链接片段'],
    ['', 'WH-A','商品甲','红色',999,'X'.repeat(1024),'https://detail.1688.com/offer/900000000001.html']]);
  sheet.A2={t:'s',f:'_xlfn.IMAGE("https://example.com/product.jpg")'};
  sheet['!ref']='A1:A1';
  const rows=productArchiveRows(sheet,XLSX);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({warehouseSku:'WH-A',productName:'商品甲',imageUrl:'https://example.com/product.jpg'});
  expect(rows[0]).not.toHaveProperty('unitCost'); expect(rows[0]).not.toHaveProperty('platformSku');
  const matched=projectProductArchiveRows({workspaceId:'W',archives:[{workspaceId:'W',rows}],products:[{id:'P',workspaceId:'W'}],
    platformSkus:[{productId:'P',workspaceId:'W',platformSku:'SKU-A',platformSkc:'SKC',warehouseSku:'WH-A'}]});
  expect(matched.rows.map(row=>row.platformSku)).toEqual(['SKU-A']);
  expect(matched.rows[0]).not.toHaveProperty('unitCost');
});
it('does not evaluate formula URLs or trust numeric identifiers, conflicting exports or unknown warehouses', () => {
  const sheet=XLSX.utils.aoa_to_sheet([['商品ID','商品名称','图片链接'],['WH','商品','']]);
  sheet.C2={t:'s',f:'HYPERLINK("javascript:alert(1)")'};
  expect(productArchiveRows(sheet,XLSX)[0].imageUrl).toBe('');
  sheet.A2={t:'n',v:123}; expect(()=>productArchiveRows(sheet,XLSX)).toThrow('数值');
  const conflicted=XLSX.utils.aoa_to_sheet([['商品ID','商品名称'],['WH','甲'],['WH','乙']]);
  expect(()=>productArchiveRows(conflicted,XLSX)).toThrow('冲突');
  expect(projectProductArchiveRows({workspaceId:'W',archives:[{workspaceId:'W',rows:[{warehouseSku:'WH'}]}]}).unmatched).toEqual(['WH']);
});
it('keeps conflicting, foreign or unpublished financial identities out of metadata matching', () => {
  const row={platformSku:'S',platformSkc:'K',warehouseSku:'WH',workspaceId:'W',batchId:'B',evidenceComplete:true};
  const base={workspaceId:'W',archives:[{workspaceId:'W',rows:[{warehouseSku:'WH',productName:'甲'}]}],erpBatches:[{id:'B',workspaceId:'W',status:'published'}]};
  expect(projectProductArchiveRows({...base,erpCosts:[row]}).rows).toHaveLength(1);
  expect(projectProductArchiveRows({...base,erpCosts:[row,{...row,warehouseSku:'CONFLICT'}]}).rows).toEqual([]);
  expect(projectProductArchiveRows({...base,erpCosts:[{...row,workspaceId:'OTHER'}]}).rows).toEqual([]);
  expect(projectProductArchiveRows({...base,erpBatches:[],erpCosts:[row]}).rows).toEqual([]);
});
