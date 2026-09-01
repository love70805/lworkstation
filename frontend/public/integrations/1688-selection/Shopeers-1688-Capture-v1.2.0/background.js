'use strict';

const API_BASE = 'http://127.0.0.1:8790/selection/v1';

function extensionError(code, message, details) {
    const error = new Error(message || code);
    error.code = code;
    if (details) error.details = details;
    return error;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {...options, signal: controller.signal, targetAddressSpace: 'local'});
    } catch (error) {
        if (error?.name === 'AbortError') throw extensionError('timeout', '连接本机工作台超时');
        throw extensionError('network_error', '无法连接本机工作台');
    } finally {
        clearTimeout(timer);
    }
}

function validateCaptureSender(sender) {
    try {
        const sourceUrl = sender?.tab?.url || sender?.url || '';
        const parsed = new URL(sourceUrl);
        return parsed.protocol === 'https:'
            && parsed.hostname === 'order.1688.com'
            && parsed.pathname.startsWith('/order/');
    } catch (_) {
        return false;
    }
}

function validateCaptureEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object'
        || envelope.schemaVersion !== 1
        || envelope.source !== '1688'
        || !envelope.product
        || typeof envelope.product.name !== 'string') {
        throw extensionError('invalid_capture', '采集数据格式无效');
    }
    if (JSON.stringify(envelope).length > 5 * 1024 * 1024) {
        throw extensionError('capture_too_large', '采集数据过大');
    }
}

async function testConnection() {
    const response = await fetchWithTimeout(`${API_BASE}/status`, {method: 'GET', cache: 'no-store'}, 1800);
    if (!response.ok) throw extensionError('connection_failed', '工作台连接检查失败');
    const payload = await response.json().catch(() => ({}));
    if (payload?.ok !== true) throw extensionError('connection_failed', '工作台连接检查失败');
    return {connected: true, port: 8790};
}

async function reportInstalled(pageUrl = '') {
    try {
        await fetchWithTimeout(`${API_BASE}/extension-status`, {
            method: 'POST',
            cache: 'no-store',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                extensionId: 'selection-1688-capture',
                version: chrome.runtime.getManifest().version,
                pageUrl,
                ready: true
            })
        }, 1800);
    } catch (_) {
        // The next heartbeat will retry after the local service starts.
    }
}

async function getActiveCaptureContext() {
    try {
        const response = await fetchWithTimeout(`${API_BASE}/context`, {method: 'GET', cache: 'no-store'}, 1800);
        const payload = await response.json().catch(() => ({}));
        return payload?.context || {};
    } catch (_) {
        return {};
    }
}

async function sendCapture(envelope) {
    validateCaptureEnvelope(envelope);
    const context = await getActiveCaptureContext();
    const response = await fetchWithTimeout(`${API_BASE}/captures`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
            'Content-Type': 'application/json',
            ...(context.workspaceId ? {'x-shopeers-workspace-id': context.workspaceId} : {}),
            ...(context.memberId ? {'x-shopeers-member-id': context.memberId} : {})
        },
        body: JSON.stringify(envelope)
    }, 10000);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
        throw extensionError(payload.code || 'send_failed', payload.error || '发送采集数据失败', payload.errors);
    }
    return payload;
}

async function handleMessage(message, sender) {
    switch (message?.type) {
        case 'getStatus': {
            let connected = false;
            try { connected = (await testConnection()).connected; } catch (_) {}
            return {configured: true, connected, lastPort: 8790, version: chrome.runtime.getManifest().version};
        }
        case 'testConnection':
            return testConnection();
        case 'sendCapture':
            if (!validateCaptureSender(sender)) throw extensionError('unsupported_page', '只允许从 1688 确认订单页发送');
            await reportInstalled(sender?.tab?.url || sender?.url || '');
            return sendCapture(message.envelope);
        default:
            throw extensionError('unknown_message', '未知扩展请求');
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
        .then(result => sendResponse({ok: true, ...result}))
        .catch(error => sendResponse({
            ok: false,
            code: error.code || 'extension_error',
            error: error.message || '扩展处理失败',
            details: error.details || []
        }));
    return true;
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('selection-capture-heartbeat', {periodInMinutes: 1});
    reportInstalled();
});
chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create('selection-capture-heartbeat', {periodInMinutes: 1});
    reportInstalled();
});
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'selection-capture-heartbeat') reportInstalled();
});
chrome.alarms.create('selection-capture-heartbeat', {periodInMinutes: 1});
reportInstalled();

if (globalThis.__SELECTION_WORKBENCH_EXTENSION_TEST__) {
    globalThis.__SELECTION_WORKBENCH_EXTENSION_TEST_API__ = {
        validateCaptureEnvelope,
        validateCaptureSender,
        testConnection
    };
}
