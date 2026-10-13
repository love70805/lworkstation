const text = value => String(value ?? "").normalize("NFKC").trim();
const dimension = /^(?:颜色|色号|尺码|尺寸|规格|型号|款式)\s*:\s*\S/;
const namedKey = part => dimension.test(part) ? part.slice(0, part.indexOf(":")).trim() : null;
const code = part => /^[A-Za-z0-9]+(?:件|个|套)?$/.test(part);
const role = part => /^[\p{Script=Han}]{1,6}色$|^(?:Black|White|Pink|Blue|Red|Green|Yellow|Purple|Grey|Gray)$/iu.test(part) ? "color"
  : /^(?:均码|[XSML]{1,4}|[2-9]XL)$/i.test(part) ? "size" : code(part) ? "code" : null;

// Compare only explicit attribute dimensions or a clear color/size + code pair.
// Numeric ranges, ratios and arbitrary prose keep their original meaning.
// This key never replaces raw attributes, platform identities or cost evidence.
export function catalogAttributeKey(value) {
  const raw = text(value);
  const parts = raw.split(/\s*[-;|]\s*/).map(text);
  const named = parts.map(namedKey);
  const namedDimensions = parts.length >= 2 && parts.length <= 4
    && named.every(Boolean) && new Set(named).size === parts.length;
  const roles = parts.map(role);
  const simplePair = parts.length === 2 && roles.every(Boolean)
    && new Set(roles).size === 2 && roles.some(value => value !== "code");
  if (parts.every(Boolean) && (namedDimensions || simplePair)) {
    return JSON.stringify(["dimensions", ...parts.toSorted()]);
  }
  return JSON.stringify(["literal", raw]);
}
