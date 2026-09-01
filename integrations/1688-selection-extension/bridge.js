(() => {
    'use strict';

    function makeError(code, message, details) {
        const error = new Error(message || code || 'extension_error');
        error.code = code || 'extension_error';
        if (details) error.details = details;
        return error;
    }

    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, response => {
                const runtimeError = chrome.runtime.lastError;
                if (runtimeError) {
                    reject(makeError('extension_unavailable', runtimeError.message));
                    return;
                }
                if (!response || response.ok !== true) {
                    reject(makeError(
                        response?.code || 'extension_error',
                        response?.error || '浏览器扩展后台无响应',
                        response?.details
                    ));
                    return;
                }
                resolve(response);
            });
        });
    }

    function copyWithTextarea(value) {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            return document.execCommand('copy');
        } finally {
            textarea.remove();
        }
    }

    const bridge = Object.freeze({
        addStyle(cssText) {
            const style = document.createElement('style');
            style.dataset.selectionWorkbench = 'capture-style';
            style.textContent = String(cssText || '');
            (document.head || document.documentElement).appendChild(style);
            return style;
        },

        async sendCapture(envelope) {
            return sendMessage({type: 'sendCapture', envelope});
        },

        copyText(text) {
            const value = String(text || '');
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(value).catch(() => copyWithTextarea(value));
                return;
            }
            copyWithTextarea(value);
        }
    });

    Object.defineProperty(globalThis, 'SelectionWorkbenchExtensionBridge', {
        value: bridge,
        configurable: false,
        enumerable: false,
        writable: false
    });
})();
