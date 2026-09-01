'use strict';

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

async function testConnection() {
    testButton.disabled = true;
    render('idle', '正在连接...', '检测 127.0.0.1:8790');
    try {
        const result = await sendMessage({type: 'testConnection'});
        if (!result.ok) return render('error', '未连接工作台', result.error || '请先启动 Shopeers');
        render('connected', '已连接工作台', '采集结果会自动进入待确认队列');
    } catch (error) {
        render('error', '扩展异常', error.message || '无法连接本机工作台');
    } finally {
        testButton.disabled = false;
    }
}

testButton.addEventListener('click', testConnection);
openButton.addEventListener('click', () => chrome.tabs.create({url: 'http://127.0.0.1:5173/products?view=pending'}));
version.textContent = `v${chrome.runtime.getManifest().version}`;
testConnection();
