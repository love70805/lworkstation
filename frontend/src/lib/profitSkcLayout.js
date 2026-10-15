const identity = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();

// Keep first-seen group order and every SKU; an absent SKC is never a group.
export function groupProfitExportProducts(products) {
  const groups = new Map();
  for (const row of products) {
    const skc = identity(row.platformSkc ?? row.groupSkc);
    const key = skc ? JSON.stringify([row.store, skc]) : Symbol();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].flat();
}

export function mergeProfitSkcRows(rows) {
  let start = -1, key;
  const finish = end => {
    if (start >= 0 && end - start > 1) {
      rows[start][0] = { ...rows[start][0], mergeDown: end - start };
      for (let index = start + 1; index < end; index++) rows[index][0] = { ...rows[index][0], value: '', stripeRow: start };
    }
  };
  for (let index = 0; index <= rows.length; index++) {
    const row = rows[index], skc = row?.[0];
    const next = row?.[1]?.value && !row[1].header && skc?.mergeSkc !== false ? identity(skc?.value) : '';
    if (!next || next !== key) { finish(index); start = next ? index : -1; key = next; }
  }
  return rows;
}

// V4 already stores truncated display amounts. Move original A:J cell XML only;
// never rebuild numbers/totals or move the summary beside the product table.
export function mergeArchivedSkcSheet(source, sheet) {
  const replacements = new Map(), merges = [];
  let block = [];
  const cells = row => [...row.matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/g)].map(match => match[0]);
  const column = cell => cell.match(/\br="([A-Z]+)\d+"/)?.[1];
  const left = cell => /^[A-J]$/.test(column(cell));
  const finish = () => {
    const groups = new Map();
    for (const row of block) {
      const key = identity(sheet[`A${row.number}`]?.v) || Symbol();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    let offset = 0;
    for (const group of groups.values()) {
      const first = block[offset].number, anchor = cells(group[0].xml).find(cell => column(cell) === 'A');
      if (group.length > 1) merges.push(`A${first}:A${block[offset + group.length - 1].number}`);
      for (let index = 0; index < group.length; index++, offset++) {
        const target = block[offset], items = cells(group[index].xml).filter(left).map(cell => cell.replace(/\br="([A-Z]+)\d+"/, `r="$1${target.number}"`));
        if (group.length > 1 && index > 0) {
          const style = anchor?.match(/\bs="(\d+)"/)?.[1];
          items[0] = `<c r="A${target.number}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t></t></is></c>`;
        }
        replacements.set(target.number, target.xml.replace(/(<row\b[^>]*>)[\s\S]*(<\/row>)/, (_, open, close) => `${open}${items.join('')}${cells(target.xml).filter(cell => !left(cell)).join('')}${close}`));
      }
    }
    block = [];
  };
  for (const match of source.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)) {
    const number = Number(match[0].match(/\br="(\d+)"/)?.[1]);
    if (number > 1 && sheet[`B${number}`]?.v) {
      if (block.length && number !== block.at(-1).number + 1) finish();
      block.push({ number, xml: match[0] });
    } else finish();
  }
  finish();
  if (!merges.length) return source;
  let result = source.replace(/<row\b[^>]*>[\s\S]*?<\/row>/g, row => replacements.get(Number(row.match(/\br="(\d+)"/)?.[1])) ?? row);
  const old = result.match(/<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/)?.[1] ?? '';
  const merged = `<mergeCells>${old}${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`;
  return old ? result.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/, merged) : result.replace('</sheetData>', `</sheetData>${merged}`);
}
