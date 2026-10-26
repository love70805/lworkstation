import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(desktop);
const require = createRequire(import.meta.url);
const frontendRequire = createRequire(path.join(root, 'frontend/package.json'));
const { build } = createRequire(frontendRequire.resolve('vite/package.json'))('esbuild');
const out = path.resolve(process.env.ERP_BENCH_OUTPUT || path.join(root, 'archive/erp-speed-benchmark-20261027'));
const site = path.join(out, 'scratch/site');
await mkdir(path.join(site, 'src/workers'), { recursive: true });
const common = { bundle: true, platform: 'browser', target: 'es2022', minify: false, logLevel: 'warning', define: { 'import.meta.env': '{}', 'import.meta.url': JSON.stringify('https://benchmark.invalid/src/data/repositories/derivedComputationService.js') } };
await build({ ...common, entryPoints: [path.join(root, 'tools/fixtures/erp-speed-local-entry.js')], outfile: path.join(site, 'local.js'), format: 'iife', globalName: 'ERPBenchmarkLocal' });
await build({ ...common, entryPoints: [path.join(root, 'frontend/src/workers/derived.worker.js')], outfile: path.join(site, 'src/workers/derived.worker.js'), format: 'esm' });
const runId = `${Date.now()}-${process.pid}`;
const child = spawn(require('electron'), [path.join(desktop, 'erp-speed-benchmark-app.cjs')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ERP_BENCH_OUTPUT: out, ERP_BENCH_RUN_ID: runId } });
let stdout = '', stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
child.stderr.on('data', chunk => { stderr += chunk; });
const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
await writeFile(path.join(out, 'native-stdout.log'), stdout);
await writeFile(path.join(out, 'native-stderr.log'), stderr);
process.exitCode = code || 0;
if (!code) {
  const result = JSON.parse(await readFile(path.join(out, 'results.json'), 'utf8'));
  if (!result.ok || result.runId !== runId) throw new Error('No completed result from this native benchmark process');
}
