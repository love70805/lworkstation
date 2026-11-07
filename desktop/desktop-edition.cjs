const fs = require('node:fs');
const path = require('node:path');
const betaInstallation = require('./beta-installation.json');

function initializeDesktopEdition(app, metadata, env = process.env) {
  const beta = metadata.lworkstationEdition === 'beta';
  const edition = beta ? 'beta' : 'stable';
  const productName = beta ? betaInstallation.productName : 'Lworkstation';
  const appId = beta ? betaInstallation.appId : 'com.shopeers.workstation';
  const iconFile = beta ? 'lworkstation-beta.ico' : 'lworkstation.ico';
  const smokeOverride = env.SHOPEERS_DESKTOP_SMOKE_USER_DATA;
  const smokeRoot = smokeOverride && env.SHOPEERS_DESKTOP_SMOKE_PROFILE_ROOT;
  let profilePath;
  if (beta) {
    app.setName(productName);
    if (smokeRoot) profilePath = path.resolve(smokeRoot, productName);
    else if (smokeOverride) profilePath = path.resolve(smokeOverride);
    else profilePath = path.join(app.getPath('appData'), productName);
  } else if (smokeOverride) {
    profilePath = path.resolve(smokeOverride);
  }
  // Electron keys its process singleton and Chromium sessions to these paths.
  // Apply both before taking the lock or obtaining any Session.
  if (profilePath) {
    fs.mkdirSync(profilePath, { recursive: true });
    app.setPath('userData', profilePath);
    app.setPath('sessionData', profilePath);
  }
  app.setAppUserModelId(appId);
  if (env.SHOPEERS_DESKTOP_SMOKE_CACHE) {
    const cachePath = path.resolve(env.SHOPEERS_DESKTOP_SMOKE_CACHE, beta && smokeRoot ? productName : '');
    fs.mkdirSync(cachePath, { recursive: true });
    app.setPath('cache', cachePath);
    env.LOCALAPPDATA = cachePath;
  }
  const userData = app.getPath('userData');
  // Legacy installations may use a custom inbox. An ordinary Beta launch owns
  // its port and spool even when started from a legacy configured environment.
  const allowInboxOverride = !beta || Boolean(smokeOverride);
  const defaultPort = beta ? 8791 : 8790;
  const inboxPort = Number((allowInboxOverride && env.SHOPEERS_ERP_INBOX_PORT) || defaultPort);
  const spoolPath = (allowInboxOverride && env.SHOPEERS_ERP_INBOX_FILE) || path.join(userData, 'runtime', 'erp-inbox.json');
  const backupDirectory = smokeOverride ? path.join(userData, 'backups') : path.join(app.getPath('documents'), productName + ' 备份');
  return { edition, productName, iconFile, inboxPort, spoolPath, backupDirectory, smokeUserDataPath: smokeOverride ? userData : null };
}

module.exports = { initializeDesktopEdition };
