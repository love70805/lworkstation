const returnPages = new Set(['/workspace', '/profit', '/ledger']);
export function importReturnHref(search, returnTo, ledgerId) {
  const candidate = typeof returnTo === 'string' && returnTo.startsWith('/') ? returnTo : '/profit';
  const [path, query = ''] = candidate.split('?');
  const safePath = returnPages.has(path) ? path : '/profit';
  const params = new URLSearchParams(returnPages.has(path) && query ? query : search);
  const kept = new URLSearchParams();
  for (const key of ['ledger', 'store', 'q', 'supplier', 'missing', 'view']) {
    for (const value of params.getAll(key)) kept.append(key, value);
  }
  if (ledgerId) kept.set('ledger', ledgerId);
  return safePath + (kept.size ? `?${kept}` : '');
}
