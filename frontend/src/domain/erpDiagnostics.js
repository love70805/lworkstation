// Bounded business response evidence only; request headers, URLs and session
// configuration are never part of this contract.
export function normalizeErpDiagnostic(value) {
  let source;
  try { source = typeof value === 'string' ? JSON.parse(value) : value; } catch { return ''; }
  if (!source || typeof source !== 'object') return '';
  const clean = (item, depth = 0) => {
    if (depth > 4) return '[已省略]';
    if (Array.isArray(item)) return item.slice(0, 3).map(entry => clean(entry, depth + 1));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).filter(([key]) => !/(token|cookie|auth|password|passwd|secret|session|credential|capability|headers?|config|url)/i.test(key)).slice(0, 20).map(([key, entry]) => [key, clean(entry, depth + 1)]));
    if (typeof item === 'string') return item.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]').replace(/((?:token|cookie|password|secret|session|authorization)\s*[=:]\s*)[^\s,;"']+/gi, '$1[已隐藏]').slice(0, 180);
    return item;
  };
  const result = JSON.stringify(clean(source));
  return result.length <= 2400 ? result : JSON.stringify({ message: 'ERP 返回较长，以下为截取内容', excerpt: result.slice(0, 2000) });
}
