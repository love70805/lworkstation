export function normalizeSelectionSearchQuery(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

/** Search-only helper for the selection workspace. Keep source links and cost evidence out of this index. */
export function matchesSelectionSearch(query, fields = []) {
  const normalizedQuery = normalizeSelectionSearchQuery(query);
  if (!normalizedQuery) return true;
  return selectionSearchText(fields).includes(normalizedQuery);
}

function selectionSearchText(fields) {
  return fields.flat(Infinity).map((field) => String(field ?? "").toLocaleLowerCase()).join("\u0000");
}

/** Lazy index for immutable read-model rows; call only after narrowing the scope. */
export function createSelectionSearchIndex(readFields) {
  const index = new WeakMap();
  return (row, normalizedQuery) => {
    if (!normalizedQuery) return true;
    let text = index.get(row);
    if (text === undefined) {
      text = selectionSearchText(readFields(row));
      index.set(row, text);
    }
    return text.includes(normalizedQuery);
  };
}
