import Papa from "papaparse";
import * as XLSX from "xlsx";
import { collectSalesImportFacets, salesPeriodEvidenceFromValidation, detectLedgerReport, suggestLedgerReportMapping, suggestMappings, validateSalesRows } from "../lib/salesImport";

import { workbookSheetChunks } from "../lib/workbookSheetChunks";
import { workbookHeaderProbe } from "../lib/workbookHeaderProbe";
import { createImportStage, appendImportStage, sealImportStage } from "../lib/salesImportStage";
const jobs = new Map();

async function parseWorkbook(buffer, extension, selectedSheet) {
  if (extension === "csv" || extension === "tsv") {
    const text = new TextDecoder("utf-8").decode(buffer);
    const result = Papa.parse(text, {
      header: true,
      skipEmptyLines: false,
      delimiter: extension === "tsv" ? "\t" : "",
      transformHeader: (header) => header.trim(),
    });
    const parseError = result.errors.find((error) => error.type === "Quotes" || (error.type === "FieldMismatch" && Object.values(result.data[error.row] ?? {}).some((value) => String(value ?? "").trim())));
    if (parseError) {
      throw new Error(`文件格式错误：${parseError.message}`);
    }
    // Parse record boundaries separately so blank and multiline CSV records
    // retain their real starting source line, without exposing metadata headers.
    const starts = [];
    let previousCursor = 0;
    let line = 1;
    Papa.parse(text, { delimiter: extension === "tsv" ? "\t" : "", step: ({ meta }) => { starts.push(line); line += (text.slice(previousCursor, meta.cursor).match(/\r\n|\n|\r/g) ?? []).length; previousCursor = meta.cursor; } });
    return result.data.map((row, index) => {
      Object.defineProperty(row, "__salesSource", { value: { sourceRow: starts[index + 1] ?? index + 2, sourceSheet: "", rawValues: row } });
      return row;
    }).filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
  }

  // Inspect only header rows first. Personnel summaries in a workbook can be
  // larger than the actual ledger; never materialize their full cell graphs.
  let workbook = await workbookHeaderProbe(buffer);
  const candidates = workbook.SheetNames.filter(name => {
    const sheet = workbook.Sheets[name];
    if (!sheet?.["!ref"]) return false;
    const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"]);
    const cells = XLSX.utils.sheet_to_json(sheet, { header: 1, range: { s: range.s, e: { r: Math.min(range.e.r, range.s.r + 1), c: range.e.c } }, defval: "" });
    const headers = (cells[0] ?? []).map(String);
    const mapping = suggestMappings(headers);
    return range.e.r > range.s.r && mapping.platformSku && (mapping.platformSkc || mapping.supplierNumber)
      && (mapping.quantity || mapping.amount || mapping.customerShipmentQuantity || mapping.platformOrderQuantity);
  });
  if (!candidates.length) throw new Error("未找到含平台 SKU、SKC/供方货号及数量/金额的有效明细页，请检查文件表头。");
  if (!selectedSheet && candidates.length > 1) return { sheetCandidates: candidates };
  const sheetName = selectedSheet || candidates[0];
  if (!candidates.includes(sheetName)) throw new Error("所选工作表不是有效台账明细页，请重新选择。");
  if (!workbook.__importFullWorkbook) {
    try {
      const rows = [];
      for await (const chunk of workbookSheetChunks(buffer, sheetName, workbook)) rows.push(...worksheetSourceRows(chunk.workbook, sheetName, chunk));
      return rows;
    } catch {
      // Unsupported OOXML variants retain the complete established parser.
    }
    workbook = null;
    workbook = XLSX.read(buffer, { type: "array", cellDates: false, dense: true, cellHTML: false, cellText: false, cellNF: true, cellFormula: false, sheets: [sheetName] });
  }
  return worksheetSourceRows(workbook, sheetName);
}

