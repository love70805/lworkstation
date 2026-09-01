import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Filter,
  Upload,
  UsersRound,
  X,
} from "lucide-react";
import { Button, Modal, ProgressBar, useToast } from "../components/UI";
import { saveSalesImport } from "../data/database";
import { createImportWorkerClient } from "../lib/importWorkerClient";
import { LEDGER_REPORT_MOVEMENT_TYPES, salesFields, suggestLedgerReportMapping, suggestMappings, validateSalesMapping } from "../lib/salesImport";

const ACCEPTED_EXTENSIONS = new Set(["csv", "tsv", "xlsx", "xls"]);
const MAX_FILE_SIZE = 50 * 1024 * 1024;

function previousMonth() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function baseFileName(fileName) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "默认店铺";
}

async function sha256File(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function sampleFile() {
  const csv = [
    "供方货号,SKC,平台SKU,属性,变动类型,数量,金额,客退罚款,订单号,订单日期",
    "SUP-001,SKC-HEADPHONE,ANC-HP-B01,黑色,销售,23,1245.50,0,TRX-98214-A,2026-07-03",
    "SUP-002,SKC-WATCH,WA-SHOCK-R,红色,销售,10,796.20,0,TRX-98215-B,2026-07-03",
    "SUP-003,SKC-CASE,SM-GLX-U25,透明,平台扣款,0,-12.50,0,TRX-98216-C,2026-07-04",
  ].join("\n");
  return new File([csv], "亚马逊美国站.csv", { type: "text/csv" });
}

export default function ImportPreview() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const inputRef = useRef(null);
  const clientRef = useRef(null);
  const [file, setFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState({});
  const [mappingExpanded, setMappingExpanded] = useState(false);
  const [importPreset, setImportPreset] = useState("generic");
  const [facets, setFacets] = useState({ supplierNumbers: [], supplierCounts: {}, movementTypes: [], movementTypeCounts: {} });
  const [selectedSuppliers, setSelectedSuppliers] = useState([]);
  const [selectedMovementTypes, setSelectedMovementTypes] = useState([]);
  const [period, setPeriod] = useState(previousMonth);
  const [storeName, setStoreName] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState(null);
  const [validationDialog, setValidationDialog] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(false);

  useEffect(() => {
    clientRef.current = createImportWorkerClient(setProgress);
    return () => clientRef.current?.terminate();
  }, []);

  const mappingIssues = validateSalesMapping(mapping, { defaultStore: storeName });
  const mappedColumns = Object.values(mapping).filter(Boolean);
  const hasDuplicateMappings = new Set(mappedColumns).size !== mappedColumns.length;
  const allMapped = mappingIssues.length === 0 && !hasDuplicateMappings && Boolean(period) && Boolean(storeName.trim());

  useEffect(() => {
    if (mappingIssues.length > 0 || hasDuplicateMappings) setMappingExpanded(true);
  }, [mappingIssues.length, hasDuplicateMappings]);

  const loadFile = async (nextFile) => {
    if (!nextFile) return;
    const extension = nextFile.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.has(extension)) {
      setError("请选择 CSV、TSV、XLSX 或 XLS 文件。");
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setError("所选文件超过 50 MB 的本地导入限制。");
      return;
    }

    const nextJobId = crypto.randomUUID();
    setBusy(true);
    setProgress(0);
    setError("");
    setValidation(null);
    try {
      const result = await clientRef.current.parse(nextFile, nextJobId);
      setFile(nextFile);
      setJobId(nextJobId);
      setHeaders(result.headers);
      setPreviewRows(result.previewRows);
      setRowCount(result.rowCount);
      setImportPreset(result.preset ?? "generic");
      setFacets(result.facets ?? { supplierNumbers: [], supplierCounts: {}, movementTypes: [], movementTypeCounts: {} });
      const suggestedMapping = result.suggestedMapping ?? suggestMappings(result.headers);
      const nextStoreName = baseFileName(nextFile.name);
      const suggestedColumns = Object.values(suggestedMapping).filter(Boolean);
      const suggestedHasIssues = validateSalesMapping(suggestedMapping, { defaultStore: nextStoreName }).length > 0
        || new Set(suggestedColumns).size !== suggestedColumns.length;
      setMapping(suggestedMapping);
      setMappingExpanded(suggestedHasIssues);
      setSelectedSuppliers(result.preset === "ledger_report" ? (result.facets?.supplierNumbers ?? []) : []);
      setSelectedMovementTypes(result.preset === "ledger_report"
        ? LEDGER_REPORT_MOVEMENT_TYPES.filter((type) => result.facets?.movementTypes?.includes(type))
        : []);
      setStoreName(nextStoreName);
      notify(`已在后台解析 ${result.rowCount.toLocaleString()} 行，工作区保持可操作。`);
    } catch (parseError) {
      setFile(null);
      setError(parseError.message);
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    setBusy(true);
    setProgress(0);
    setError("");
    try {
      const result = await clientRef.current.validate(jobId, mapping, {
        defaultStore: storeName.trim(),
        movementTypes: importPreset === "ledger_report" ? selectedMovementTypes : undefined,
        supplierNumbers: importPreset === "ledger_report" ? selectedSuppliers : undefined,
        deriveAmountFromUnitPrice: importPreset === "ledger_report",
      });
      setValidation(result);
      setValidationDialog(true);
    } catch (validationError) {
      setError(validationError.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!validation?.rows.length) return;
    setBusy(true);
    try {
      const fileHash = await sha256File(file);
      const result = await saveSalesImport({
        fileName: file.name,
        fileHash,
        mapping,
        rows: validation.rows,
        summary: validation.summary,
        period,
        storeName: storeName.trim(),
        filterOptions: importPreset === "ledger_report" ? {
          movementTypes: selectedMovementTypes,
          supplierNumbers: selectedSuppliers,
          deriveAmountFromUnitPrice: true,
        } : null,
      });
      setConfirmDialog(false);
      notify(`已写入 ${period} 月度账本：新增 ${result.addedGroupCount} 组，替换 ${result.replacedGroupCount} 组。`);
      navigate(`/profit?ledger=${encodeURIComponent(result.ledgerId)}`);
    } catch (writeError) {
      setError(`本地写入失败：${writeError.message}`);
      setConfirmDialog(false);
    } finally {
      setBusy(false);
    }
  };

  const updateMapping = (key, value) => {
    setMapping((current) => ({ ...current, [key]: value }));
    setMappingExpanded(true);
    setValidation(null);
  };

  const toggleSupplier = (supplier) => {
    setSelectedSuppliers((current) => current.includes(supplier)
      ? current.filter((item) => item !== supplier)
      : [...current, supplier].toSorted());
    setValidation(null);
  };

  const toggleMovementType = (movementType) => {
    setSelectedMovementTypes((current) => current.includes(movementType)
      ? current.filter((item) => item !== movementType)
      : [...current, movementType]);
    setValidation(null);
  };

  const visibleFields = importPreset === "ledger_report"
    ? salesFields.filter((field) => ["supplierNumber", "platformSkc", "platformSku", "attribute", "movementType", "quantity", "unitPrice"].includes(field.key))
    : salesFields;
  const movementTypeOptions = [
    ...LEDGER_REPORT_MOVEMENT_TYPES.filter((type) => facets.movementTypes.includes(type)),
    ...facets.movementTypes.filter((type) => !LEDGER_REPORT_MOVEMENT_TYPES.includes(type)),
  ];

  return (
    <main className="wizard-shell">
      <header className="wizard-topbar"><button onClick={() => navigate("/profit")}><X size={22} />取消导入</button><span className="wizard-divider" /><strong>月度台账导入向导</strong><span className="wizard-space" /><span>当前仓储：本机开发数据库</span><span className="wizard-avatar">S</span></header>
      <section className="wizard-content">
        <div className="wizard-intro"><h1>导入月度销售台账</h1><p>按月份和店铺保存来源批次，同一分组再次导入时按旧利润工具规则替换。</p></div>
        <div className="stepper"><span className={file ? "done" : "active"}>{file ? <CheckCircle2 size={24} /> : "1"}<b>1. 上传</b></span><i /><span className={file ? "active" : ""}>2 <b>2. 映射字段</b></span><i /><span>3 <b>3. 校验</b></span></div>

        <section className="wizard-card">
          <div
            className={`import-dropzone ${file ? "has-file" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); loadFile(event.dataTransfer.files[0]); }}
          >
            <input ref={inputRef} type="file" aria-label="选择月度销售台账文件" accept=".csv,.tsv,.xlsx,.xls" onChange={(event) => loadFile(event.target.files[0])} />
            <span className="import-dropzone-icon">{file ? <FileSpreadsheet size={26} /> : <Upload size={26} />}</span>
            <div><strong>{file ? file.name : "将销售文件拖放到这里"}</strong><p>{file ? `${rowCount.toLocaleString()} 行数据 · ${(file.size / 1024).toFixed(1)} KB` : "支持 CSV、TSV、XLSX、XLS，最大 50 MB"}</p></div>
            <Button onClick={() => inputRef.current?.click()}>{file ? "更换文件" : "选择文件"}</Button>
            {!file ? <Button variant="ghost" onClick={() => loadFile(sampleFile())}>使用示例</Button> : null}
          </div>

          {busy ? <div className="import-progress"><ProgressBar value={progress} label={progress < 100 ? "正在后台处理..." : "处理完成"} /></div> : null}
          {error ? <div className="import-error" role="alert"><AlertCircle size={18} />{error}</div> : null}

          {file ? (
            <>
              <div className="import-context-grid">
                <div className="form-field"><label className="required" htmlFor="ledger-period">账本月份</label><input id="ledger-period" className="text-input mono" type="month" value={period} onChange={(event) => { setPeriod(event.target.value); setValidation(null); }} /></div>
                <div className="form-field"><label className="required" htmlFor="default-store">默认店铺</label><input id="default-store" className="text-input" value={storeName} onChange={(event) => { setStoreName(event.target.value); setValidation(null); }} placeholder="例如：亚马逊美国站" /></div>
                <div className="import-context-note"><strong>正式成本规则</strong><span>台账自带成本只保留为历史参考；定稿仍需 ERP 成本，或在 ERP 缺失时完成 1688 人工审批。</span></div>
              </div>
              {importPreset === "ledger_report" ? (
                <section className="ledger-report-filter-panel" aria-label="台账筛选">
                  <div className="ledger-report-filter-head"><div><strong><Filter size={17} />台账筛选</strong></div></div>
                  <div className="ledger-report-filter-grid">
                    <div className="ledger-report-filter-group"><div className="ledger-report-filter-label-row"><span className="ledger-report-filter-label">变动类型（可多选）</span><span className="ledger-report-filter-actions"><button type="button" onClick={() => { setSelectedMovementTypes([...movementTypeOptions]); setValidation(null); }}>全选</button><button type="button" onClick={() => { setSelectedMovementTypes([]); setValidation(null); }}>清空</button></span></div><div className="ledger-report-checks">{movementTypeOptions.map((type) => <label className={`ledger-report-check ${LEDGER_REPORT_MOVEMENT_TYPES.includes(type) ? "" : "ledger-report-check-exception"}`} key={type}><input type="checkbox" checked={selectedMovementTypes.includes(type)} onChange={() => toggleMovementType(type)} /><span>{type}</span><small>{facets.movementTypeCounts[type] ?? 0} 行</small></label>)}</div></div>
                    <div className="ledger-report-filter-group"><div className="ledger-report-filter-label-row"><span className="ledger-report-filter-label"><UsersRound size={16} />供方货号（可多选）</span><span className="ledger-report-filter-actions"><button type="button" onClick={() => { setSelectedSuppliers([...facets.supplierNumbers]); setValidation(null); }}>全选</button><button type="button" onClick={() => { setSelectedSuppliers([]); setValidation(null); }}>清空</button></span></div><div className="ledger-report-supplier-list">{facets.supplierNumbers.map((supplier) => <label className="ledger-report-check" key={supplier}><input type="checkbox" checked={selectedSuppliers.includes(supplier)} onChange={() => toggleSupplier(supplier)} /><code>{supplier}</code><small>{facets.supplierCounts[supplier] ?? 0} 行</small></label>)}</div></div>
                  </div>
                  <p className="ledger-report-filter-note">当前选择 {selectedSuppliers.length} 个供方货号、{selectedMovementTypes.length} 种变动类型；销售金额按“数量 × 单价”计算。</p>
                </section>
              ) : null}
              <div className={`wizard-card-title mapping-preview-title ${mappingIssues.length || hasDuplicateMappings ? "mapping-preview-alert" : ""}`}><div><h2>数据映射预览</h2><p>文件：<code>{file.name}</code>（{rowCount.toLocaleString()} 行）</p></div><div className="mapping-preview-actions">{mappingIssues.length || hasDuplicateMappings ? <span className="mapping-preview-status warning"><AlertCircle size={15} />请展开检查映射</span> : <span className="mapping-preview-status success"><CheckCircle2 size={15} />已自动映射</span>}<Button variant="ghost" icon={ChevronDown} onClick={() => setMappingExpanded((value) => !value)}>{mappingExpanded ? "收起映射" : "展开映射"}</Button><Button variant="ghost" onClick={() => { const nextMapping = importPreset === "ledger_report" ? (suggestLedgerReportMapping(headers) ?? suggestMappings(headers)) : suggestMappings(headers); const nextColumns = Object.values(nextMapping).filter(Boolean); const nextHasIssues = validateSalesMapping(nextMapping, { defaultStore: storeName }).length > 0 || new Set(nextColumns).size !== nextColumns.length; setMapping(nextMapping); setMappingExpanded(nextHasIssues); setValidation(null); }}>自动映射</Button></div></div>
              {mappingExpanded ? <div className="mapping-table">
                <div className="mapping-head"><span>系统字段</span><span>来源列</span><span>示例数据（第 1 行）</span></div>
                {visibleFields.map((field) => {
                  const value = mapping[field.key] ?? "";
                  const duplicate = value && Object.entries(mapping).some(([key, column]) => key !== field.key && column === value);
                  const fieldIssue = mappingIssues.find((issue) => issue.key === field.key);
                  return (
                    <div className={`mapping-row ${(field.required && !value) || duplicate || fieldIssue ? "mapping-error" : ""}`} key={field.key}>
                      <div><span className={value && !duplicate ? "mapping-check valid" : "mapping-check missing"}>{value && !duplicate ? <Check size={14} /> : "!"}</span><strong>{field.label}{field.required ? <em> *</em> : null}</strong><small>{field.description}</small></div>
                      <div><label className="mapping-select"><select value={value} onChange={(event) => updateMapping(field.key, event.target.value)}><option value="">-- 未映射 --</option>{headers.map((header) => <option value={header} key={header}>{header}</option>)}</select><ChevronDown size={17} /></label>{field.required && !value ? <small className="mapping-error-text">必填字段尚未映射。</small> : null}{fieldIssue ? <small className="mapping-error-text">{fieldIssue.message}</small> : null}{duplicate ? <small className="mapping-error-text">同一个来源列不能重复映射到多个系统字段。</small> : null}</div>
                      <div>{value ? <code>{String(previewRows[0]?.[value] ?? "") || "空值"}</code> : <i>暂无预览</i>}</div>
                    </div>
                  );
                })}
              </div> : null}
              <div className="wizard-card-footer"><Button onClick={() => navigate("/profit")}>返回利润面板</Button><Button variant="primary" disabled={!allMapped || busy} loading={busy} icon={ArrowRight} onClick={validate}>校验数据</Button></div>
            </>
          ) : null}
        </section>
      </section>

      <Modal
        open={validationDialog}
        title="校验完成"
        description={`发现 ${validation?.summary.validRowCount.toLocaleString() ?? 0} 行有效数据，${validation?.summary.ignoredCount.toLocaleString() ?? 0} 行按业务规则跳过，${validation?.summary.errorCount.toLocaleString() ?? 0} 行错误。`}
        onClose={() => setValidationDialog(false)}
        footer={<><Button onClick={() => setValidationDialog(false)}>检查映射</Button><Button variant="primary" disabled={!validation?.rows.length} onClick={() => { setValidationDialog(false); setConfirmDialog(true); }}>继续</Button></>}
      >
        <div className="validation-summary"><span><CheckCircle2 size={18} />平台 SKC/供方货号与平台 SKU 分组已校验</span><span><CheckCircle2 size={18} />盘亏、扣款和数量/金额回退规则已执行</span><span><FileSpreadsheet size={18} />共 {validation?.summary.sourceRowCount.toLocaleString() ?? 0} 行来源数据，可按行号追踪</span>{validation?.summary.platformSkcMissingCount ? <span className="validation-warning"><AlertCircle size={18} />有 {validation.summary.platformSkcMissingCount.toLocaleString()} 行缺少平台 SKC，导入后不能生成对应 ERP 查询；请优先检查字段映射。</span> : null}</div>
        {validation?.summary.errors.length ? <div className="validation-errors"><strong>前几项校验问题</strong>{validation.summary.errors.slice(0, 5).map((item) => <p key={item.sourceRow}>第 {item.sourceRow} 行：{item.messages.join("；")}</p>)}</div> : null}
      </Modal>
      <Modal open={confirmDialog} title="确认写入月度账本" description="来源批次会永久保留；同一店铺、SKC/供方货号分组的旧明细将由本批次替换。" onClose={() => setConfirmDialog(false)} footer={<><Button onClick={() => setConfirmDialog(false)}>取消</Button><Button variant="primary" loading={busy} onClick={confirmImport}>确认导入</Button></>}><p className="modal-note">月份：<code>{period}</code> · 店铺：{storeName} · 文件：<code>{file?.name}</code> · 有效行数：{validation?.rows.length.toLocaleString()}</p></Modal>
    </main>
  );
}
