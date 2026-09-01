'use strict';

const RUNTIME_STORAGE_KEYS = Object.freeze([
    'shopeersErpInboxBaseUrl',
    'shopeersErpInboxCapability',
    'shopeersErpWorkspaceId',
]);
const MIN_CAPABILITY_LENGTH = 32;

function normalizeRuntimeConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const baseUrl = typeof raw.shopeersErpInboxBaseUrl === 'string' ? raw.shopeersErpInboxBaseUrl.trim() : '';
    const capability = typeof raw.shopeersErpInboxCapability === 'string' ? raw.shopeersErpInboxCapability.trim() : '';
    const workspaceId = typeof raw.shopeersErpWorkspaceId === 'string' ? raw.shopeersErpWorkspaceId.trim() : '';
    if (capability.length < MIN_CAPABILITY_LENGTH || !workspaceId) return null;
    let parsed;
    try {
        parsed = new URL(baseUrl);
    } catch (_) {
        return null;
    }
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname.toLowerCase()) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        return null;
    }
    const path = parsed.pathname.replace(/\/+$/, '');
    if (path && path !== '/selection/v1') return null;
    return {
        baseUrl: `${parsed.origin}/selection/v1`,
        capability,
        workspaceId,
    };
}

async function readRuntimeConfig() {
    const stored = await chrome.storage.local.get(RUNTIME_STORAGE_KEYS);
    return normalizeRuntimeConfig(stored);
}

function requireRuntimeConfig(config) {
    if (!config) throw extensionError('not_configured', '桌面连接配置不可用，请先启动 Shopeers 工作站');
    return config;
}

function authorizedHeaders(config, headers = {}) {
    return {
        ...headers,
        Authorization: `Bearer ${config.capability}`,
    };
}

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
        return await fetch(url, {...options, signal: controller.signal});
    } catch (error) {
        if (error?.name === 'AbortError') throw extensionError('timeout', '连接本机工作台超时');
        throw extensionError('network_error', '无法连接本机工作台', error?.message || String(error));
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

function sanitizeCaptureEnvelope(envelope) {
    const product = envelope.product || {};
    return {
        schemaVersion: 1,
        requestId: String(envelope.requestId || '').slice(0, 160),
        source: '1688',
        sourceUrl: String(envelope.sourceUrl || '').slice(0, 2000),
        capturedAt: envelope.capturedAt || Date.now(),
        extractorVersion: String(envelope.extractorVersion || '').slice(0, 160),
        product: {
            name: String(product.name || '').slice(0, 1000),
            sourceProductId: String(product.sourceProductId || '').slice(0, 200),
            imageUrl: String(product.imageUrl || '').slice(0, 2000),
            purchasePrice: product.purchasePrice ?? null,
            priceMin: product.priceMin ?? null,
            priceMax: product.priceMax ?? null,
            rawPrice: String(product.rawPrice || '').slice(0, 500),
            shippingFee: product.shippingFee ?? null,
            purchaseQty: product.purchaseQty ?? null,
            bundleQty: product.bundleQty ?? null,
            platformSkc: String(product.platformSkc || '').slice(0, 200),
            skus: Array.isArray(product.skus) ? product.skus.slice(0, 500).map((sku) => ({
                spec: String(sku?.spec || '').slice(0, 500),
                sourceSkuId: String(sku?.sourceSkuId || '').slice(0, 200),
                purchasePrice: sku?.purchasePrice ?? null,
                imageUrl: String(sku?.imageUrl || '').slice(0, 2000),
                purchaseQty: sku?.purchaseQty ?? null,
                lineSubtotal: sku?.lineSubtotal ?? null,
            })) : [],
        },
        warnings: Array.isArray(envelope.warnings) ? envelope.warnings.slice(0, 100).map((warning) => ({
            code: String(warning?.code || '').slice(0, 64),
            field: warning?.field ? String(warning.field).slice(0, 128) : undefined,
            message: String(warning?.message || '').slice(0, 500),
        })) : [],
    };
}

async function testConnection() {
    const config = requireRuntimeConfig(await readRuntimeConfig());
    const response = await fetchWithTimeout(`${config.baseUrl}/status`, {method: 'GET', cache: 'no-store', headers: authorizedHeaders(config)}, 1800);
    if (!response.ok) throw extensionError('connection_failed', '工作台连接检查失败');
    const payload = await response.json().catch(() => ({}));
    if (payload?.ok !== true) throw extensionError('connection_failed', '工作台连接检查失败');
    return {connected: true, origin: new URL(config.baseUrl).origin};
}

async function reportInstalled(pageUrl = '', {strict = false} = {}) {
    try {
        const config = requireRuntimeConfig(await readRuntimeConfig());
        const response = await fetchWithTimeout(`${config.baseUrl}/extension-status`, {
            method: 'POST',
            cache: 'no-store',
            headers: authorizedHeaders(config, {'Content-Type': 'application/json'}),
            body: JSON.stringify({
                extensionId: 'selection-1688-capture',
                version: chrome.runtime.getManifest().version,
                pageUrl,
                ready: true
            })
        }, 1800);
        if (!response.ok) throw extensionError('connection_failed', '扩展状态登记失败');
        return true;
    } catch (error) {
        if (strict) throw error;
        // The next heartbeat will retry after the local service starts.
        return false;
    }
}

async function sendCapture(envelope) {
    validateCaptureEnvelope(envelope);
    const safeEnvelope = sanitizeCaptureEnvelope(envelope);
    const config = requireRuntimeConfig(await readRuntimeConfig());
    const response = await fetchWithTimeout(`${config.baseUrl}/captures`, {
        method: 'POST',
        cache: 'no-store',
        headers: authorizedHeaders(config, {
            'Content-Type': 'application/json',
        }),
        body: JSON.stringify(safeEnvelope)
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
            const config = await readRuntimeConfig();
            let connected = false;
            if (config) {
                try { connected = (await testConnection()).connected; } catch (_) {}
            }
            return {configured: Boolean(config), connected, origin: config?.baseUrl ? new URL(config.baseUrl).origin : null, version: chrome.runtime.getManifest().version};
        }
        case 'testConnection': {
            const result = await testConnection();
            await reportInstalled('', {strict: true});
            return result;
        }
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
        RUNTIME_STORAGE_KEYS,
        normalizeRuntimeConfig,
        readRuntimeConfig,
        validateCaptureEnvelope,
        sanitizeCaptureEnvelope,
        validateCaptureSender,
        testConnection,
        reportInstalled,
        sendCapture
    };
}
