// Keep the exact attempt identity while retaining a fixed-size key instead of
// a second serialized copy of the complete supplier/purchase history.
export async function prestorageAttemptFingerprint(product) {
  const serialized = JSON.stringify([product.updatedAt, product.draft, product.prefill]);
  if (!globalThis.crypto?.subtle) return serialized;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
