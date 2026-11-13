import { sha256 } from '@noble/hashes/sha2.js';

const STRING_CHARS = 16384;
const HASH_CHARS = 65536;
const encoder = new TextEncoder();

// JSON.stringify keeps valid surrogate pairs literal but escapes lone ones.
// Never split a valid pair between separately encoded/quoted chunks.
export function* quotedJsonChunks(value) {
  if (value.length <= STRING_CHARS) { yield JSON.stringify(value); return; }
  yield '"';
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + STRING_CHARS, value.length);
    const last = value.charCodeAt(end - 1), next = value.charCodeAt(end);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}

// Matches profitReports.canonicalJson, including its historical treatment of
// undefined array entries and objects (no toJSON conversion).
export function* canonicalJsonChunks(value) {
  if (Array.isArray(value)) {
    yield '[';
    for (let index = 0; index < value.length; index++) {
      if (index) yield ',';
      yield* canonicalJsonChunks(value[index]);
    }
    yield ']';
  } else if (value && typeof value === 'object') {
    yield '{';
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    for (let index = 0; index < keys.length; index++) {
      if (index) yield ',';
      const key = keys[index];
      yield* quotedJsonChunks(key); yield ':'; yield* canonicalJsonChunks(value[key]);
    }
    yield '}';
  } else if (typeof value === 'string') yield* quotedJsonChunks(value);
  else {
    const text = JSON.stringify(value);
    if (text !== undefined) yield text;
  }
}

// Only a small UTF-8 buffer is passed to the incremental hash. Yield between
// chunks so export progress can paint while a large snapshot is being checked.
export async function hashJsonChunks(chunks) {
  const hash = sha256.create();
  let buffer = '', lastYield = performance.now();
  try {
    for (const chunk of chunks) {
      buffer += chunk;
      if (buffer.length < HASH_CHARS) continue;
      hash.update(encoder.encode(buffer)); buffer = '';
      if (performance.now() - lastYield >= 16) {
        await new Promise(resolve => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
    if (buffer) hash.update(encoder.encode(buffer));
    return [...hash.digest()].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } finally { hash.destroy(); }
}

export const hashCanonicalJson = value => hashJsonChunks(canonicalJsonChunks(value));

// A write transaction must not leave its active IDB task while validating the
// final source snapshot. It still uses bounded buffers, without a timer or an
// external promise between the last read and the atomic report writes.
export function hashCanonicalJsonSync(value) {
  const hash = sha256.create(); let buffer = '';
  try {
    for (const chunk of canonicalJsonChunks(value)) {
      buffer += chunk;
      if (buffer.length < HASH_CHARS) continue;
      hash.update(encoder.encode(buffer)); buffer = '';
    }
    if (buffer) hash.update(encoder.encode(buffer));
    return [...hash.digest()].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } finally { hash.destroy(); }
}
