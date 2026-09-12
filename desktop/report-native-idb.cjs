// Test-only native IndexedDB fixture/reader for compiled packaged resources.
// No report/supplement table writes. Functions are serialized into the isolated renderer.
async function readTables(names) {
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('shopeers-workstation');
    open.onupgradeneeded=()=>{open.transaction.abort();reject(new Error('Candidate database must already exist'));};
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction(names,'readonly'),result={};
      for(const name of names){const request=tx.objectStore(name).getAll();request.onsuccess=()=>{result[name]=request.result;};}
      tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};
    };
  });
}
async function seedInitialLedger() {
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('shopeers-workstation');
    open.onupgradeneeded=()=>{open.transaction.abort();reject(new Error('Candidate database must already exist'));};
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction(['ledgers','salesRows','costApprovals'],'readwrite');
      const workspaceId='workspace-default',ledgerId='LEDGER-workspace-default-2026-08',now=new Date().toISOString();
      tx.objectStore('ledgers').put({id:ledgerId,workspaceId,period:'2026-08',status:'ready',currency:'CNY',warehouseRate:0.7,createdAt:now,updatedAt:now,costSummary:{expectedCount:2,missingCount:0}});
      const rows=[{id:'REPORT-A',store:'甲店',platformSku:'REPORT-A',quantity:1000,quantityExact:'1000',amount:100,amountExact:'100',unitCost:0.009},{id:'REPORT-B',store:'乙店',platformSku:'REPORT-B',quantity:1.5,quantityExact:'1.5',amount:30.015,amountExact:'30.015',unitCost:0}];
      rows.forEach(({unitCost,...row},i)=>{
        tx.objectStore('salesRows').put({...row,ledgerId,workspaceId,platformSkc:'REPORT-SKC',attribute:'合成属性',penalty:0,sourceAddedDate:'2026-08-01',dateStatus:'valid'});
        tx.objectStore('costApprovals').put({id:'PACKAGED-MANUAL-'+i,workspaceId,ledgerId,platformSku:row.platformSku,canonicalPlatformSku:row.platformSku,referenceCostId:'PACKAGED-REF-'+i,approvedAmount:unitCost,currency:'CNY',reason:'候选包隔离初始成本',approvedBy:'local-user',approvedAt:now,status:'approved',referenceCost:{id:'PACKAGED-REF-'+i,kind:'manual_override',store:row.store,unitCost,currency:'CNY',previousUnitCost:null,previousSource:null}});
      });
      tx.oncomplete=()=>{db.close();resolve(ledgerId);};tx.onerror=()=>{db.close();reject(tx.error);};
    };
  });
}
module.exports={readTables,seedInitialLedger};
