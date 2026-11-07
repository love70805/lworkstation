const { build } = require('./package.json');
const beta = require('./beta-installation.json');
const icon = 'assets/lworkstation-beta.ico';

// A different installer is required for side-by-side operation. Never change
// the stable defaults or derive this permanent Windows identity from a version.
module.exports = {
  ...build,
  electronDist: './node_modules/electron/dist',
  afterPack: './release-after-pack.cjs',
  publish: build.publish.map(provider => ({...provider, channel: beta.channel, releaseType: 'prerelease'})),
  appId: beta.appId,
  productName: beta.productName,
  files: [...build.files, icon],
  extraMetadata: {name: beta.packageName, productName: beta.productName, lworkstationEdition: 'beta'},
  win: {...build.win, icon, executableName: beta.productName, artifactName: beta.artifactPattern},
  nsis: {
    ...build.nsis,
    guid: beta.guid,
    include: 'installer-beta.nsh',
    allowToChangeInstallationDirectory: false,
    shortcutName: beta.productName,
    uninstallDisplayName: beta.productName + ' ${version}',
    installerIcon: icon, installerHeaderIcon: icon, uninstallerIcon: icon,
  },
};
