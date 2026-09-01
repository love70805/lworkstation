import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, CheckCheck, Download, ExternalLink, Filter, Image, Pencil, Plus, Search, ShieldCheck, Trash2, TriangleAlert, X } from "lucide-react";
import { Badge, Button, EmptyState, Modal, Panel, useToast } from "../components/UI";
import SelectionCaptureSetup from "../components/SelectionCaptureSetup";
import {
  createManualCaptureRecord,
  ignoreCaptureRecord,
  listPendingCaptureRecords,
  saveProductCatalogRecord,
} from "../data/database";
import { calculateSupplierLandedUnitCost } from "../domain/productCatalog";
import { matchesSelectionSearch } from "../lib/selectionSearch";
import { isDesktopRuntime } from "../lib/desktopRuntime";

const emptyCaptureForm = {
  name: "",
  sourceUrl: "",
  sourceProductId: "",
  supplierCode: "",
  supplierName: "",
  imageUrl: "",
};

function formatCapturedAt(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function captureReferenceCost(capture) {
  const draft = capture.draft ?? {};
  const variants = Array.isArray(draft.variants) ? draft.variants : [];
  const totalPurchasePacks = variants.reduce((sum, variant) => sum + Number(variant.purchasePackCount ?? 0), 0);
  const costs = variants.map((variant) => calculateSupplierLandedUnitCost({
    purchaseUnitPrice: variant.purchaseUnitPrice,
    shippingAmount: draft.shippingAmount,
    totalPurchasePacks,
    handlingFee: draft.handlingFee,
    unitsPerPack: variant.unitsPerPack,
  })).filter((value) => Number.isFinite(value) && value > 0);
  return costs.length > 0 ? Math.min(...costs) : null;
}

function groupCaptures(captures) {
  const groups = new Map();
  captures.forEach((capture) => {
    const id = capture.batchId || capture.requestId || capture.id;
    if (!groups.has(id)) groups.set(id, { id, items: [] });
    groups.get(id).items.push(capture);
  });
  return [...groups.values()];
}

export function CaptureQueueContent({ query = "", onQueryChange = () => {} }) {
  const navigate = useNavigate();
  const { notify } = useToast();
  const captures = useLiveQuery(listPendingCaptureRecords, [], []);
  const [filter, setFilter] = useState("all");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCaptureForm);
  const [creating, setCreating] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const desktop = isDesktopRuntime();

  const visibleCaptures = useMemo(() => {
    return captures.filter((capture) => {
      const valid = Boolean(capture.validation?.valid);
      const matchesFilter = filter === "all" || (filter === "ready" ? valid : !valid);
      const draft = capture.draft ?? {};
      const suppliers = draft.suppliers ?? [];
      const matchesQuery = matchesSelectionSearch(query, [
        draft.name ?? capture.sourceTitle,
        draft.platformSkc,
        draft.supplierCode,
        draft.supplierName,
        suppliers.map((supplier) => [supplier.supplierCode, supplier.supplierName]),
        (draft.variants ?? []).map((variant) => [variant.platformSku, variant.warehouseSku]),
      ]);
      return matchesFilter && matchesQuery;
    });
  }, [captures, filter, query]);

  const visibleBatches = useMemo(() => groupCaptures(visibleCaptures), [visibleCaptures]);
  const pendingCount = captures.length;
  const blockingCount = captures.filter((capture) => !capture.validation?.valid).length;
  const readyCaptures = captures.filter((capture) => capture.validation?.valid);

  const createCapture = async () => {
    setCreating(true);
    try {
      const capture = await createManualCaptureRecord(createForm);
      setCreateForm(emptyCaptureForm);
      setCreateOpen(false);
      notify(`采集记录 ${capture.id} 已进入待确认队列。`, "success");
    } catch (error) {
      notify(`新增采集失败：${error.message}`, "error");
    } finally {
      setCreating(false);
    }
  };

  const confirmCapture = async (capture) => {
    setConfirmingId(capture.id);
    try {
      const result = await saveProductCatalogRecord({ captureId: capture.id, draft: capture.draft, status: "active" });
      notify(`${result.product.name} 已写入正式商品库，1688 成本保留为选品参考。`, "success");
    } catch (error) {
      notify(`确认入库失败：${error.message}`, "error");
    } finally {
      setConfirmingId(null);
    }
  };

  const confirmAllValid = async () => {
    setConfirmingAll(true);
    let confirmed = 0;
    const failures = [];
    for (const capture of readyCaptures) {
      try {
        await saveProductCatalogRecord({ captureId: capture.id, draft: capture.draft, status: "active" });
        confirmed += 1;
      } catch (error) {
        failures.push(`${capture.draft?.name ?? capture.id}：${error.message}`);
      }
    }
    setConfirmingAll(false);
    if (confirmed > 0) notify(`已确认 ${confirmed} 条采集记录并写入正式商品库。`, "success");
    if (failures.length > 0) notify(`有 ${failures.length} 条未能入库：${failures[0]}`, "error");
  };

  const removeItem = async () => {
    try {
      await ignoreCaptureRecord(pendingDelete.id);
      setPendingDelete(null);
      notify("该采集记录已忽略，处理动作已写入审计日志。", "success");
    } catch (error) {
      notify(`忽略失败：${error.message}`, "error");
    }
  };

  return (
    <>
      <div className="queue-view-toolbar">
        <div><strong>{pendingCount} 条采集记录等待确认</strong><span>{blockingCount} 条存在阻断项，确认后才会写入正式商品库。</span></div>
        <div>
          <div className="selection-domain-search queue-domain-search">
            <Search size={17} aria-hidden="true" />
            <input aria-label="搜索待确认采集" type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索商品名、平台 SKC/SKU、仓库 SKU 或供应商" />
            {query ? <button type="button" aria-label="清除搜索" title="清除搜索" onClick={() => onQueryChange("")}><X size={16} /></button> : null}
          </div>
          <label className="queue-filter button button-secondary"><Filter size={17} /><span>筛选</span><select aria-label="队列筛选" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部</option><option value="needs-action">需要处理</option><option value="ready">可确认</option></select></label>
          <Button icon={Plus} onClick={() => setCreateOpen(true)}>新增采集</Button>
          <Button icon={desktop ? ShieldCheck : Download} onClick={() => setSetupOpen(true)}>{desktop ? "1688 扩展状态" : "安装 1688 扩展"}</Button>
          <Button variant="primary" icon={CheckCheck} loading={confirmingAll} disabled={readyCaptures.length === 0 || confirmingAll} onClick={confirmAllValid}>确认全部有效项</Button>
        </div>
      </div>

      <div className="queue-stack">
        {visibleBatches.map((batch) => {
          const batchBlockingCount = batch.items.filter((capture) => !capture.validation?.valid).length;
          const firstCapture = batch.items[0];
          return (
            <Panel className="batch-panel" key={batch.id}>
              <div className="batch-summary">
                <div><span>批次 ID</span><strong className="mono">{batch.id}</strong></div>
                <div><span>来源</span>{firstCapture.sourceUrl ? <a href={firstCapture.sourceUrl} target="_blank" rel="noreferrer">1688 商品页<ExternalLink size={13} /></a> : <strong>1688</strong>}</div>
                <div><span>采集时间</span><strong className="mono">{formatCapturedAt(firstCapture.capturedAt)}</strong></div>
                <div className="batch-meta"><Badge tone={batchBlockingCount ? "warning" : "success"}><TriangleAlert size={13} />{batchBlockingCount ? `${batchBlockingCount} 条需处理` : "均可确认"}</Badge><strong>{batch.items.length} 条记录</strong></div>
              </div>
              <div className="batch-columns"><span>商品信息</span><span>1688 参考成本</span><span>状态/警告</span><span>操作</span></div>
              {batch.items.map((capture) => {
                const draft = capture.draft ?? {};
                const referenceCost = captureReferenceCost(capture);
                const blockingIssues = capture.validation?.blockingCount ?? 0;
                const warningIssues = capture.validation?.warningCount ?? 0;
                return (
                  <div className={`queue-item ${blockingIssues > 0 ? "queue-item-blocking" : ""}`} key={capture.id}>
                    <div className="queue-product">{capture.imageUrl ? <img src={capture.imageUrl} alt="" /> : <span className="queue-image-placeholder"><Image size={20} /></span>}<span><strong>{draft.name || capture.sourceTitle || "未命名采集商品"}</strong><small className="mono">{draft.platformSkc ? `SKC: ${draft.platformSkc}` : `1688 ID: ${capture.sourceProductId || "未填写"}`}</small></span></div>
                    <span className="mono queue-cost">{referenceCost == null ? "待计算" : `¥${referenceCost.toFixed(2)}`}</span>
                    <div className="warning-stack">
                      {blockingIssues > 0 ? <Badge tone="danger"><AlertCircle size={12} />{blockingIssues} 个阻断项</Badge> : <Badge tone="success"><CheckCheck size={12} />可确认入库</Badge>}
                      {warningIssues > 0 ? <Badge tone="warning"><AlertCircle size={12} />{warningIssues} 个提醒</Badge> : null}
                    </div>
                    <div className="queue-actions">
                      <button aria-label={`编辑 ${draft.name || capture.id}`} title="编辑采集记录" onClick={() => navigate(`/products/edit?capture=${encodeURIComponent(capture.id)}`)}><Pencil size={17} /></button>
                      <button aria-label={`忽略 ${draft.name || capture.id}`} title="忽略采集记录" onClick={() => setPendingDelete(capture)}><Trash2 size={17} /></button>
                      <Button variant="secondary" loading={confirmingId === capture.id} disabled={!capture.validation?.valid || confirmingId === capture.id} onClick={() => confirmCapture(capture)}>确认</Button>
                    </div>
                  </div>
                );
              })}
            </Panel>
          );
        })}

        {visibleBatches.length === 0 ? (
          <Panel className="queue-empty"><EmptyState icon={CheckCheck} title={captures.length === 0 ? "待确认队列为空" : "没有符合当前条件的采集记录"} description={captures.length === 0 ? "可先手工登记 1688 来源，后续浏览器扩展也会写入同一队列。" : "请调整筛选条件或搜索内容。"} action={captures.length === 0 ? <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>新增采集记录</Button> : <Button onClick={() => setFilter("all")}>清除筛选</Button>} /></Panel>
        ) : null}
      </div>

      <Modal
        open={setupOpen}
        title={desktop ? "内置 1688 扩展状态" : "安装 1688 采集扩展"}
        description={desktop ? "桌面版已内置扩展，这里只显示连接状态；详细信息可前往系统诊断。" : "只需安装一次。安装状态会在这里自动检测，无需单独进入设置页面。"}
        onClose={() => setSetupOpen(false)}
        footer={<Button onClick={() => setSetupOpen(false)}>完成</Button>}
      >
        <SelectionCaptureSetup />
      </Modal>

      <Modal
        open={createOpen}
        title="新增 1688 采集记录"
        description="先登记来源，随后在商品编辑器中补齐平台 SKC、平台 SKU 和报价明细。"
        onClose={() => setCreateOpen(false)}
        footer={<><Button onClick={() => setCreateOpen(false)}>取消</Button><Button variant="primary" loading={creating} disabled={creating || !createForm.name.trim() || !createForm.sourceUrl.trim()} onClick={createCapture}>加入待确认队列</Button></>}
      >
        <div className="capture-create-form">
          <div className="form-field"><label className="required">商品名称</label><input aria-label="商品名称" className="text-input" value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} placeholder="1688 商品名称或内部暂定名称" /></div>
          <div className="form-field"><label className="required">1688 来源链接</label><input aria-label="1688 来源链接" className="text-input" value={createForm.sourceUrl} onChange={(event) => setCreateForm((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://detail.1688.com/offer/..." /></div>
          <div className="source-two-col"><div className="form-field"><label>1688 商品 ID</label><input aria-label="1688 商品 ID" className="text-input mono" value={createForm.sourceProductId} onChange={(event) => setCreateForm((current) => ({ ...current, sourceProductId: event.target.value }))} /></div><div className="form-field"><label>供应商编号</label><input aria-label="供应商编号" className="text-input mono" value={createForm.supplierCode} onChange={(event) => setCreateForm((current) => ({ ...current, supplierCode: event.target.value }))} /></div></div>
          <div className="source-two-col"><div className="form-field"><label>供应商名称</label><input aria-label="供应商名称" className="text-input" value={createForm.supplierName} onChange={(event) => setCreateForm((current) => ({ ...current, supplierName: event.target.value }))} /></div><div className="form-field"><label>商品图片链接</label><input aria-label="商品图片链接" className="text-input" value={createForm.imageUrl} onChange={(event) => setCreateForm((current) => ({ ...current, imageUrl: event.target.value }))} /></div></div>
        </div>
      </Modal>

      <Modal
        open={Boolean(pendingDelete)}
        title="忽略这条采集记录？"
        description="该记录将移出待确认队列，但来源追踪和处理动作仍会保留在审计日志中。"
        onClose={() => setPendingDelete(null)}
        footer={<><Button onClick={() => setPendingDelete(null)}>取消</Button><Button variant="danger" onClick={removeItem}>忽略采集记录</Button></>}
      >
        <div className="confirm-record"><strong>{pendingDelete?.draft?.name ?? pendingDelete?.sourceTitle}</strong><span className="mono">{pendingDelete?.id}</span></div>
      </Modal>
    </>
  );
}

export default function CaptureQueue() {
  return <Navigate to="/products?view=pending" replace />;
}
