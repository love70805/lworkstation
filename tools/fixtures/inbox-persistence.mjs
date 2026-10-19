import {createInboxDisk} from '../erp-inbox-disk.mjs';

// Read the committed logical records, including cold evidence and journal
// replay. Tests assert business persistence rather than a legacy file layout.
export async function readInboxRecords(file) {
  const disk=createInboxDisk(file),entries=await disk.load();
  return Promise.all(entries.map(async entry=>({...entry.metadata,...(entry.ref?{envelope:await disk.evidence(entry.ref)}:{})})));
}
