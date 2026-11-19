import { sha256 } from './profitReports';
import { hashCanonicalJson } from './canonicalHash';

export const REPORT_SOURCE_DIGEST_VERSION = 2;
const encoder = new TextEncoder();
const hex = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));
const RECORD_CHARS = 2 * 1024 * 1024;

// IndexedDB can return the same purchase object in both the evidence and the
// pricing decision. Reuse its encoding within this record only. Shared and
// independently copied objects must produce identical canonical bytes.
function recordJson(row, fieldPrefixes) {
  const objects = new WeakMap();
  function encode(value) {
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' && value.length > RECORD_CHARS) return null;
      const result = JSON.stringify(value);
      return result?.length > RECORD_CHARS ? null : result;
    }
    const cached = objects.get(value);
    if (cached !== undefined) return cached;
    const array = Array.isArray(value);
    let text = array ? '[' : '{';
    if (array) {
      for (let index = 0; index < value.length; index++) {
        const element = encode(value[index]);
        if (element === null) return null;
        text += (index ? ',' : '') + (element ?? '');
        if (text.length > RECORD_CHARS) return null;
      }
    } else {
      let comma = '';
      for (const key of Object.keys(value).sort()) {
        if (value[key] === undefined) continue;
        if (key.length > RECORD_CHARS) return null;
        let prefix = fieldPrefixes.get(key);
        if (prefix === undefined) {
          prefix = JSON.stringify(key) + ':';
          if (fieldPrefixes.size < 512 && key.length < 128) fieldPrefixes.set(key, prefix);
        }
        const field = encode(value[key]);
        if (field === null) return null;
        text += comma + prefix + field;
        if (text.length > RECORD_CHARS) return null;
        comma = ',';
      }
    }
    text += array ? ']' : '}';
    objects.set(value, text);
    return text;
  }
  return encode(row);
}

// Each fixed-width SHA-256 commits to every field of one original record.
// The ordered digest protects the exact export input. The sorted digest also
// retains duplicates, but lets the freshness check ignore record order.
async function tableDigests(rows, includeFreshness) {
  const hashes = [], fieldPrefixes = new Map();
  let pending = [], pendingBytes = 0;
  async function flush() {
    for (const digest of await Promise.all(pending)) {
      hashes.push(Array.from(new Uint8Array(digest), byte => hex[byte]).join(''));
    }
    pending = [];
    pendingBytes = 0;
  }
  for (const row of rows) {
    const text = recordJson(row, fieldPrefixes);
    if (text === null) {
      // A single unusually large SKU history is streamed with the same SHA.
      // Finish preceding records first to preserve source order.
      await flush();
      hashes.push(await hashCanonicalJson(row));
      continue;
    }
    const bytes = encoder.encode(text);
    pending.push(crypto.subtle.digest('SHA-256', bytes));
    pendingBytes += bytes.length;
    if (pending.length >= 128 || pendingBytes >= 1024 * 1024) await flush();
  }
  if (pending.length) await flush();
  const ordered = await sha256(hashes.join(''));
  return { ordered, unordered: includeFreshness ? await sha256(hashes.sort().join('')) : null };
}

export async function reportSourceDigests({ erpCosts, salesRows }, includeFreshness) {
  const erp = await tableDigests(erpCosts, includeFreshness);
  const sales = await tableDigests(salesRows, includeFreshness);
  return { erpCosts: erp, salesRows: sales };
}
