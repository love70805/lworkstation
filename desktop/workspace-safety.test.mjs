import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const {createWorkspaceSafety}=createRequire(import.meta.url)('./workspace-safety.cjs');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-safety-'));
const snapshot={format:'lworkstation-desktop-inbox-backup',formatVersion:1,records:[{kind:'batch',deliveryId:'SYNTHETIC',status:'acknowledged',envelope:{batch:{rows:[{unitCost:0.0000001}]}}}],leases:[],recordCount:1,leaseCount:0};
const input={fileName:'workspace.json',json:JSON.stringify({format:'shopeers-local-backup',formatVersion:1,tables:{products:[{id:'synthetic'}]}})};
let active=null,clears=0,restored,writeFailure=false;
const calls=[];
const service={
  async maintenanceRequest(request) {
    calls.push(request.action);
    if(request.action==='begin'){assert.equal(active,null);active='lock-'+calls.length;return {ok:true,maintenanceId:active,snapshot:structuredClone(snapshot)};}
    if(request.action==='validate'){assert.equal(request.snapshot.format,snapshot.format);return {ok:true};}
    assert.equal(request.maintenanceId,active,'all destructive steps require the held maintenance lock');
    if(request.action==='end')active=null;
    if(request.action==='restore')restored=structuredClone(request.snapshot);
    return {ok:true};
  },
  async clearBusinessData(request){assert.equal(request.maintenanceId,active);clears++;return {ok:true,clearedCount:1};},
};
const options={directory,getInboxService:()=>service};
try {
  const safety=createWorkspaceSafety(options);
  await assert.rejects(safety.clear({}),/先成功保存/);assert.equal(clears,0);
  const saved=await safety.saveBeforeClear(input);
  const contents=JSON.parse(await fs.readFile(saved.filePath,'utf8'));
  assert.deepEqual(contents.desktopInbox,snapshot);assert.equal(contents.manifest.desktopRecordCount,1);
  assert.ok(saved.sha256&&saved.backupToken);assert.equal(clears,0,'saving alone never clears');
  await fs.appendFile(saved.filePath,'tampered');
  await assert.rejects(safety.clear(saved),/备份已变化/);assert.equal(clears,0);assert.equal(active,null);
  const verified=await safety.saveBeforeClear(input);await safety.clear(verified);
  assert.equal(clears,1);assert.equal(active,null);await assert.rejects(safety.clear(verified),/先成功保存/);
  const broken=createWorkspaceSafety({...options,operations:{...fs,open:async(file,...args)=>{if(String(file).endsWith('.tmp'))throw new Error('ENOSPC synthetic');return fs.open(file,...args);}}});
  await assert.rejects(broken.saveBeforeClear(input),/ENOSPC/);assert.equal(active,null);assert.equal(clears,1);
  const pending=await safety.prepareRestore({snapshot,currentWorkspace:input});
  assert.ok(await fs.stat(pending.backupFilePath));
  // Simulate a renderer/host restart after IndexedDB committed its marker.
  const resumed=createWorkspaceSafety(options);
  const recovery=await resumed.recoverRestore({committedId:pending.id});
  assert.equal(recovery.phase,'committed');assert.deepEqual(restored,snapshot);assert.equal(active,null);
  await resumed.finishRestore({id:pending.id});assert.equal((await resumed.recoverRestore({})).id,undefined);
  const notCommitted=await resumed.prepareRestore({snapshot,currentWorkspace:input});
  restored=null;const aborted=await resumed.recoverRestore({});
  assert.equal(restored,null,'a rolled-back IndexedDB transaction never imports target desktop receipts');
  await resumed.finishRestore({id:aborted.id});assert.equal(active,null);
  assert.ok((await fs.readdir(directory)).some(name=>name.includes('before-restore')),'rollback backups survive journal cleanup');
  console.log('Workspace safety: mandatory full backup/readback, tamper/disk failure, one-use clear, restart commit and abort recovery passed');
}finally{await fs.rm(directory,{recursive:true,force:true});}
