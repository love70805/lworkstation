import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createRuntimeDiagnostics } = require('./runtime-diagnostics.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lworkstation-diagnostics-test-'));
const fixedTime = () => new Date('2026-10-24T01:00:00.000Z');
const readRows = file => fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
try {
  const journal = createRuntimeDiagnostics({ userDataPath: path.join(root, 'privacy'), version: '1.0.1', now: fixedTime });
  assert(journal.record('render-process-gone', {
    page: 'workspace', reason: 'oom', exitCode: -1073741819,
    privateKiB: 1234, workingSetKiB: 2000, sharedKiB: 12.5, peakWorkingSetKiB: 3000, cpuPercent: 20.125,
    url: 'https://private.invalid/?token=secret', workspaceId: '私人工作区', requestId: '私有业务标识',
    error: new Error('私有商品采购内容'), message: '私有商品采购内容', response: { token: 'secret' },
  }));
  assert.deepEqual(readRows(journal.filePath), [{
    timestamp: '2026-10-24T01:00:00.000Z', version: '1.0.1', event: 'render-process-gone',
    page: 'workspace', reason: 'oom', exitCode: -1073741819,
    workingSetKiB: 2000, privateKiB: 1234, sharedKiB: 12.5, peakWorkingSetKiB: 3000, cpuPercent: 20.125,
  }]);
  const sensitiveText = fs.readFileSync(journal.filePath, 'utf8');
  assert(!/private\.invalid|secret|私人|私有|token|workspaceId|requestId|message|response/.test(sensitiveText));
  assert(journal.record('child-process-gone', { page: '私有店铺', reason: '私有商品名称', exitCode: NaN,
    privateKiB: Infinity, workingSetKiB: -1, sharedKiB: 'credential-1234', peakWorkingSetKiB: Number.MAX_SAFE_INTEGER + 1, cpuPercent: 101 }));
  assert.deepEqual(readRows(journal.filePath).at(-1), {
    timestamp: '2026-10-24T01:00:00.000Z', version: '1.0.1', event: 'child-process-gone', reason: 'unknown',
  });
  const rowsBeforeInvalid = readRows(journal.filePath).length;
  assert.equal(journal.record('私有业务事件', { reason: 'crashed' }), false);
  assert.equal(readRows(journal.filePath).length, rowsBeforeInvalid);
  for (const event of ['startup', 'shutdown', 'sample', 'unresponsive']) assert(journal.record(event, { page: 'main', cpuPercent: 0, privateKiB: 0 }));
  assert(journal.record('child-process-gone', { page: 'gpu', reason: 'crashed', exitCode: 4294967295 }));
  assert.equal(readRows(journal.filePath).at(-1).exitCode, 4294967295);

  const rotating = createRuntimeDiagnostics({ userDataPath: path.join(root, 'rotation'), version: '1.0.1', maxBytes: 512, now: fixedTime });
  for (let index = 0; index < 30; index++) {
    assert(rotating.record('sample', { page: 'workspace', privateKiB: index }));
    const files = fs.readdirSync(path.dirname(rotating.filePath));
    assert(files.length <= 2);
    for (const name of files) assert(fs.statSync(path.join(path.dirname(rotating.filePath), name)).size <= 512);
  }
  assert.equal(fs.readdirSync(path.dirname(rotating.filePath)).length, 2);
  assert.equal(readRows(rotating.filePath).at(-1).privateKiB, 29);
  const previous = path.join(path.dirname(rotating.filePath), 'diagnostics.previous.jsonl');
  assert(readRows(previous).at(-1).privateKiB < readRows(rotating.filePath)[0].privateKiB);
  fs.writeFileSync(rotating.filePath, 'x'.repeat(1024));
  assert(rotating.record('startup'));
  for (const name of fs.readdirSync(path.dirname(rotating.filePath))) assert(fs.statSync(path.join(path.dirname(rotating.filePath), name)).size <= 512);
  assert.equal(readRows(rotating.filePath)[0].event, 'startup');

  for (const method of ['mkdirSync', 'existsSync', 'statSync', 'appendFileSync', 'unlinkSync', 'renameSync']) {
    const operations = { ...fs, [method]: () => { throw new Error('synthetic storage failure'); } };
    // Seed a full current/previous pair so each injected mutation is reached.
    const directory = path.join(root, `failed-${method}`, 'runtime');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'diagnostics.jsonl'), 'x'.repeat(500));
    fs.writeFileSync(path.join(directory, 'diagnostics.previous.jsonl'), 'x');
    const failed = createRuntimeDiagnostics({ userDataPath: path.dirname(directory), version: '1.0.1', operations, maxBytes: 512, now: fixedTime });
    assert.doesNotThrow(() => assert.equal(failed.record('startup'), false));
  }
  assert.equal(createRuntimeDiagnostics().record('startup'), false);
  const invalidVersion = createRuntimeDiagnostics({ userDataPath: path.join(root, 'version'), version: 'private-secret-私有', now: fixedTime });
  assert(invalidVersion.record('startup'));
  assert.equal(readRows(invalidVersion.filePath)[0].version, 'unknown');
  const invalidTime = createRuntimeDiagnostics({ userDataPath: root, version: '1.0.1', now: () => 'invalid' });
  assert.equal(invalidTime.record('startup'), false);
  console.log('runtime diagnostics tests passed: privacy allowlist, numeric validation, two-file budget, storage failures');
} finally {
  // This directory is created above for synthetic journal tests only.
  fs.rmSync(root, { recursive: true, force: true });
}
