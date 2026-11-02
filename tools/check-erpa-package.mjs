import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'integrations/erp-assistant-extension');
const read = file => readFile(path.join(source, file), 'utf8');
const normalize = text => text.replace(/\r\n/g, '\n');

export async function checkErpPackage() {
  const manifest = JSON.parse(await read('manifest.json'));
  const archive = path.join(root, 'frontend/public/integrations/erp-assistant', `ERP-Assistant-v${manifest.version}-shopeers-bridge.zip`);
  const content = await read('src/content.js');
  assert.ok(content.includes(`const EXTENSION_VERSION = '${manifest.version}';`), 'ERP source version differs from its manifest');
  const [frontend, desktop] = await Promise.all(['frontend', 'desktop'].map(dir => readFile(path.join(root, dir, 'package.json'), 'utf8').then(JSON.parse)));
  assert.equal(frontend.version, desktop.version, 'Desktop and workbench versions differ');
  const files = ['manifest.json', 'README.md', ...(await readdir(path.join(source, 'src'))).filter(name => /\.(js|css)$/.test(name)).map(name => `src/${name}`),
    ...(await readdir(path.join(source, 'popup'))).map(name => `popup/${name}`)];
  for (const file of files) {
    const { stdout } = await run(process.platform === 'win32' ? 'tar' : 'unzip', process.platform === 'win32'
      ? ['-xOf', archive, file] : ['-p', archive, file], { windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(normalize(stdout), normalize(await read(file)), `Bundled ERP assistant is stale: ${file}. Rebuild the matching extension package.`);
  }
  return { version: manifest.version, files: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('ERP package verified:', await checkErpPackage());
}
