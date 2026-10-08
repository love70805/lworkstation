import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyErpState, getSurfacePresentation } = require('./shell-state.cjs');
const extension = {
  ready: true, context: 'extension-isolated', handshakeVersion: 1, workspaceId: 'test-workspace',
  lastSeenAt: new Date().toISOString(), sessionState: 'authenticated', pageState: 'page_ready', queryAvailable: false,
};
const inbox = { status: 'online', workspaceId: 'test-workspace', latestExtension: extension, extensionLoadState: 'loaded', pageStatus: 'ready' };
assert.equal(classifyErpState({ ...inbox, extensionLoadState: 'deferred', pageStatus: 'idle' }).tone, 'muted');
assert.match(classifyErpState({ ...inbox, extensionLoadState: 'deferred', pageStatus: 'idle' }).aria, /尚未打开/);
assert.equal(classifyErpState({ ...inbox, extensionLoadState: 'deferred', pageStatus: 'idle', status: 'error' }).tone, 'danger');
assert.equal(getSurfacePresentation({ activeTab: 'workspace', startup: { status: 'error', message: '需要重试' } }).message, '需要重试');
assert.equal(getSurfacePresentation({ activeTab: 'erp', tabs: { erp: { title: 'ERP', status: 'loading' } } }).status, 'loading');
assert.match(getSurfacePresentation({ activeTab: '1688', tabs: { '1688': { title: '1688', status: 'loading' } } }).message, /加载 1688/);
assert.equal(getSurfacePresentation({ activeTab: 'erp', tabs: { erp: { status: 'error', error: '安全配置失败' } } }).message, '安全配置失败');
assert.equal(getSurfacePresentation({ activeTab: 'erp', tabs: { erp: { status: 'ready' } } }).status, 'ready');
assert.equal(classifyErpState(inbox).tone, 'success', 'a fresh authenticated page handshake is ready without opening purchase');
assert.match(classifyErpState(inbox).aria, /采集前.*采购管理查询/);
assert.equal(classifyErpState({ ...inbox, latestExtension: null }).tone, 'warning', 'loaded extension and online service alone cannot turn green');
assert.equal(classifyErpState({ ...inbox, latestExtension: { ...extension, context: 'extension-background' } }).tone, 'warning');
assert.equal(classifyErpState({ ...inbox, latestExtension: { ...extension, sessionState: 'unknown' } }).label, '登录待确认');
assert.equal(classifyErpState({ ...inbox, latestExtension: { ...extension, sessionState: 'login_required' } }).label, '需要登录');
assert.equal(classifyErpState({ ...inbox, latestExtension: { ...extension, lastSeenAt: new Date(Date.now() - 46000).toISOString() } }).tone, 'danger', 'stale handshake revokes green');
assert.equal(classifyErpState({ ...inbox, latestExtension: { ...extension, ready: false } }).tone, 'danger');
assert.equal(classifyErpState({ ...inbox, workspaceId: 'another-workspace' }).tone, 'warning');
assert.equal(classifyErpState({ ...inbox, status: 'error' }).tone, 'danger');
assert.equal(classifyErpState({ ...inbox, pageStatus: 'loading' }).tone, 'warning');
assert.equal(classifyErpState({ ...inbox, pageStatus: 'error' }).tone, 'danger');
assert.equal(classifyErpState({ ...inbox, extensionLoadState: 'failed' }).tone, 'danger');
assert.equal(classifyErpState({ ...inbox, navigationStartedAt: Date.now() + 1 }).tone, 'warning', 'old page handshakes cannot remain green across refresh/navigation');
assert.equal(classifyErpState({ ...inbox, latestExtension: { ...extension, queryAvailable: true } }).aria, 'ERP 助手通信就绪，采购查询可用');
console.log('ERP assistant actual-handshake, login, freshness, workspace and recovery state tests passed.');
