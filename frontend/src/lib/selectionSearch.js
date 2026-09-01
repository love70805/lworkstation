export function normalizeSelectionSearchQuery(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

/** Search-only helper for the selection workspace. Keep source links and cost evidence out of this index. */
export function matchesSelectionSearch(query, fields = []) {
  const normalizedQuery = normalizeSelectionSearchQuery(query);
  if (!normalizedQuery) return true;
  return fields
    .flatMap((field) => Array.isArray(field) ? field : [field])
    .map((field) => String(field ?? "").toLocaleLowerCase())
    .some((field) => field.includes(normalizedQuery));
}
