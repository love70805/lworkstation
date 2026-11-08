import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import editionRuntime from './desktop-edition.cjs';
import extensions from './extension-runtime.cjs';

const { initializeDesktopEdition } = editionRuntime;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lworkstation-edition-'));
const betaMetadata = { lworkstationEdition: 'beta' };
function fakeApp() {
  const paths = {
    appData: path.join(root, 'AppData'),
    documents: path.join(root, 'Documents'),
    userData: path.join(root, 'legacy-profile'),
    sessionData: path.join(root, 'legacy-session'),
  };
  return {
    paths,
    setName(value) { this.name = value; },
    setAppUserModelId(value) { this.modelId = value; },
    setPath(key, value) { assert.ok(fs.statSync(value).isDirectory()); paths[key] = value; },
    getPath(key) { assert.ok(paths[key], key); return paths[key]; },
  };
}
try {
  const stable = fakeApp(), beta = fakeApp();
  const regular = initializeDesktopEdition(stable, { version: '2.0.7-beta.1' }, {});
  const sidecar = initializeDesktopEdition(beta, betaMetadata, {
    SHOPEERS_ERP_INBOX_PORT: '8790', SHOPEERS_ERP_INBOX_FILE: regular.spoolPath,
  });
  assert.equal(regular.edition, 'stable', 'legacy prerelease keeps its original identity');
  assert.equal(stable.name, undefined);
  assert.equal(stable.modelId, 'com.shopeers.workstation');
  assert.equal(stable.paths.userData, path.join(root, 'legacy-profile'));
  assert.equal(stable.paths.sessionData, path.join(root, 'legacy-session'));
  assert.equal(sidecar.edition, 'beta');
  assert.equal(beta.name, 'Lworkstation Beta');
  assert.equal(beta.modelId, 'com.shopeers.workstation.beta');
  assert.equal(beta.paths.userData, path.join(beta.paths.appData, beta.name));
  assert.equal(beta.paths.sessionData, beta.paths.userData);
  assert.equal(sidecar.spoolPath, path.join(beta.paths.userData, 'runtime', 'erp-inbox.json'));
  assert.equal(regular.spoolPath, path.join(stable.paths.userData, 'runtime', 'erp-inbox.json'));
  assert.equal(regular.backupDirectory, path.join(stable.paths.documents, 'Lworkstation 备份'));
  assert.equal(sidecar.backupDirectory, path.join(beta.paths.documents, 'Lworkstation Beta 备份'));
  assert.equal(regular.inboxPort, 8790);
  assert.equal(sidecar.inboxPort, 8791);
  const integration = new URL('../integrations/erp-assistant-extension/', import.meta.url);
  for (const [app, config] of [[stable, regular], [beta, sidecar]]) {
    const location = await extensions.prepareRuntimeExtension({
      sourceDirectory: integration, port: config.inboxPort, runtimeId: 'erp', userDataPath: app.paths.userData,
    });
    const baseUrl = 'http://127.0.0.1:' + config.inboxPort;
    const storage = extensions.extensionStorageConfig({ port: config.inboxPort, workspaceId: 'fixture', capability: 'x'.repeat(40) });
    assert.equal(storage.shopeersErpInboxBaseUrl, baseUrl);
    assert.ok(fs.readFileSync(path.join(location, 'src', 'shopeers-bridge.js'), 'utf8').includes(JSON.stringify(baseUrl)));
    assert.equal(path.relative(app.paths.userData, location), path.join('Lworkstation-runtime-extensions', 'erp'));
  }
  const common = {
    SHOPEERS_DESKTOP_SMOKE_USER_DATA: path.join(root, 'smoke-legacy'),
    SHOPEERS_DESKTOP_SMOKE_CACHE: path.join(root, 'cache'),
    SHOPEERS_DESKTOP_SMOKE_PROFILE_ROOT: path.join(root, 'profiles'),
  };
  for (const [app, metadata] of [[stable, {}], [beta, betaMetadata]]) {
    const env = { ...common };
    const cfg = initializeDesktopEdition(app, metadata, env);
    const expected = app === stable ? common.SHOPEERS_DESKTOP_SMOKE_USER_DATA : path.join(common.SHOPEERS_DESKTOP_SMOKE_PROFILE_ROOT, beta.name);
    assert.equal(cfg.smokeUserDataPath, expected);
    assert.equal(app.paths.sessionData, expected);
    assert.equal(app.paths.userData, expected);
    assert.equal(cfg.backupDirectory, path.join(expected, 'backups'));
    assert.equal(app.paths.cache, app === stable ? common.SHOPEERS_DESKTOP_SMOKE_CACHE : path.join(common.SHOPEERS_DESKTOP_SMOKE_CACHE, beta.name));
    assert.equal(env.LOCALAPPDATA, app.paths.cache);
  }
  const smoke = initializeDesktopEdition(beta, betaMetadata, {
    SHOPEERS_DESKTOP_SMOKE_USER_DATA: path.join(root, 'ordinary-smoke'),
    SHOPEERS_ERP_INBOX_PORT: '28007', SHOPEERS_ERP_INBOX_FILE: path.join(root, 'inbox.json'),
  });
  assert.equal(beta.paths.userData, path.join(root, 'ordinary-smoke'));
  assert.equal(smoke.inboxPort, 28007);
  assert.equal(smoke.spoolPath, path.join(root, 'inbox.json'));
  console.log('desktop edition profile, backup, inbox and extension isolation tests passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