function worksheetSourceRows(workbook, sheetName, bounds = {}) {
  const sheet = workbook.Sheets[sheetName];
  // Preserve formatted identifiers and numeric precision without a second row set.
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const cellAt = (r, c) => sheet['!data']?.[r]?.[c] ?? sheet[r]?.[c] ?? sheet[XLSX.utils.encode_cell({ r, c })];
  // Let SheetJS name duplicate/blank/numeric headers exactly as it names data
  // rows. Numeric object keys are reordered by JavaScript, not by the sheet.
  const headerCells = [], columnCells = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    headerCells[column] = cellAt(range.s.r, column);
    columnCells[column] = { t: 'n', v: column };
  }
  const probe = { '!data': [headerCells, columnCells], '!ref': XLSX.utils.encode_range({ s: { r: 0, c: range.s.c }, e: { r: 1, c: range.e.c } }) };
  const keys = Object.fromEntries(Object.entries(XLSX.utils.sheet_to_json(probe)[0]).map(([key, column]) => [column, key]));
  const headers = Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) => keys[range.s.c + index]);
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  // Worksheet cells already own their text values. Release the shared-string
  // descriptors, then consume cells as each bounded block becomes source rows.
  if (workbook.Strings) workbook.Strings.length = 0;
  const rows = [];
  for (let start = bounds.start ?? range.s.r + 1; start <= (bounds.end ?? range.e.r); start += 2000) {
    const end = Math.min(bounds.end ?? range.e.r, start + 1999);
    for (let row = start; row <= end; row += 1) for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = cellAt(row, column);
      if (cell?.t === 'n' && XLSX.SSF.is_date(cell.z ?? '')) cell.w = XLSX.SSF.format(cell.z, cell.v, { date1904 });
    }
    const chunk = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false, header: headers, range: { s: { r: start, c: range.s.c }, e: { r: end, c: range.e.c } } });
    for (const row of chunk) {
      const rawValues = {};
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const cell = cellAt(row.__rowNum__, column);
        if (cell?.t === 'n' || cell?.t === 'b') rawValues[keys[column]] = cell.v;
      }
      Object.defineProperty(row, "__salesSource", { value: { sourceRow: row.__rowNum__ + 1, sourceSheet: sheetName, rawValues, date1904 } });
      rows.push(row);
    }
    for (let row = start; row <= end; row += 1) {
      if (sheet['!data']) sheet['!data'][row] = undefined;
      else if (Array.isArray(sheet)) sheet[row] = undefined;
      else for (let column = range.s.c; column <= range.e.c; column += 1) delete sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    }
  }

  return rows;
}

