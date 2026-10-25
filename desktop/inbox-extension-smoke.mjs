import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
const directory = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
const output = path.resolve(process.env.INBOX_EXTENSION_OUTPUT || path.join(directory, '../archive/audit-fixes-1.0.2'));
const scratch = path.join(output, 'scratch');
await mkdir(scratch, { recursive: true });
const profile = await mkdtemp(path.join(scratch, 'extension-proxy-profile-'));
try {
  const env = { ...process.env, INBOX_EXTENSION_OUTPUT: output, INBOX_EXTENSION_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [path.join(directory, 'inbox-extension-smoke-app.cjs')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  await writeFile(path.join(output, 'inbox-extension.log'), stdout + stderr);
  const result = JSON.parse(await readFile(path.join(output, 'inbox-extension-checks.json'), 'utf8'));
  console.log(JSON.stringify(result, null, 2));
  if (code !== 0 || !result.ok) process.exitCode = 1;
} finally {
  assert.ok(profile.startsWith(path.join(scratch, 'extension-proxy-profile-')));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
