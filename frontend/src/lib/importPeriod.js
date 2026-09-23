export function summarizeImportPeriod(files, existingPeriod = null) {
  const parsed = files.filter((file) => file.status === "parsed");
  const awaitingEvidence = files.some((file) => file.status === "queued" || (file.status === "parsed" && !file.periodEvidence));
  const distribution = new Map();
  let missingCount = 0;
  let invalidCount = 0;
  let errorCount = 0;
  for (const file of parsed) {
    const evidence = file.periodEvidence;
    if (!evidence) continue;
    for (const item of evidence.distribution ?? []) distribution.set(item.month, (distribution.get(item.month) ?? 0) + item.count);
    missingCount += evidence.missingCount ?? 0;
    invalidCount += evidence.invalidCount ?? 0;
    errorCount += evidence.errorCount ?? 0;
  }
  const months = [...distribution].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
  const reliable = files.length > 0 && parsed.length === files.length && !awaitingEvidence &&
    months.length === 1 && missingCount === 0 && invalidCount === 0 && errorCount === 0 &&
    parsed.every((file) => file.periodEvidence?.suggestedPeriod === months[0].month);
  const suggestedPeriod = reliable ? months[0].month : null;
  const conflictsExisting = Boolean(existingPeriod && months.some(({ month }) => month !== existingPeriod));
  return { months, missingCount, invalidCount, errorCount, awaitingEvidence, suggestedPeriod, conflictsExisting };
}
