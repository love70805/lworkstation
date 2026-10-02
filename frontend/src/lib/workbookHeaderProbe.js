import * as XLSX from 'xlsx';

export function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 65557);
  let end = bytes.length - 22;
  for (; end >= minimum; end--) if (view.getUint32(end, true) === 0x06054b50) break;
  if (end < minimum || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error('Invalid or split ZIP directory');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 65535 || offset === 0xffffffff) throw new Error('ZIP64 header fallback');
  const entries = [];
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true), local = view.getUint32(offset + 42, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (flags & 1 || ![0, 8].includes(method) || size === 0xffffffff || local === 0xffffffff) throw new Error('Unsupported ZIP entry');
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Invalid ZIP local entry');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + size > bytes.length) throw new Error('Truncated ZIP entry');
    entries.push({ name, method, bytes: bytes.subarray(start, start + size) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
export async function readEntry(entry, headerOnly) {
  let stream = new Blob([entry.bytes]).stream();
  if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  if (!headerOnly) return new Uint8Array(await new Response(stream).arrayBuffer());
  const reader = stream.getReader(), decoder = new TextDecoder();
  let prefix = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      prefix += decoder.decode(value, { stream: !done });
      const rowEnds = [...prefix.matchAll(/<\/(?:\w+:)?row\s*>|<(?:\w+:)?row\b[^>]*\/\s*>/g)];
      if (rowEnds.length >= 2) {
        const end = rowEnds[1].index + rowEnds[1][0].length;
        const sheetDataTag = prefix.match(/<((?:\w+:)?sheetData)\b/)[1];
        const worksheetTag = prefix.match(/<((?:\w+:)?worksheet)\b/)[1];
        return new TextEncoder().encode(`${prefix.slice(0, end)}</${sheetDataTag}></${worksheetTag}>`);
      }
      if (done) return new TextEncoder().encode(prefix);
    }
  } finally { await reader.cancel().catch(() => {}); }
}

function sharedStringCells(xml, visit) {
  return xml.replace(/<(?:\w+:)?c\b[^>]*\/\s*>|<((?:\w+:)?c)\b([^>]*)>([\s\S]*?)<\/\1>/g, (cell, tag, attrs, body) => {
    if (!tag) return cell;
    if (!/\bt\s*=\s*["']s["']/.test(attrs)) return cell;
    return `<${tag}${attrs}>${body.replace(/(<(?:\w+:)?v\b[^>]*>)(\s*[+]?\d+\s*)(<\/(?:\w+:)?v>)/, (_match, open, index, close) => `${open}${visit(Number(index))}${close}`)}</${tag}>`;
  });
}
async function compactSharedStrings(entry, needed) {
  let stream = new Blob([entry.bytes]).stream();
  if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(), decoder = new TextDecoder(), selected = new Map();
  let pending = '', root = '', index = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (!root) root = pending.match(/<((?:\w+:)?sst)\b[^>]*>/)?.[0] ?? '';
      let match;
      while ((match = /<(?:\w+:)?si\b[^>]*\/\s*>|<((?:\w+:)?si)\b[^>]*>([\s\S]*?)<\/\1>/.exec(pending))) {
        if (needed.has(index)) selected.set(index, match[0]);
        index++;
        pending = pending.slice(match.index + match[0].length);
        if (selected.size === needed.size) break;
      }
      if (selected.size === needed.size || done) break;
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!root || selected.size !== needed.size) throw new Error('Incomplete header shared strings');
  const remap = new Map([...selected.keys()].map((key, index) => [key, index]));
  const tag = root.match(/^<([^\s>]+)/)[1];
  return { remap, content: new TextEncoder().encode(`${root}${[...selected.values()].join('')}</${tag}>`) };
}

// Header selection must not create every worksheet's cell graph. Use native
// streaming inflation for OOXML and let SheetJS interpret the tiny archive's
// relationships, shared strings and formatted headers. Every selected data row
// subsequently passes through SheetJS; the probe never supplies financial rows.
export async function workbookHeaderProbe(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && typeof DecompressionStream !== 'undefined') {
    try {
      const archive = XLSX.CFB.utils.cfb_new(), entries = zipEntries(bytes), sheets = [], needed = new Set();
      for (const entry of entries) {
        if (!/^\[Content_Types\]\.xml$|^_rels\/\.rels$|^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|metadata\.xml|worksheets\/[^/]+\.xml)$/i.test(entry.name)) continue;
        const content = await readEntry(entry, /\/worksheets\//i.test(entry.name));
        if (/\/worksheets\//i.test(entry.name)) {
          const xml = new TextDecoder().decode(content);
          sharedStringCells(xml, index => { needed.add(index); return index; });
          sheets.push({ name: entry.name, xml });
        } else XLSX.CFB.utils.cfb_add(archive, entry.name, content);
      }
      let remap = new Map();
      if (needed.size) {
        const shared = entries.find(entry => /^xl\/sharedStrings\.xml$/i.test(entry.name));
        if (!shared) throw new Error('Missing header shared strings');
        const compact = await compactSharedStrings(shared, needed); remap = compact.remap;
        XLSX.CFB.utils.cfb_add(archive, shared.name, compact.content);
      }
      for (const sheet of sheets) XLSX.CFB.utils.cfb_add(archive, sheet.name, new TextEncoder().encode(sharedStringCells(sheet.xml, index => remap.get(index))));
      return XLSX.parse_zip(archive, { type: 'array', cellDates: false, dense: true, cellHTML: false, cellNF: true, cellFormula: false });
    } catch {
      // Legacy, ZIP64 and uncommon valid ZIP variants retain the established
      // parser; unsupported header optimization cannot silently omit a sheet.
    }
  }
  const full = XLSX.read(buffer, { type: 'array', cellDates: false, dense: true, cellHTML: false, cellText: false, cellNF: true, cellFormula: false });
  full.__importFullWorkbook = true;
  return full;
}
