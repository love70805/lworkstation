import Papa from "papaparse";
import * as XLSX from "xlsx";
import { collectSalesImportFacets, collectSalesPeriodEvidence, detectLedgerReport, suggestLedgerReportMapping, suggestMappings, validateSalesRows } from "../lib/salesImport";

const jobs = new Map();

function parseWorkbook(buffer, extension, selectedSheet) {
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

  const workbook = XLSX.read(buffer, { type: "array", cellDates: false, dense: true });
  const candidates = workbook.SheetNames.filter(name => {
    const sheet = workbook.Sheets[name];
    if (!sheet?.["!ref"]) return false;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
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
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  return rows.map((row, index) => {
    Object.defineProperty(row, "__salesSource", { value: { sourceRow: row.__rowNum__ + 1, sourceSheet: sheetName, rawValues: rawRows[index], date1904: Boolean(workbook.Workbook?.WBProps?.date1904) } });
    return row;
  });
}

self.onmessage = ({ data }) => {
  const { type, requestId } = data;
  try {
    if (type === "release") {
      jobs.delete(data.jobId);
      self.postMessage({ type: "released", requestId });
      return;
    }
    if (type === "parse") {
      self.postMessage({ type: "progress", requestId, jobId: data.jobId, stage: "读取工作簿", completed: 0, total: null });
      const rows = parseWorkbook(data.buffer, data.extension, data.selectedSheet);
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
      const result = { rows: [], errors: [], ignored: [], sourceRowCount: rows.length, platformSkcMissingCount: 0 };
      for (let start = 0; start < rows.length; start += 2000) {
        const chunk = validateSalesRows(rows.slice(start, start + 2000), data.mapping, data.options);
        result.rows.push(...chunk.rows); result.errors.push(...chunk.errors); result.ignored.push(...chunk.ignored);
        result.platformSkcMissingCount += chunk.platformSkcMissingCount ?? 0;
        self.postMessage({ type: "progress", requestId, jobId: data.jobId, stage: "校验明细", completed: Math.min(rows.length, start + 2000), total: rows.length, value: Math.min(rows.length, start + 2000) / rows.length * 100 });
        if (data.chunked) self.postMessage({ type: "validated-chunk", requestId, rows: chunk.rows });
      }
      self.postMessage({
        type: "validated",
        requestId,
        rows: data.chunked ? undefined : result.rows,
        summary: {
          sourceRowCount: result.sourceRowCount,
          validRowCount: result.rows.length,
          errorCount: result.errors.length,
          ignoredCount: result.ignored.length,
          platformSkcMissingCount: result.platformSkcMissingCount ?? 0,
          errors: result.errors.slice(0, 50),
          ignored: result.ignored.slice(0, 50),
        },
      });
      return;
    }

    if (type === "inspect-period") {
      const rows = jobs.get(data.jobId);
      if (!rows) throw new Error("导入预览已失效，请重新选择文件。");
      self.postMessage({ type: "period-inspected", requestId, evidence: collectSalesPeriodEvidence(rows, data.mapping, data.options) });
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
