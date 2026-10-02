import * as XLSX from 'xlsx';
import { zipEntries, readEntry } from './workbookHeaderProbe';

async function* elements(entry, tag, container, onOpen) {
  let stream = new Blob([entry.bytes]).stream();
  if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(), decoder = new TextDecoder();
  const pattern = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*\\/\\s*>|<((?:\\w+:)?${tag})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`);
  const open = new RegExp(`<(?:\\w+:)?${container}\\b[^>]*>`), close = new RegExp(`<\\/(?:\\w+:)?${container}\\s*>`);
  let pending = '', inside = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (!inside) {
        const match = open.exec(pending);
        if (!match) { if (done) return; continue; }
        if (/\/\s*>$/.test(match[0])) return;
        onOpen?.(match[0]);
        pending = pending.slice(match.index + match[0].length); inside = true;
      }
      let match;
      while ((match = pattern.exec(pending))) {
        const end = close.exec(pending);
        if (end && end.index < match.index) return;
        yield match[0];
        pending = pending.slice(match.index + match[0].length);
      }
      if (close.test(pending) || done) return;
    }
  } finally { await reader.cancel().catch(() => {}); }
}
const decodeAttribute = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
  if (named[entity]) return named[entity];
  return String.fromCodePoint(entity.startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1)));
});
function attribute(xml, name) {
  const match = xml.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`));
  return match ? decodeAttribute(match[2]) : null;
}
function resolvePart(target) {
  const parts = target.startsWith('/') ? [] : ['xl'];
  for (const part of target.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
  return parts.join('/');
}
function remapStrings(xml, strings, indexes) {
  return xml.replace(/<((?:\w+:)?c)\b([^>]*)>([\s\S]*?)<\/\1>/g, (cell, tag, attrs, body) => {
    if (!/\bt\s*=\s*(["'])s\1/.test(attrs)) return cell;
    const match = body.match(/<(?:\w+:)?v\b[^>]*>(\s*[+]?\d+\s*)<\/(?:\w+:)?v>/);
    if (!match || strings[Number(match[1])] == null) throw new Error('Shared string reference is incomplete');
    const original = Number(match[1]);
    if (!indexes.has(original)) indexes.set(original, indexes.size);
    return `<${tag}${attrs}>${body.replace(match[0], () => match[0].replace(match[1], () => String(indexes.get(original))))}</${tag}>`;
  });
}

// Keep a single shared-string XML table and at most 8,000 worksheet rows. The
// authoritative SheetJS parser still interprets every complete cell, its cached
// value and number format; no financial field is decoded by this XML splitter.
export async function* workbookSheetChunks(buffer, selectedSheet, probe, chunkSize = 8000) {
  const entries = zipEntries(new Uint8Array(buffer));
  const relationPart = entries.find(entry => entry.name === 'xl/_rels/workbook.xml.rels');
  if (!relationPart) throw new Error('Workbook relationships missing');
  const relationships = new TextDecoder().decode(await readEntry(relationPart, false));
  const sheetId = probe.Workbook?.Sheets?.find(sheet => sheet.name === selectedSheet)?.id;
  const relation = [...relationships.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)].map(match => match[0]).find(xml => attribute(xml, 'Id') === sheetId);
  if (!relation || attribute(relation, 'TargetMode') === 'External') throw new Error('Selected worksheet relationship missing');
  const target = resolvePart(attribute(relation, 'Target'));
  const source = entries.find(entry => entry.name === target);
  if (!source || !target.endsWith('.xml')) throw new Error('Selected worksheet XML missing');
  const prefixXml = new TextDecoder().decode(await readEntry(source, true));
  const dataOpen = /<((?:\w+:)?sheetData)\b[^>]*>/.exec(prefixXml);
  const rootTag = prefixXml.match(/<((?:\w+:)?worksheet)\b/)[1];
  const prefix = prefixXml.slice(0, dataOpen.index + dataOpen[0].length);
  const suffix = `</${dataOpen[1]}></${rootTag}>`;
  const strings = [];
  const shared = entries.find(entry => /^xl\/sharedStrings\.xml$/i.test(entry.name));
  let sharedRoot = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  if (shared) for await (const xml of elements(shared, 'si', 'sst', root => { sharedRoot = root; })) strings.push(xml);
  const archive = XLSX.CFB.utils.cfb_new();
  for (const entry of entries) if (/^\[Content_Types\]\.xml$|^_rels\/\.rels$|^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|styles\.xml|metadata\.xml)$/i.test(entry.name)) {
    XLSX.CFB.utils.cfb_add(archive, entry.name, await readEntry(entry, false));
  }
  const headerIndex = XLSX.utils.decode_range(probe.Sheets[selectedSheet]['!ref']).s.r + 1;
  let header = '', rows = [], first = null, last = 0, worksheetFile = null, sharedFile = null, indexes = new Map();
  const parse = () => {
    if (!header) throw new Error('Worksheet header missing');
    const mappedHeader = remapStrings(header, strings, indexes);
    if (shared) {
      const root = sharedRoot.replace(/\s+(?:count|uniqueCount)\s*=\s*(["']).*?\1/g, '');
      const content = new TextEncoder().encode(root + [...indexes.keys()].map(index => strings[index]).join('') + `</${root.match(/^<([^\s>]+)/)[1]}>`);
      if (!sharedFile) sharedFile = XLSX.CFB.utils.cfb_add(archive, shared.name, content);
      else { sharedFile.content = content; sharedFile.size = content.length; }
    }
    const content = new TextEncoder().encode(prefix + mappedHeader + rows.join('') + suffix);
    if (!worksheetFile) worksheetFile = XLSX.CFB.utils.cfb_add(archive, target, content);
    else { worksheetFile.content = content; worksheetFile.size = content.length; }
    // The pinned SheetJS reader exports this same archive decoder used by
    // read(). Avoid copying every chunk into a ZIP and immediately unzipping it.
    return { workbook: XLSX.parse_zip(archive, {
      type: 'array', dense: true, sheets: [selectedSheet], cellDates: false, cellHTML: false, cellText: false, cellNF: true, cellFormula: false,
    }), start: first - 1, end: last - 1 };
  };
  for await (let xml of elements(source, 'row', 'sheetData')) {
    const opening = xml.slice(0, xml.indexOf('>') + 1);
    const number = attribute(opening, 'r');
    const next = number == null ? last + 1 : Number(number);
    if (!Number.isInteger(next) || next <= last) throw new Error('Invalid or reordered worksheet source row');
    last = next;
    if (number == null) xml = xml.replace(/^(<(?:\w+:)?row)\b/, `$1 r="${last}"`);
    if (last === headerIndex) { header = xml; continue; }
    if (last < headerIndex) continue;
    if (first == null) first = last;
    rows.push(remapStrings(xml, strings, indexes));
    if (rows.length === chunkSize) { yield parse(); rows = []; first = null; indexes = new Map(); }
  }
  if (rows.length) yield parse();
}
