function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fallbackContentHash(input) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  const source = stableSerialize(input);
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export async function syncEventContentHash(event) {
  const source = stableSerialize(event);
  if (globalThis.crypto?.subtle && typeof TextEncoder !== "undefined") {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return fallbackContentHash(event);
}

export { stableSerialize as stableSyncSerialize };
