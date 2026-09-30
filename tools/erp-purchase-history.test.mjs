import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
// Observed response field names, dates, quantities, prices and status codes.
// All identities, order numbers, suppliers and unrelated fields are replaced.
const summaries = [
 ['01','2026-07-23 12:28:48','7','2'], ['02','2026-07-13 10:08:28','2','4'],
 ['03','2026-07-01 15:40:14','7','2'], ['04','2026-06-16 17:44:47','7','2'],
 ['05','2026-09-15 12:50:56','8','3'], ['06','2026-09-11 17:58:49','8','3'],
 ['07','2026-09-11 17:15:21','11','2'], ['08','2026-06-21 13:06:15','7','3'],
 ['09','2026-04-16 11:48:23','7','3'], ['10','2026-03-31 13:18:44','7',''],
 ['11','2026-03-17 18:37:13','7',''], ['12','2026-02-07 18:39:43','8',''],
 ['13','2026-02-02 17:04:09','11',''], ['14','2026-02-02 13:00:54','8','3'],
 ['15','2026-01-29 18:11:29','7',''], ['16','2025-12-27 14:49:49','8','3'],
 ['17','2025-12-15 13:33:29','7','3'], ['18','2025-11-04 13:07:35','7','3'],
 ['19','2025-11-02 13:09:46','7','3'], ['20','2025-10-16 12:42:22','7','3'],
];
const orderRows = summaries.map(([id,date,purchaseStatus,purchaseOrderStatus1688])=>({purchaseOrderId:'ORDER-'+id,purchaseOrderNo:'ORDER-'+id,purchaseTime:date,purchaseStatus,purchaseOrderStatus1688,supplierName:'脱敏供应商'}));
const detailValues = [
 ['01','WH-OTHER-1','2026-07-23 12:28:12',5,'20.9520'],['01','WH-OTHER-2','2026-07-23 12:28:12',5,'20.9520'],['01','WH-WHITE','2026-07-23 12:28:12',5,'24.0960'],
 ['02','WH-ORANGE','2026-07-13 10:07:21',10,'22.3000'],['02','WH-WHITE','2026-07-13 10:07:21',10,'25.3000'],
 ['03','WH-ORANGE','2026-07-01 15:40:07',5,'20.9620'],['03','WH-OTHER-1','2026-07-01 15:40:07',5,'20.9620'],['03','WH-OTHER-2','2026-07-01 15:40:07',5,'20.9620'],['03','WH-WHITE','2026-07-01 15:40:07',5,'24.1140'],
 ['04','WH-OTHER-1','2026-06-16 17:44:37',5,'20.9520'],['04','WH-OTHER-2','2026-06-16 17:44:37',5,'20.9520'],['04','WH-WHITE','2026-06-16 17:44:37',5,'24.0960'],
 ['05','WH-HOOK','2026-09-15 12:50:27',150,'0.1200'],['06','WH-HOOK','2026-09-11 17:58:39',150,'0.1200'],
 ['08','WH-HOOK','2026-06-21 13:06:01',500,'0.1060'],['09','WH-HOOK','2026-04-16 11:47:53',200,'0.1150'],['10','WH-HOOK','2026-03-31 13:18:36',50,'0.1150'],
 ['11','WH-HOOK','2026-03-17 18:36:39',5,'0.1150'],['12','WH-HOOK','2026-02-07 18:39:14',5,'0.1150'],['14','WH-HOOK','2026-02-02 13:00:25',200,'0.1150'],
 ['15','WH-HOOK','2026-01-29 18:11:22',5,'0.1280'],['16','WH-HOOK','2025-12-27 14:49:26',100,'0.1280'],['17','WH-HOOK','2025-12-15 13:30:59',50,'0.1560'],
 ['18','WH-HOOK','2025-11-04 13:05:38',20,'0.2400'],['19','WH-HOOK','2025-11-02 13:08:39',10,'0.3800'],['20','WH-HOOK','2025-10-16 12:39:47',10,'0.3800'],
];
const details = detailValues.map(([id,itemId,creationTime,quantity,purchaseUnitPrice],index)=>({purchaseOrderId:'ORDER-'+id,purchaseOrderNo:'ORDER-'+id,purchaseOrderDetailId:'DETAIL-'+index,itemId,creationTime,purchaseQuantity:String(quantity),purchaseUnitPrice,tradeName:'脱敏商品',supplierName:'脱敏供应商'}));
const mappings = ['ORANGE','WHITE','HOOK'].map(key=>({associatedProductId:'WH-'+key,barcodeSkuid:'SKU-'+key,barcodeSkcid:'SKC-TARGET'}));
async function replay(period, queryRange, { status = '4', paged = false, incomplete = false, emptyScope = false } = {}) {
 const window = new Window({url:'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html'});
 const messages=[],requests=[];
 window.chrome={runtime:{lastError:null,sendMessage(message,callback){messages.push(structuredClone(message));callback(message.type==='shopeers.erp.previewContext'?{ok:true,ledgerPeriod:period}:message.type==='shopeers.erp.catalogContext'?{ok:false,message:'isolated observation'}:{ok:true,status:'success',resultDeliveryId:message.payload?.resultDeliveryId});}}};
 window.fetch=async raw=>{
  const url=new URL(raw), endpoint=url.pathname.split('/').at(-1);requests.push({endpoint,params:Object.fromEntries(url.searchParams)});
  let data, count;
  if(endpoint==='purchase-order-page'){
    assert.equal(url.searchParams.get('queryRange'),'0', 'cost collection must expand the captured month to complete scoped history');
    assert.equal(url.searchParams.get('sku'),'SKC-TARGET');
    assert.equal(url.searchParams.get('storeId'),'STORE-TARGET');
    for (const field of ['createTimePeriod', 'supplierName', 'orderNo', 'purchaseStatus']) assert.equal(url.searchParams.get(field),null, 'display filters cannot truncate history');
    const orders = orderRows.map(row => row.purchaseOrderId === 'ORDER-02' ? { ...row, purchaseOrderStatus1688: status } : row);
    count = incomplete ? orders.length + 1 : orders.length;
    const page = Number(url.searchParams.get('page'));
    data = paged ? orders.slice((page - 1) * 7, page * 7) : page === 1 ? orders : [];
  }
  else if(endpoint==='purchase-order-details')data=details.filter(d=>d.purchaseOrderId===url.searchParams.get('purchaseOrderId'));
  else if(endpoint==='product-info-sku')data=mappings.filter(m=>m.associatedProductId===url.searchParams.get('productId'));
  else if(endpoint==='product-page')data=mappings.map(m=>({itemId:m.associatedProductId,tradeName:'脱敏商品'}));
  else throw new Error('Unexpected endpoint '+endpoint);
  return {ok:true,status:200,json:async()=>({code:0,count:count ?? data.length,data})};
 };
 try {
  for(const name of ['result-policy.js','catalog-collector.js','request-context.js','shopeers-bridge.js','content.js'])window.eval(await readFile(path.join(process.env.ERP_TEST_SOURCE_ROOT || path.join(root,'integrations/erp-assistant-extension/src'),name),'utf8'));
  window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured',{detail:{url:'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku='+ (emptyScope ? '' : 'SKC-TARGET') +'&storeId=STORE-TARGET&createTimePeriod=2026-09&supplierName=display-filter&orderNo=display-filter&purchaseStatus=7&queryRange='+queryRange}}));
  window.document.getElementById('erpa-cost-trigger').click();
  const until=Date.now()+8000;while(!messages.some(m=>m.type==='shopeers.erp.submitCostResult')){if(emptyScope && window.document.body.textContent.includes('采购历史缺少商品范围')) { assert.equal(requests.length,0);return { emptyScopeRejected: true }; } if(Date.now()>until)throw new Error(window.document.body.textContent);await new Promise(r=>setTimeout(r,10));}
  const payload=messages.find(m=>m.type==='shopeers.erp.submitCostResult').payload;
  return {period,queryRange,meta:payload.meta,rows:payload.results.map(r=>({warehouseSku:r.warehouseSku,unitCost:r.unitCost,previewStatus:r.previewStatus,selectedRecordIds:r.selectedRecordIds,totalQuantity:r.totalQuantity,totalPrice:r.totalPrice})),warehouseEvidence:payload.warehouseEvidence,requests};
 }finally{await window.happyDOM.close();}
}
const currentAugust=await replay('2026-08','0');
const currentSeptember=await replay('2026-09','0');

