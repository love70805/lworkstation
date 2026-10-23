import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
function issues(text, file) {
  const result = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const identities = line.match(/\b(?:I\d[A-Za-z0-9]{7,24}|ST\d{12,30}|SH\d{10,30}(?:-[A-Za-z0-9]+)*)\b/gi) ?? [];
    if (identities.some(value => !/^(?:I9demo\d+|ST9000\d+|SH9000\d+(?:-[A-Za-z0-9]+)*)$/i.test(value))) result.push({ file, line: index + 1, kind: 'business-identity-shaped sample; use reserved synthetic IDs' });
    if (/^(?:docs|frontend\/docs)\//.test(file) && /[A-Z]:[\\/]+Users[\\/]+Administrator[\\/]/i.test(line)) result.push({ file, line: index + 1, kind: 'absolute local user path; use a repository-relative evidence path' });
    if (/(?:detail\.1688\.com\/offer\/)\d{8,}\.html/.test(line) && [...line.matchAll(/detail\.1688\.com\/offer\/(\d{8,})\.html/g)].some(match => !/^900000\d+$/.test(match[1]))) result.push({ file, line: index + 1, kind: 'supplier offer sample; use reserved synthetic offer IDs' });
  }
  return result;
}

assert.equal(issues('I' + '3fixture000001', 'sample.test.js').length, 1);
assert.equal(issues('I9demo00000001 ST900000000000001 SH900000000001-X', 'sample.test.js').length, 0);
assert.equal(issues('C:/Users/Administrator/Desktop/sample.xlsx', 'docs/sample.md').length, 1);
assert.equal(issues('archive/task/result.json', 'docs/sample.md').length, 0);
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(file => /\.(?:[cm]?js|jsx|json|md|ya?ml|txt|html|csv)$/i.test(file));
const failures = [];
for (const file of files) {
  const data = readFileSync(path.join(root, file));
  if (data.includes(0)) continue;
  failures.push(...issues(data.toString('utf8'), file));
}
for (const { file, line, kind } of failures) console.error(file + ':' + line + ': ' + kind);
if (failures.length) process.exitCode = 1;
else console.log('Public sample privacy check passed (' + files.length + ' tracked text files; synthetic IDs and relative evidence paths)');
