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
    if(['begin','begin-clear'].includes(request.action)){assert.equal(active,null);active='lock-'+calls.length;return {ok:true,maintenanceId:active,snapshot:structuredClone(snapshot)};}
    if(request.action==='validate'){assert.equal(request.snapshot.format,snapshot.format);return {ok:true};}
    assert.equal(request.maintenanceId,active,'all destructive steps require the held maintenance lock');
    if(request.action==='snapshot')return {ok:true,snapshot:structuredClone(snapshot)};
    if(request.action==='end')active=null;
    if(request.action==='restore')restored=structuredClone(request.snapshot);
    return {ok:true};
  },
  async clearBusinessData(request){assert.equal(request.maintenanceId,active);clears++;return {ok:true,clearedCount:1};},
};
const options={directory,getInboxService:()=>service};
try {
  const safety=createWorkspaceSafety(options);
  await assert.rejects(safety.clear({}),/确认永久清空/);assert.equal(clears,0);
  const clearInput={confirmation:'清空本机数据'};
  await safety.clear(clearInput);assert.equal(clears,1);assert.equal(active,null);
  assert.deepEqual(await fs.readdir(directory),[],'direct clearing never writes an automatic backup');
  assert.deepEqual(calls,['begin-clear','end']);
  const broken=createWorkspaceSafety({...options,operations:{...fs,open:async()=>{throw new Error('ENOSPC synthetic');}}});
  await broken.clear(clearInput);assert.equal(clears,2);assert.equal(active,null);
  await assert.rejects(broken.prepareRestore({snapshot,currentWorkspace:input}),/ENOSPC/);assert.equal(active,null);
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
  const interrupted=await resumed.prepareRestore({snapshot,currentWorkspace:input});
  active=null;restored=null;
  let preserveFailure=true;
  const recovering=createWorkspaceSafety({...options,operations:{...fs,open:async(file,...args)=>{
    if(preserveFailure&&String(file).includes('Lworkstation-recovery-current'))throw new Error('ENOSPC recovery fixture');
    return fs.open(file,...args);
  }}});
  await assert.rejects(recovering.recoverRestore({committedId:interrupted.id}),/ENOSPC recovery/);
  await assert.rejects(recovering.recoverRestore({committedId:interrupted.id}),/ENOSPC recovery/,'retry must preserve new receipts before replacing them');
  assert.equal(restored,null,'failed recovery backups never import the target');
  preserveFailure=false;await recovering.recoverRestore({committedId:interrupted.id});
  assert.deepEqual(restored,snapshot);await recovering.finishRestore({id:interrupted.id});
  let exported;
  const manual=createWorkspaceSafety({...options,saveBackup:async request=>{exported=JSON.parse(request.json);return {status:'saved',fileName:request.fileName,sizeBytes:Buffer.byteLength(request.json)};}});
  const manualReceipt=await manual.exportBackup(input);
  assert.equal(manualReceipt.status,'saved');assert.equal(exported.formatVersion,2);
  assert.deepEqual(exported.desktopInbox,snapshot);assert.equal(exported.manifest.desktopRecordCount,1);
  assert.equal(active,null,'manual export always releases its maintenance lock');
  const largeTarget={fileName:'large-target.json',json:JSON.stringify({format:'shopeers-local-backup',formatVersion:1,tables:{products:[{id:'large',raw:'x'.repeat(16*1024*1024)}]}})};
  const large=await safety.prepareRestore({snapshot,currentWorkspace:input,targetWorkspace:largeTarget});
  const journalFile=path.join(directory,'pending-inbox-restore.json');
  const compact=JSON.parse(await fs.readFile(journalFile,'utf8'));
  assert.equal(compact.version,2);assert.ok((await fs.stat(journalFile)).size<4096,'phase updates must not duplicate workspace payloads');
  assert.equal(await fs.readFile(path.join(directory,compact.targetWorkspaceFile.name),'utf8'),largeTarget.json);
  const targetFile=path.join(directory,compact.targetFile.name);
  await fs.appendFile(targetFile,'corrupt');restored=null;
  await assert.rejects(safety.recoverRestore({committedId:large.id}),/恢复载荷校验失败/);
  assert.equal(restored,null,'corrupt payloads never reach the replacement service');
  await fs.writeFile(targetFile,JSON.stringify(snapshot));await safety.recoverRestore({committedId:large.id});
  await safety.finishRestore({id:large.id});await assert.rejects(fs.access(targetFile),{code:'ENOENT'});
  assert.ok(await fs.stat(large.backupFilePath),'temporary payload cleanup preserves the rollback backup');
  const legacyLock=await service.maintenanceRequest({action:'begin'});
  await fs.writeFile(journalFile,JSON.stringify({version:1,id:'legacy-restore',phase:'prepared',maintenanceId:legacyLock.maintenanceId,target:snapshot,targetWorkspace:largeTarget}));
  await safety.recoverRestore({committedId:'legacy-restore'});
  assert.ok((await fs.stat(journalFile)).size<4096,'old interrupted journals upgrade before any phase rewrite');
  assert.deepEqual(restored,snapshot);await safety.finishRestore({id:'legacy-restore'});
  console.log('Workspace safety: confirmed direct clear without backup, restore backup failure, restart commit and abort recovery passed');
}finally{await fs.rm(directory,{recursive:true,force:true});}