self.onmessage = async ({ data }) => {
  const { type, requestId } = data;
  try {
    if (type === "release") {
      jobs.delete(data.jobId);
      self.postMessage({ type: "released", requestId });
      return;
    }
    if (type === "parse") {
      self.postMessage({ type: "progress", requestId, jobId: data.jobId, stage: "读取工作簿", completed: 0, total: null });
      const rows = await parseWorkbook(data.buffer, data.extension, data.selectedSheet);
      if (rows.sheetCandidates) {
        self.postMessage({ type: "sheet-selection-required", requestId, sheetCandidates: rows.sheetCandidates });
        return;
      }
      if (!rows.length) throw new Error("所选文件中没有数据行。");
      const headers = [...new Set(rows.slice(0, 100).flatMap((row) => Object.keys(row)))];
      jobs.set(data.jobId, rows);
      const ledgerReport = detectLedgerReport(headers);
      const suggestedMapping = ledgerReport ? suggestLedgerReportMapping(headers) : suggestMappings(headers);
      self.postMessage({ type: "progress", requestId, jobId: data.jobId, stage: "解析完成", completed: rows.length, total: rows.length, value: 100 });
      self.postMessage({
        type: "parsed",
        requestId,
        headers,
        rowCount: rows.length,
        selectedSheet: rows[0]?.__salesSource?.sourceSheet ?? "",
        previewRows: rows.slice(0, 5),
        suggestedMapping,
        preset: ledgerReport ? "ledger_report" : "generic",
        facets: collectSalesImportFacets(rows, suggestedMapping),
      });
      return;
    }

    if (type === "validate") {
      const rows = jobs.get(data.jobId);
      if (!rows) throw new Error("导入预览已失效，请重新选择文件。");
      const result = { rows: [], errors: [], ignored: [], sourceRowCount: rows.length, validRowCount: 0, errorCount: 0, ignoredCount: 0, platformSkcMissingCount: 0 };
      const stageId = data.chunked ? await createImportStage(data.stageOwner) : null;
      let chunkCount = 0;
      for (let start = 0; start < rows.length; start += 2000) {
        const chunk = validateSalesRows(rows.slice(start, start + 2000), data.mapping, data.options);
        result.validRowCount += chunk.rows.length; result.errorCount += chunk.errors.length; result.ignoredCount += chunk.ignored.length;
        result.errors.push(...chunk.errors.slice(0, Math.max(0, 50 - result.errors.length))); result.ignored.push(...chunk.ignored.slice(0, Math.max(0, 50 - result.ignored.length)));
        result.platformSkcMissingCount += chunk.platformSkcMissingCount ?? 0;
        if (stageId) await appendImportStage(stageId, chunkCount++, chunk.rows); else result.rows.push(...chunk.rows);
        self.postMessage({ type: "progress", requestId, jobId: data.jobId, stage: "校验明细", completed: Math.min(rows.length, start + 2000), total: rows.length, value: Math.min(rows.length, start + 2000) / rows.length * 100 });
      }
      const { rows: validRows, ...summary } = result;
      self.postMessage({ type: "validated", requestId, rows: stageId ? undefined : validRows,
        rowSource: stageId ? await sealImportStage(stageId, result.validRowCount, chunkCount) : undefined, summary });
      return;
    }

    if (type === "inspect-period") {
      const rows = jobs.get(data.jobId);
      if (!rows) throw new Error("导入预览已失效，请重新选择文件。");
      const facets = collectSalesImportFacets(rows, data.mapping);
      const noSelection = Array.isArray(data.options?.supplierNumbers) && !data.options.supplierNumbers.length;
      const stageId = data.stageOwner ? await createImportStage(data.stageOwner) : null;
      const evidence = { sourceField: "sourceAddedAt", sourceColumn: data.mapping?.sourceAddedAt ?? "", distribution: [], validCount: 0, missingCount: 0, invalidCount: 0, errorCount: 0, ignoredCount: 0, eligibleCount: 0,
        validationSummary: { sourceRowCount: rows.length, validRowCount: 0, errorCount: 0, ignoredCount: 0, platformSkcMissingCount: 0, errors: [], ignored: [] } };
      const months = new Map(); let chunkCount = 0;
      for (let start = 0; start < rows.length; start += 2000) {
        const validation = validateSalesRows(rows.slice(start, start + 2000), data.mapping, { ...data.options, period: undefined });
        const chunk = salesPeriodEvidenceFromValidation(noSelection ? validateSalesRows(rows.slice(start, start + 2000), data.mapping, { ...data.options, supplierNumbers: undefined, period: undefined }) : validation, data.mapping);
        for (const key of ['validCount', 'missingCount', 'invalidCount', 'errorCount', 'ignoredCount', 'eligibleCount']) evidence[key] += chunk[key];
        for (const key of ['validRowCount', 'errorCount', 'ignoredCount', 'platformSkcMissingCount']) evidence.validationSummary[key] += noSelection ? (key === 'ignoredCount' ? validation.ignored.length : 0) : chunk.validationSummary[key];
        for (const key of ['errors', 'ignored']) evidence.validationSummary[key].push(...chunk.validationSummary[key].slice(0, Math.max(0, 50 - evidence.validationSummary[key].length)));
        for (const month of chunk.distribution) months.set(month.month, (months.get(month.month) ?? 0) + month.count);
        if (stageId) await appendImportStage(stageId, chunkCount++, validation.rows);
        self.postMessage({ type: 'progress', requestId, jobId: data.jobId, stage: '校验并暂存', completed: Math.min(rows.length, start + 2000), total: rows.length, value: Math.min(rows.length, start + 2000) / rows.length * 100 });
      }
      evidence.distribution = [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
      evidence.suggestedPeriod = months.size === 1 && !evidence.missingCount && !evidence.invalidCount && !evidence.errorCount ? evidence.distribution[0].month : null;
      const rowSource = stageId ? await sealImportStage(stageId, evidence.validationSummary.validRowCount, chunkCount) : undefined;
      self.postMessage({ type: "period-inspected", requestId, evidence, facets, rowSource });
      return;
    }

    if (type === "export") {
      const worksheet = XLSX.utils.json_to_sheet(data.rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, data.sheetName.slice(0, 31));
      const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true });
      self.postMessage({ type: "exported", requestId, bytes }, [bytes]);
    }
  } catch (error) {
    self.postMessage({ type: "error", requestId, message: error instanceof Error ? error.message : "导入失败。" });
  }
};
