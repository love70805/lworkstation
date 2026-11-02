import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const builderRequire=createRequire(require.resolve('electron-builder/package.json'));
const appRequire=createRequire(builderRequire.resolve('app-builder-lib/package.json'));
const asarRequire=createRequire(appRequire.resolve('@electron/asar/package.json'));
const legacy=asarRequire('minimatch');
const official=appRequire('minimatch');
for(const [file,pattern,options] of [['a.js','*.js',{}],['.hidden/a.js','**/*.js',{dot:true}],['folder/a.js','*.js',{matchBase:true}],['x\\y.js','**/*.js',{windowsPathsNoEscape:true}]]) {
  assert.equal(legacy(file,pattern,options),official.minimatch(file,pattern,options));
  assert.equal(new legacy.Minimatch(pattern,options).match(file),new official.Minimatch(pattern,options).match(file));
}
assert.equal(legacy.defaults({dot:true})('.file','*'),true);
assert.deepEqual(legacy.match(['a.js','b.ts'],'*.js'),['a.js']);
const glob=asarRequire('glob');
assert.ok(glob.sync('build-compat/**/*.cjs',{cwd:fileURLToPath(new URL('.',import.meta.url))}).some(file=>file.endsWith('index.cjs')));
assert.equal(typeof asarRequire('minimatch'),'function','asar retains callable export');
assert.equal(appRequire('minimatch').Minimatch,official.Minimatch);
console.log('Patched minimatch compatibility: callable/defaults/match/Minimatch, legacy glob and builder/asar consumers passed.');
