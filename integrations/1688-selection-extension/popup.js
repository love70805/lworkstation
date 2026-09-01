'use strict';

const LOCAL_HOST_PERMISSIONS = ['http://127.0.0.1/*', 'http://localhost/*'];
const RUNTIME_STORAGE_KEYS = [
    'shopeersErpInboxBaseUrl',
    'shopeersErpInboxCapability',
    'shopeersErpWorkspaceId',
];
const statusCard = document.getElementById('statusCard');
const statusTitle = document.getElementById('statusTitle');
const statusText = document.getElementById('statusText');
const version = document.getElementById('version');
const testButton = document.getElementById('testButton');
const openButton = document.getElementById('openButton');

function sendMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, response => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) return reject(new Error(runtimeError.message));
            resolve(response || {ok: false, error: '扩展后台无响应'});
        });
    });
}

function render(type, title, detail) {
    statusCard.className = `status-card status-${type}`;
    statusTitle.textContent = title;
    statusText.textContent = detail;
}

async function hasLocalHostPermission() {
    return chrome.permissions.contains({origins: LOCAL_HOST_PERMISSIONS});
}

async function requestLocalHostPermission() {
    return chrome.permissions.request({origins: LOCAL_HOST_PERMISSIONS});
}

async function hasRuntimeConfig() {
    const stored = await chrome.storage.local.get(RUNTIME_STORAGE_KEYS);
    const baseUrl = typeof stored?.shopeersErpInboxBaseUrl === 'string' ? stored.shopeersErpInboxBaseUrl.trim() : '';
    const capability = typeof stored?.shopeersErpInboxCapability === 'string' ? stored.shopeersErpInboxCapability.trim() : '';
    const workspaceId = typeof stored?.shopeersErpWorkspaceId === 'string' ? stored.shopeersErpWorkspaceId.trim() : '';
    if (!baseUrl || capability.length < 32 || !workspaceId) return false;
    try {
        const parsed = new URL(baseUrl);
        const path = parsed.pathname.replace(/\/+$/, '');
        return parsed.protocol === 'http:'
            && ['127.0.0.1', 'localhost'].includes(parsed.hostname.toLowerCase())
            && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
            && (!path || path === '/selection/v1');
    } catch (_) {
        return false;
    }
}

async function testConnection({requestPermission = false} = {}) {
    testButton.disabled = true;
    testButton.textContent = '重新检测连接';
    render('idle', '正在连接...', '读取 Shopeers 桌面连接配置');
    try {
        if (!await hasRuntimeConfig()) return render('warning', '等待工作站配置', '请先启动 Shopeers 工作站并等待安全连接配置注入');
        let permitted = await hasLocalHostPermission();
        if (!permitted && requestPermission) permitted = await requestLocalHostPermission();
        if (!permitted) {
            testButton.textContent = '授权并连接';
            return render('warning', '需要本机访问权限', '点击下方按钮，允许扩展连接 Shopeers');
        }

        const result = await sendMessage({type: 'testConnection'});
        if (!result.ok) return render('error', result.code === 'not_configured' ? '等待工作站配置' : '未连接工作台', result.error || '请先启动 Shopeers');
        render('connected', '已连接工作台', '采集结果会自动进入待确认队列');
    } catch (error) {
        render('error', '本地连接被阻止', '请确认 Shopeers 已启动，并允许扩展访问本地网络');
    } finally {
        testButton.disabled = false;
    }
}

testButton.addEventListener('click', () => testConnection({requestPermission: true}));
openButton.addEventListener('click', () => chrome.tabs.create({url: 'http://127.0.0.1:5173/products?view=pending'}));
version.textContent = `v${chrome.runtime.getManifest().version}`;
testConnection();
