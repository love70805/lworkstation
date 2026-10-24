const fs = require('node:fs');
const path = require('node:path');

const EVENTS = new Set(['startup', 'shutdown', 'sample', 'render-process-gone', 'unresponsive', 'child-process-gone']);
const PAGES = new Set(['main', 'shell', 'workspace', 'erp', 'gpu', 'utility', 'unknown']);
const REASONS = new Set(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction']);
const MEMORY_FIELDS = ['workingSetKiB', 'privateKiB', 'sharedKiB', 'peakWorkingSetKiB'];
const DEFAULT_MAX_BYTES = 256 * 1024;

// This is a local technical journal, never a dump of an Electron event or an
// Error. Explicit fields prevent URLs, task IDs, payloads and credentials from
// entering diagnostics, even when callers pass a larger object by mistake.
function createRuntimeDiagnostics({ userDataPath, version, operations = fs, now = () => new Date(), maxBytes = DEFAULT_MAX_BYTES } = {}) {
  let filePath, previousPath;
  try {
    if (typeof userDataPath === 'string' && userDataPath) {
      const directory = path.join(path.resolve(userDataPath), 'runtime');
      filePath = path.join(directory, 'diagnostics.jsonl');
      previousPath = path.join(directory, 'diagnostics.previous.jsonl');
    }
  } catch { /* An unavailable diagnostic path cannot block startup. */ }
  const safeVersion = typeof version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?$/.test(version) ? version : 'unknown';
  const budget = Number.isSafeInteger(maxBytes) && maxBytes >= 512 ? Math.min(maxBytes, 1024 * 1024) : DEFAULT_MAX_BYTES;

  function record(event, details = {}) {
    try {
      if (!filePath || !EVENTS.has(event)) return false;
      const row = { timestamp: new Date(now()).toISOString(), version: safeVersion, event };
      if (PAGES.has(details?.page)) row.page = details.page;
      if (details?.reason !== undefined) row.reason = REASONS.has(details.reason) ? details.reason : 'unknown';
      if (Number.isInteger(details?.exitCode) && details.exitCode >= -2147483648 && details.exitCode <= 4294967295) row.exitCode = details.exitCode;
      for (const field of MEMORY_FIELDS) {
        const value = details?.[field];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) row[field] = value;
      }
      if (typeof details?.cpuPercent === 'number' && Number.isFinite(details.cpuPercent) && details.cpuPercent >= 0 && details.cpuPercent <= 100) row.cpuPercent = details.cpuPercent;
      const line = JSON.stringify(row) + '\n', bytes = Buffer.byteLength(line, 'utf8');
      if (bytes > budget) return false;
      operations.mkdirSync(path.dirname(filePath), { recursive: true });
      const size = operations.existsSync(filePath) ? operations.statSync(filePath).size : 0;
      if (size + bytes > budget) {
        if (operations.existsSync(previousPath)) operations.unlinkSync(previousPath);
        if (operations.existsSync(filePath)) {
          // Do not preserve an unexpectedly oversized pre-existing file as a
          // second unbounded log. These two paths contain diagnostics only.
          if (size > budget) operations.unlinkSync(filePath);
          else operations.renameSync(filePath, previousPath);
        }
      }
      operations.appendFileSync(filePath, line, 'utf8');
      return true;
    } catch { return false; } // Storage failures must never affect the app.
  }
  return { record, filePath };
}

module.exports = { createRuntimeDiagnostics };