assert.equal(currentAugust.rows.find(r=>r.warehouseSku==='WH-WHITE').unitCost,'24.1020');
assert.equal(currentAugust.rows.find(r=>r.warehouseSku==='WH-ORANGE').unitCost,'20.9620');
assert.equal(currentAugust.rows.find(r=>r.warehouseSku==='WH-HOOK').unitCost,'0.1090');
assert.equal(currentSeptember.rows.find(r=>r.warehouseSku==='WH-HOOK').unitCost,'0.1112');
assert.ok(!currentAugust.requests.some(r=>r.endpoint==='purchase-order-details'&&r.params.purchaseOrderId==='ORDER-02'),'numeric 1688 cancellation must be excluded before detail fan-out');
assert.ok(!currentAugust.requests.some(r=>r.endpoint==='purchase-order-details'&&['ORDER-07','ORDER-13'].includes(r.params.purchaseOrderId)),'ERP void status 11 is excluded correctly');

const limitedAugust=await replay('2026-08','1');
assert.equal(limitedAugust.rows.find(r=>r.warehouseSku==='WH-WHITE').unitCost,'24.1020');
assert.equal(limitedAugust.rows.find(r=>r.warehouseSku==='WH-HOOK').unitCost,'0.1090');
for (const status of [4, '４', '已取消']) {
  const result = await replay('2026-08', '1', { status, paged: true });
  assert.equal(result.rows.find(row => row.warehouseSku === 'WH-WHITE').unitCost, '24.1020');
  assert.equal(result.rows.find(row => row.warehouseSku === 'WH-ORANGE').unitCost, '20.9620');
  assert.equal(result.meta.orderCount, 20);
  assert.equal(result.meta.orderPageCount, 3);
  assert.equal(result.warehouseEvidence.excludedOrders.find(order => order.purchaseOrderId === 'ORDER-02').statusFields.purchaseOrderStatus1688, status);
}
const incomplete = await replay('2026-08', '1', { incomplete: true });
assert.ok(incomplete.rows.every(row => row.unitCost === null && row.previewStatus === 'evidence_incomplete'), 'incomplete scoped history must not present a missing or computed cost');
assert.equal((await replay('2026-08', '1', { emptyScope: true })).emptyScopeRejected,true);
if (process.env.ERP_HISTORY_ACCEPTANCE_OUTPUT) await writeFile(process.env.ERP_HISTORY_ACCEPTANCE_OUTPUT, JSON.stringify({ ok: true, currentAugust, currentSeptember, limitedAugust, statusVariants: [4, '４', '已取消'], incompleteHistoryBlocked: true, companyWideScanBlocked: true }, null, 2));
console.log('Complete scoped purchase history and cancelled 1688 order regression passed');
