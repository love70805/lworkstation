import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { scenario } from './erp-collection-batches.test.mjs';

const body=data=>({code:0,count:data.length,data});
export function historyFixture({orders=48,missing=0}={}){
 return url=>{
  const endpoint=url.pathname.split('/').at(-1),target=url.searchParams.get('sku')||url.searchParams.get('purchaseOrderId')||url.searchParams.get('productId')||url.searchParams.get('skuGroup');
  if(endpoint==='product-page'){
   const id=Number(target.split('-').at(-1));
   return body([{itemId:target.startsWith('SKU-')&&id<missing?'OLD-'+id%2:'WH-'+id}]);
  }
  if(endpoint==='product-info-sku'){
   if(target.startsWith('OLD-'))return body([...Array.from({length:missing},(_,i)=>i).filter(i=>i%2===Number(target.at(-1))).map(i=>({associatedProductId:target,barcodeSkuid:'SKU-'+i,barcodeSkcid:'SKC-'+i,temporary:'1'})),{associatedProductId:target,barcodeSkuid:'FOREIGN',barcodeSkcid:'FOREIGN-SKC'}]);
   const id=Number(target.split('-').at(-1));return body([{associatedProductId:target,barcodeSkuid:(id<missing?'OTHER-':'SKU-')+id,barcodeSkcid:'SKC-'+id}]);
  }
  if(endpoint==='purchase-order-page'){
   const page=Number(url.searchParams.get('page')),id=Number(target.split('-').at(-1));
   const data=target.startsWith('SKC-')&&id<missing?[]:Array.from({length:Math.max(0,Math.min(8,orders-(page-1)*8))},(_,i)=>({purchaseOrderId:'PO-'+target+'-'+((page-1)*8+i)}));
   return {code:0,count:target.startsWith('SKC-')&&id<missing?0:orders,data};
  }
  if(endpoint==='purchase-order-details'){
   const match=target.match(/^PO-((?:SKC|OLD)-\d+)-(\d+)$/);assert.ok(match,target);
   const [,scope,index]=match,warehouse=scope.startsWith('OLD-')?scope:'WH-'+scope.split('-').at(-1);
   return body([{purchaseOrderDetailId:'D-'+scope+'-'+index,itemId:warehouse,creationTime:'2026-08-20',purchaseQuantity:2,purchaseUnitPrice:4+Number(index)%3}]);
  }
  throw Error(endpoint);
 };
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
const pipeline=await scenario(10,'speed-pipeline',{fixture:historyFixture(),requestDelay:12,returnMetrics:true,firstBatchListLimit:30});
const firstDetail=pipeline.calls.find(call=>call.endpoint==='purchase-order-details'&&call.target==='PO-SKC-0-0');
const lastPage=pipeline.calls.find(call=>call.endpoint==='purchase-order-page'&&call.target==='SKC-0'&&call.page===6);
assert.ok(firstDetail.at<lastPage.at,'actual order detail requests start before the same target finishes pagination');
assert.ok(pipeline.maxInflight>8&&pipeline.maxInflight<=12,'healthy responses expand the actual network pool within the ceiling');
assert.ok(pipeline.calls.every(call=>call.cache==='no-store'),'new authoritative reads bypass the browser HTTP cache; explicit same-attempt evidence reuse remains local');
const orderCalls=pipeline.calls.filter(call=>call.endpoint==='purchase-order-details');assert.equal(orderCalls.length,480);assert.equal(new Set(orderCalls.map(call=>call.target)).size,480);
assert.ok(pipeline.deliveries.every(delivery=>delivery.warehouseEvidence.warehouses.every(row=>row.purchaseRecords.length===48)),'pipelining keeps every historical purchase record');
assert.ok(pipeline.deliveries.every(delivery=>delivery.rows.every(row=>Number(row.unitCost??row.previewUnitCost)===5)));
assert.equal(pipeline.deliveries.reduce((sum,row)=>sum+row.sourceMeta.requestCount,0),pipeline.calls.length,'diagnostics count real requests rather than repeated logical order rows');

const recovery=await scenario(10,'speed-recovery',{fixture:historyFixture(),requestDelay:12,returnMetrics:true,firstBatchListLimit:31});
assert.ok(recovery.maxInflightAfterLimit>2&&recovery.maxInflightAfterLimit<=12,'healthy reads recover from throttling instead of keeping the whole task at two lanes');
assert.equal(recovery.deliveries.reduce((sum,row)=>sum+row.sourceMeta.rateLimitCount,0),1);
assert.equal(recovery.deliveries.reduce((sum,row)=>sum+row.sourceMeta.requestRetryCount,0),1);
assert.ok(recovery.deliveries.every(delivery=>delivery.rows.every(row=>Number(row.unitCost??row.previewUnitCost)===5)));

const mappings=await scenario(10,'speed-mapping',{fixture:historyFixture({orders:8,missing:8}),requestDelay:4,returnMetrics:true,firstBatchListLimit:9});
const rows=mappings.deliveries.flatMap(delivery=>delivery.rows);
assert.equal(rows.length,10);assert.ok(!rows.some(row=>row.platformSku==='FOREIGN'));
for(let i=0;i<8;i++){const row=rows.find(row=>row.platformSku==='SKU-'+i);assert.equal(row.platformSkc,'SKC-'+i);assert.equal(row.warehouseSku,'OLD-'+i%2);assert.equal(Number(row.unitCost??row.previewUnitCost),5);}
assert.equal(mappings.deliveries.reduce((sum,row)=>sum+row.sourceMeta.recoveredMappingCount,0),8);
assert.equal(mappings.calls.filter(call=>call.endpoint==='purchase-order-page'&&call.target.startsWith('OLD-')).length,2,'the two rescued warehouse histories are read once across all batches');
assert.equal(mappings.calls.filter(call=>call.endpoint==='product-info-sku'&&call.target.startsWith('OLD-')).length,2);
assert.ok(mappings.deliveries.every(delivery=>!delivery.sourceMeta.mappingFailureCount&&delivery.warehouseEvidence.warehouses.every(row=>row.evidenceComplete)));
const summary={ok:true,pipeline:{requests:pipeline.calls.length,elapsedMs:pipeline.elapsedMs,peak:pipeline.maxInflight,allRecordsPreserved:true},recovery:{elapsedMs:recovery.elapsedMs,peakAfterLimit:recovery.maxInflightAfterLimit,acceleratedCooldown:true},mapping:{recovered:8,warehouses:2,exactPairs:true,foreignExcluded:true}};
if(process.env.ERP_THROUGHPUT_OUTPUT)await writeFile(process.env.ERP_THROUGHPUT_OUTPUT,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
}
