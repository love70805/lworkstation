import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createInboxDisk} from './erp-inbox-disk.mjs';
import {createInboxStorage,cloneInboxMetadata} from './erp-inbox-storage.mjs';

const directory=await fs.mkdtemp(path.join(os.tmpdir(),'erp-incremental-'));
try {
  const file=path.join(directory,'inbox.json');
  const envelope={type:'shopeers.erp.cost.batch',batch:{formatVersion:2,evidenceStatus:'complete',rows:[{platformSku:'SYNTHETIC',unitCost:0,evidence:'x'.repeat(2*1024*1024)}],warehouseEvidence:[{evidenceComplete:true}]}};
  const original=JSON.stringify([{kind:'batch',deliveryId:'one',status:'pending',envelope}]);
  await fs.writeFile(file,original);
  const store=createInboxStorage(file,{coldAcknowledged:true,checkpointOperations:4,checkpointBytes:16384});
  const pending=cloneInboxMetadata(await store.read());
  assert.deepEqual(pending[0].envelope,envelope);
  pending[0].status='acknowledged';await store.write(pending);
  const cold=await store.read();
  assert.ok(cold[0].envelope.__inboxArchive);
  assert.ok(JSON.stringify(cold).length<1024,'acknowledged evidence leaves the resident HTTP snapshot');
  assert.deepEqual((await store.hydrate(cold[0])).envelope,envelope,'duplicate response can restore the exact cold evidence');
  assert.deepEqual((await store.exportRecords())[0].envelope,envelope,'backup exports full cold evidence');
  const backups=(await fs.readdir(directory)).filter(name=>name.includes('.legacy-'));
  assert.equal(backups.length,1);
  assert.equal(await fs.readFile(path.join(directory,backups[0]),'utf8'),original,'legacy source preserved byte-for-byte');
  const blob=(await fs.readdir(`${file}.evidence`))[0];
  const before=await fs.stat(path.join(`${file}.evidence`,blob));
  const written=[];
  for(let i=0;i<12;i++) {
    const rows=cloneInboxMetadata(await store.read());rows[0].note=`state-${i}`;
    await store.write(rows);
    written.push((await fs.stat(`${file}.journal`)).size);
  }
  assert.ok(written.every(bytes=>bytes<16384),'journal is bounded independently of historical evidence size');
  assert.ok((await fs.stat(file)).size<2048,'checkpoint contains metadata only');
  assert.equal((await fs.stat(path.join(`${file}.evidence`,blob))).mtimeMs,before.mtimeMs,'status changes never rewrite immutable evidence');
  const disk=createInboxDisk(file);await disk.load();
  const committed=await fs.readFile(`${file}.journal`);
  await fs.appendFile(`${file}.journal`,'{"data":"torn');
  assert.equal((await disk.load())[0].metadata.note,'state-11','torn unacknowledged tail is ignored');
  const entries=await disk.load();entries[0].metadata.note='after-torn';await disk.write(entries,disk.revision);
  assert.equal((await createInboxDisk(file).load())[0].metadata.note,'after-torn','next write removes only the torn tail');
  await fs.appendFile(`${file}.journal`,'{"data":"{}","checksum":"invalid"}\n');
  await assert.rejects(createInboxDisk(file).load(),{code:'ERP_INBOX_CORRUPT'});
  await fs.writeFile(`${file}.journal`,committed);
  await fs.writeFile(path.join(`${file}.evidence`,blob),'tampered');
  await assert.rejects(store.hydrate(cold[0]),{code:'ERP_INBOX_CORRUPT'});
  console.log('Incremental inbox: legacy preservation, exact cold hydration/backup, bounded journal/checkpoint, unchanged evidence, torn tail and checksum rejection passed');
} finally {await fs.rm(directory,{recursive:true,force:true});}
