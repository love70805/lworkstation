const text = value => String(value ?? "").normalize("NFKC").trim();
const dimension = /^(?:颜色|色号|尺码|尺寸|规格|型号|款式)\s*:\s*\S/;
const namedKey = part => dimension.test(part) ? part.slice(0, part.indexOf(":")).trim() : null;
const code = part => /^[A-Za-z0-9]+(?:件|个|套)?$/.test(part);
const role = part => /^[\p{Script=Han}]{1,6}色$|^(?:Black|White|Pink|Blue|Red|Green|Yellow|Purple|Grey|Gray)$/iu.test(part) ? "color"
  : /^(?:均码|[XSML]{1,4}|[2-9]XL)$/i.test(part) ? "size" : code(part) ? "code" : null;

// Compare explicit dimensions or two clear attribute branches. A short letter
// code can appear before/after the same Chinese description in ERP and ledgers.
// Numeric ranges, ratios, repeated dimensions and ambiguous prose stay literal.
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
  const descriptionPair = parts.length === 2
    && parts.filter(part => /^[A-Za-z][A-Za-z0-9]{0,7}$/.test(part)).length === 1
    && parts.filter(part => /\p{Script=Han}/u.test(part) && !namedKey(part)).length === 1;
  if (parts.every(Boolean) && (namedDimensions || simplePair || descriptionPair)) {
    return JSON.stringify(["dimensions", ...parts.toSorted()]);
  }
  return JSON.stringify(["literal", raw]);
}
