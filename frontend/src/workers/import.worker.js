import Papa from "papaparse";
import * as XLSX from "xlsx";
import { collectSalesImportFacets, detectLedgerReport, suggestLedgerReportMapping, suggestMappings, validateSalesRows } from "../lib/salesImport";

const jobs = new Map();

function parseWorkbook(buffer, extension) {
  if (extension === "csv" || extension === "tsv") {
    const text = new TextDecoder("utf-8").decode(buffer);
    const result = Papa.parse(text, {
      header: true,
      skipEmptyLines: "greedy",
      delimiter: extension === "tsv" ? "\t" : "",
      transformHeader: (header) => header.trim(),
    });
    if (result.errors.some((error) => error.type === "Quotes")) {
      throw new Error(result.errors[0].message);
    }
    return result.data;
  }

  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("工作簿中没有可读取的工作表。");
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
}

self.onmessage = ({ data }) => {
  const { type, requestId } = data;
  try {
    if (type === "parse") {
      self.postMessage({ type: "progress", requestId, value: 15 });
      const rows = parseWorkbook(data.buffer, data.extension);
      if (!rows.length) throw new Error("所选文件中没有数据行。");
      const headers = [...new Set(rows.slice(0, 100).flatMap((row) => Object.keys(row)))];
      jobs.set(data.jobId, rows);
      const ledgerReport = detectLedgerReport(headers);
      const suggestedMapping = ledgerReport ? suggestLedgerReportMapping(headers) : suggestMappings(headers);
      self.postMessage({ type: "progress", requestId, value: 100 });
      self.postMessage({
        type: "parsed",
        requestId,
        headers,
        rowCount: rows.length,
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
      self.postMessage({ type: "progress", requestId, value: 20 });
      const result = validateSalesRows(rows, data.mapping, data.options);
      self.postMessage({ type: "progress", requestId, value: 100 });
      self.postMessage({
        type: "validated",
        requestId,
        rows: result.rows,
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
