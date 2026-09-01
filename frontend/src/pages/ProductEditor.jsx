import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, CheckCircle2, ChevronRight, ExternalLink, Image, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import AppShell from "../components/AppShell";
import { Badge, Button, Modal, Panel, ProgressBar, useToast } from "../components/UI";
import { getProductEditorSnapshot, getSelectionReferenceSnapshot, getSelectionStatusDefinitions, saveCatalogManualCost, saveProductCatalogRecord, updateCaptureDraft } from "../data/database";
import { calculateSupplierLandedUnitCost, validateProductDraft, validateProductSalesReadiness } from "../domain/productCatalog";
import { canonicalPlatformSku } from "../domain/identifiers";
import { PRODUCT_PUBLICATION_STATUSES } from "../domain/productPublication";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";
import { selectionStatusById } from "../domain/selectionStatuses";

const issueLabels = {
  product_name_required: "缺少商品名称",
  platform_skc_missing: "尚未填写平台 SKC",
  platform_sku_missing: "尚未添加平台 SKU",
  package_weight_missing: "存在运费但尚未填写包装重量",
  english_title_missing: "尚未填写英文标题",
  supplier_code_missing: "尚未填写供应商编号",
  source_url_missing: "尚未填写 1688 来源链接",
};

function createVariant() {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    attribute: "",
    color: "",
    swatch: "#9ca3af",
    platformSku: "",
    warehouseSku: "",
    sourceSku: "",
    imageUrl: "",
    purchaseUnitPrice: "",
    salePrice: "",
    purchasePackCount: 1,
    unitsPerPack: 1,
  };
}

function createSupplier(variants = []) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    supplierCode: "",
    supplierName: "",
    sourceProductId: "",
    sourceUrl: "",
    shippingAmount: 0,
    handlingFee: 0,
    variants: variants.map((variant) => ({
      platformSku: variant.platformSku,
      sourceSku: "",
      purchaseUnitPrice: "",
      purchasePackCount: 0,
      unitsPerPack: 1,
    })),
  };
}

function supplierVariantFor(platformSku, variant = {}) {
  return {
    platformSku,
    sourceSku: variant.sourceSku ?? "",
    purchaseUnitPrice: variant.purchaseUnitPrice ?? "",
    purchasePackCount: variant.purchasePackCount ?? 0,
    unitsPerPack: variant.unitsPerPack ?? 1,
  };
}

function syncSupplierVariantAdded(suppliers, variant) {
  if (!Array.isArray(suppliers) || suppliers.length === 0) return suppliers;
  return suppliers.map((supplier) => ({
    ...supplier,
    variants: [
      ...(Array.isArray(supplier.variants) ? supplier.variants : []),
      supplierVariantFor(variant.platformSku, supplier === suppliers[0] ? variant : {}),
    ],
  }));
}

function syncSupplierVariantRemoved(suppliers, platformSku, variantIndex) {
  const key = String(platformSku ?? "").trim().toUpperCase();
  if (!Array.isArray(suppliers) || suppliers.length === 0) return suppliers;
  return suppliers.map((supplier) => ({
    ...supplier,
    variants: (Array.isArray(supplier.variants) ? supplier.variants : [])
      .filter((variant, index) => key
        ? String(variant.platformSku ?? "").trim().toUpperCase() !== key
        : index !== variantIndex),
  }));
}

function syncSupplierVariantRenamed(suppliers, previousSku, nextSku, variantIndex) {
  const previousKey = String(previousSku ?? "").trim().toUpperCase();
  if (!Array.isArray(suppliers) || suppliers.length === 0) return suppliers;
  return suppliers.map((supplier) => ({
    ...supplier,
    variants: (Array.isArray(supplier.variants) ? supplier.variants : []).map((variant, index) => (
      (previousKey && String(variant.platformSku ?? "").trim().toUpperCase() === previousKey)
        || (!previousKey && index === variantIndex)
        ? { ...variant, platformSku: nextSku }
        : variant
    )),
  }));
}

const visibilityOptions = [
  ["private", "仅自己可见"],
  ["workspace", "工作区共享"],
];

function formatIssue(issue) {
  if (issueLabels[issue]) return issueLabels[issue];
  const match = /^variant_(\d+)_(.+)$/.exec(issue);
  if (!match) return issue;
  const index = Number(match[1]) + 1;
  const detail = {
    platform_sku_required: "缺少平台 SKU",
    platform_sku_duplicate: "平台 SKU 与其他规格重复",
    purchase_price_missing: "缺少 1688 采购价",
    purchase_pack_count_invalid: "采购份数必须大于 0",
    units_per_pack_invalid: "每份单品数必须大于 0",
  }[match[2]] ?? match[2];
  return `第 ${index} 个规格：${detail}`;
}

function formatSalesReadinessIssue(issue) {
  const direct = {
    product_name_required: "缺少商品名称",
    platform_skc_required: "缺少平台 SKC",
    store_required: "未分配店铺",
    supplier_source_required: "缺少 1688 供应商链接",
  };
  if (direct[issue]) return direct[issue];
  const match = /^variant_(\d+)_(.+)$/.exec(issue);
  if (!match) return issue;
  const detail = {
    attribute_required: "缺少属性/规格",
    sale_price_required: "缺少售价",
    reference_cost_required: "缺少可用参考成本",
  }[match[2]] ?? match[2];
  return `第 ${Number(match[1]) + 1} 个 SKU：${detail}`;
}

function shortReferenceDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : null;
}

function modeLabel(snapshot) {
  if (snapshot?.mode === "capture") return "待确认采集";
  if (snapshot?.mode === "product") return "正式商品";
  return "新建商品";
}

export default function ProductEditor() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { notify } = useToast();
  const captureId = searchParams.get("capture");
  const productId = searchParams.get("product");
  const referenceSkc = searchParams.get("skc") ?? "";
  const referenceSku = searchParams.get("sku") ?? "";
  const referenceName = searchParams.get("name") ?? "";
  const snapshot = useLiveQuery(
    () => getProductEditorSnapshot({ captureId, productId, platformSkc: referenceSkc, platformSku: referenceSku, productName: referenceName }),
    [captureId, productId, referenceName, referenceSkc, referenceSku],
    undefined,
  );
  const referenceSnapshot = useLiveQuery(getSelectionReferenceSnapshot, [], null);
  const salesStatusDefinitions = useLiveQuery(getSelectionStatusDefinitions, [], []);
  const loadedKeyRef = useRef("");
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [manualCostTarget, setManualCostTarget] = useState(null);
  const [manualCostAmount, setManualCostAmount] = useState("");
  const [manualCostNote, setManualCostNote] = useState("");
  const [savingManualCost, setSavingManualCost] = useState(false);

  useEffect(() => {
    if (!snapshot) return;
    const key = `${snapshot.mode}:${snapshot.capture?.id ?? snapshot.product?.id ?? "new"}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    setDraft({
      ...snapshot.draft,
      variants: Array.isArray(snapshot.draft.variants) ? snapshot.draft.variants : [],
      suppliers: Array.isArray(snapshot.draft.suppliers) ? snapshot.draft.suppliers : [],
      tags: Array.isArray(snapshot.draft.tags) ? snapshot.draft.tags : [],
      salesStatus: snapshot.draft.salesStatus ?? (snapshot.product?.status === "active" ? "on_sale" : "pending_review"),
    });
    setSaved(false);
  }, [snapshot]);

  const validation = useMemo(() => validateProductDraft(draft ?? {}), [draft]);
  const totalPurchasePacks = useMemo(() => (draft?.variants ?? []).reduce((sum, variant) => sum + Number(variant.purchasePackCount ?? 0), 0), [draft?.variants]);
  const selectionReferenceBySku = useMemo(() => {
    if (!referenceSnapshot) return new Map();
    return new Map(buildSelectionReferenceRows(referenceSnapshot).map((row) => [row.canonicalPlatformSku, row]));
  }, [referenceSnapshot]);
  const supplierReferenceBySku = useMemo(() => {
    const suppliers = draft?.suppliers?.length ? draft.suppliers : draft ? [{
      supplierCode: draft.supplierCode,
      supplierName: draft.supplierName,
      sourceProductId: draft.sourceProductId,
      sourceUrl: draft.sourceUrl,
      shippingAmount: draft.shippingAmount,
      handlingFee: draft.handlingFee,
      variants: draft.variants,
    }] : [];
    const result = new Map();
    suppliers.forEach((supplier, supplierIndex) => {
      const supplierVariants = Array.isArray(supplier.variants) ? supplier.variants : [];
      const totalPacks = supplierVariants.reduce((sum, variant) => sum + Number(variant.purchasePackCount ?? 0), 0);
      supplierVariants.forEach((variant) => {
        const platformSku = String(variant.platformSku ?? "").trim();
        if (!platformSku) return;
        const unitCost = calculateSupplierLandedUnitCost({
          purchaseUnitPrice: variant.purchaseUnitPrice,
          shippingAmount: supplier.shippingAmount,
          totalPurchasePacks: totalPacks,
          handlingFee: supplier.handlingFee,
          unitsPerPack: variant.unitsPerPack,
        });
        if (unitCost == null) return;
        const key = canonicalPlatformSku(platformSku);
        const current = result.get(key);
        if (!current || unitCost < current.unitCost) {
          result.set(key, {
            unitCost,
            supplierIndex,
            supplierName: supplier.supplierName || supplier.supplierCode || `供应商 ${supplierIndex + 1}`,
          });
        }
      });
    });
    return result;
  }, [draft]);
  const referenceCosts = useMemo(() => (draft?.variants ?? []).map((variant) => {
    const platformSku = String(variant.platformSku ?? "").trim();
    const historical = platformSku ? selectionReferenceBySku.get(canonicalPlatformSku(platformSku)) : null;
    if (historical?.referenceUnitCost != null) return historical.referenceUnitCost;
    return platformSku ? supplierReferenceBySku.get(canonicalPlatformSku(platformSku))?.unitCost ?? null : null;
  }), [draft?.variants, selectionReferenceBySku, supplierReferenceBySku]);
  const selectedStatusDefinition = useMemo(() => selectionStatusById(salesStatusDefinitions, draft?.salesStatus), [draft?.salesStatus, salesStatusDefinitions]);
  const salesReadiness = useMemo(() => validateProductSalesReadiness({ draft: draft ?? {}, referenceCosts }), [draft, referenceCosts]);
  const statusRequiresReadiness = Boolean(selectedStatusDefinition?.requiresReadiness);
  const statusTransitionReady = !statusRequiresReadiness || salesReadiness.ready;

  if (snapshot === undefined) {
    return <AppShell pageClass="editor-page"><Panel className="route-loader">正在读取商品资料...</Panel></AppShell>;
  }

  if (snapshot === null) {
    return <AppShell pageClass="editor-page"><Panel className="route-loader">找不到对应的商品或采集记录。</Panel></AppShell>;
  }

  if (draft === null) {
    return <AppShell pageClass="editor-page"><Panel className="route-loader">正在准备商品编辑器...</Panel></AppShell>;
  }

  const updateDraft = (field, value) => {
    setSaved(false);
    setDraft((current) => {
      const next = { ...current, [field]: value };
      const primarySupplierFields = new Set(["supplierCode", "supplierName", "sourceProductId", "sourceUrl", "shippingAmount", "handlingFee"]);
      if (primarySupplierFields.has(field) && current.suppliers?.length) {
        next.suppliers = current.suppliers.map((supplier, index) => index === 0 ? { ...supplier, [field]: value } : supplier);
      }
      return next;
    });
  };

  const updateVariant = (index, field, value) => {
    setSaved(false);
    setDraft((current) => {
      const previousVariant = current.variants[index];
      const variants = current.variants.map((variant, rowIndex) => rowIndex === index ? { ...variant, [field]: value } : variant);
      const next = { ...current, variants };
      if (field === "platformSku") {
        next.suppliers = syncSupplierVariantRenamed(current.suppliers, previousVariant?.platformSku, value, index);
      } else if (current.suppliers?.length && current.suppliers[0]?.variants?.length) {
        next.suppliers = current.suppliers.map((supplier, supplierIndex) => supplierIndex === 0
          ? { ...supplier, variants: supplier.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, [field]: value } : variant) }
          : supplier);
      }
      return next;
    });
  };

  const openManualCostDialog = (variant, referenceCost) => {
    if (!snapshot.product?.id || !variant.platformSku) return;
    setManualCostTarget({ platformSku: variant.platformSku, attribute: variant.attribute || "未填写属性" });
    setManualCostAmount(referenceCost == null ? "" : String(referenceCost));
    setManualCostNote("");
  };

  const confirmManualCost = async () => {
    if (!manualCostTarget || !snapshot.product?.id) return;
    setSavingManualCost(true);
    try {
      await saveCatalogManualCost({
        productId: snapshot.product.id,
        platformSku: manualCostTarget.platformSku,
        amount: manualCostAmount,
        note: manualCostNote,
      });
      setManualCostTarget(null);
      notify("人工确认成本已保存到商品档案。ERP 成本存在时仍会优先显示 ERP 成本。", "success");
    } catch (error) {
      notify(`保存人工确认成本失败：${error.message}`, "error");
    } finally {
      setSavingManualCost(false);
    }
  };

  const updateSupplier = (supplierIndex, field, value) => {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      suppliers: current.suppliers.map((supplier, index) => index === supplierIndex ? { ...supplier, [field]: value } : supplier),
    }));
  };

  const updateSupplierVariant = (supplierIndex, variantIndex, field, value) => {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      suppliers: current.suppliers.map((supplier, index) => index === supplierIndex
        ? { ...supplier, variants: supplier.variants.map((variant, index) => index === variantIndex ? { ...variant, [field]: value } : variant) }
        : supplier),
    }));
  };

  const addSupplier = () => {
    setSaved(false);
    setDraft((current) => {
      const suppliers = current.suppliers?.length ? current.suppliers : [{
        id: "primary",
        supplierCode: current.supplierCode,
        supplierName: current.supplierName,
        sourceProductId: current.sourceProductId,
        sourceUrl: current.sourceUrl,
        shippingAmount: current.shippingAmount,
        handlingFee: current.handlingFee,
        variants: current.variants.map((variant) => ({ ...variant })),
      }];
      return { ...current, suppliers: [...suppliers, createSupplier(current.variants)] };
    });
  };

  const removeSupplier = (supplierIndex) => {
    setSaved(false);
    setDraft((current) => ({ ...current, suppliers: current.suppliers.filter((_, index) => index !== supplierIndex) }));
  };

  const removeVariant = (index) => {
    setSaved(false);
    setDraft((current) => {
      const removed = current.variants[index];
      return {
        ...current,
        variants: current.variants.filter((_, rowIndex) => rowIndex !== index),
        suppliers: syncSupplierVariantRemoved(current.suppliers, removed?.platformSku, index),
      };
    });
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      if (snapshot.mode === "capture") {
        await updateCaptureDraft({ captureId: snapshot.capture.id, draft });
        notify("采集草稿已保存，待确认队列已同步更新。", "success");
      } else {
        const status = snapshot.product?.status === "active" ? "active" : "draft";
        const result = await saveProductCatalogRecord({ productId: snapshot.product?.id, draft, status });
        notify(status === "active" ? "商品修改已保存。" : "商品草稿已保存到本机。", "success");
        if (snapshot.mode === "new") {
          loadedKeyRef.current = "";
          navigate(`/products/edit?product=${encodeURIComponent(result.product.id)}`, { replace: true });
        }
      }
      setSaved(true);
    } catch (error) {
      notify(`保存失败：${error.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const confirmEntry = async () => {
    setSaving(true);
    try {
      const result = await saveProductCatalogRecord({
        productId: snapshot.product?.id,
        captureId: snapshot.capture?.id,
        draft,
        status: "active",
      });
      setConfirmDialog(false);
      notify(`${result.product.name} 已写入正式商品库；1688 成本仅作为选品参考。`, "success");
      navigate("/products?view=official");
    } catch (error) {
      notify(`确认入库失败：${error.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const breadcrumbTarget = snapshot.mode === "capture" ? "/products?view=pending" : "/products?view=official";
  const referenceCostCount = referenceCosts.filter((value) => Number.isFinite(value) && value > 0).length;

  return (
    <AppShell searchPlaceholder="搜索商品、SKU 或供应商..." pageClass="editor-page">
      <div className="editor-breadcrumb"><button onClick={() => navigate(breadcrumbTarget)}>商品管理</button><ChevronRight size={15} /><span>{modeLabel(snapshot)}{snapshot.capture?.id ? `（${snapshot.capture.id}）` : ""}</span></div>
      <div className="editor-titlebar">
        <div><h1>{draft.name || "未命名商品"}</h1><Badge tone={validation.valid ? "success" : "warning"}>{validation.valid ? "可保存" : `${validation.blockingCount} 个阻断项`}</Badge>{saved ? <Badge tone="success">已保存</Badge> : <Badge tone="info">编辑中</Badge>}</div>
        <div className="page-actions"><Button loading={saving} disabled={saving || !draft.name.trim()} onClick={saveDraft}>保存草稿</Button><Button variant="primary" icon={CheckCircle2} disabled={!validation.valid || !statusTransitionReady || saving} onClick={() => setConfirmDialog(true)}>{snapshot.product?.status === "active" ? "保存商品档案" : "确认进入工作台"}</Button></div>
      </div>

      <div className="editor-grid">
        <div className="editor-left">
          <Panel className="product-gallery">
            <div className="main-product-image">{draft.imageUrl ? <img src={draft.imageUrl} alt={draft.name || "商品图片"} /> : <span className="catalog-image-placeholder"><Image size={34} /><small>尚未填写商品图片链接</small></span>}</div>
            <div className="form-field image-url-field"><label>商品图片链接</label><input aria-label="商品图片链接" className="text-input" value={draft.imageUrl} onChange={(event) => updateDraft("imageUrl", event.target.value)} placeholder="https://..." /></div>
          </Panel>

          <Panel className="source-panel">
            <div className="section-heading"><h2>1688 来源与报价</h2>{draft.sourceUrl ? <a className="inline-link" href={draft.sourceUrl} target="_blank" rel="noreferrer">打开来源<ExternalLink size={14} /></a> : null}</div>
            <div className="form-field"><label>1688 来源链接</label><input aria-label="1688 来源链接" className="text-input" value={draft.sourceUrl} onChange={(event) => updateDraft("sourceUrl", event.target.value)} placeholder="https://detail.1688.com/offer/..." /></div>
            <div className="source-two-col">
              <div className="form-field"><label>1688 商品 ID</label><input aria-label="1688 商品 ID" className="text-input mono" value={draft.sourceProductId} onChange={(event) => updateDraft("sourceProductId", event.target.value)} /></div>
              <div className="form-field"><label>供应商编号</label><input aria-label="供应商编号" className="text-input mono" value={draft.supplierCode} onChange={(event) => updateDraft("supplierCode", event.target.value)} /></div>
            </div>
            <div className="form-field"><label>供应商名称</label><input aria-label="供应商名称" className="text-input" value={draft.supplierName} onChange={(event) => updateDraft("supplierName", event.target.value)} /></div>
            <div className="source-two-col procurement-grid">
              <div className="form-field"><label>整单运费（CNY）</label><input aria-label="整单运费（CNY）" className="text-input mono" type="number" min="0" step="0.01" value={draft.shippingAmount} onChange={(event) => updateDraft("shippingAmount", event.target.value)} /></div>
              <div className="form-field"><label>单份操作费（CNY）</label><input aria-label="单份操作费（CNY）" className="text-input mono" type="number" min="0" step="0.01" value={draft.handlingFee} onChange={(event) => updateDraft("handlingFee", event.target.value)} /></div>
              <div className="form-field"><label>采购总份数</label><div className="source-inline mono">{totalPurchasePacks || 0} 份</div></div>
              <div className="form-field"><label>包装重量（kg）</label><input aria-label="包装重量（kg）" className="text-input mono" type="number" min="0" step="0.01" value={draft.packageWeight} onChange={(event) => updateDraft("packageWeight", event.target.value)} /></div>
            </div>
          </Panel>

          <Panel className="supplier-list-panel">
            <div className="panel-header"><div className="panel-title"><h2>其他供应商</h2><span className="panel-subtitle">同一 SKC 可保留多个 1688 来源与参考报价</span></div><Button variant="ghost" icon={Plus} onClick={addSupplier}>添加供应商</Button></div>
            {draft.suppliers.length === 0 ? <div className="supplier-empty"><strong>尚未添加供应商</strong><span>可先建立商品档案，后续再补充多个 1688 来源。</span></div> : draft.suppliers.length === 1 ? <div className="supplier-empty"><strong>当前使用默认供应商</strong><span>如需对比不同供货方，可在这里继续添加供应商。</span></div> : draft.suppliers.slice(1).map((supplier, relativeIndex) => {
              const supplierIndex = relativeIndex + 1;
              return <div className="supplier-card" key={supplier.id ?? supplierIndex}>
                <div className="supplier-card-heading"><strong>供应商 {supplierIndex + 1}</strong><button className="icon-button danger" aria-label={`删除供应商 ${supplierIndex + 1}`} title="删除供应商" onClick={() => removeSupplier(supplierIndex)}><Trash2 size={16} /></button></div>
                <div className="source-two-col"><div className="form-field"><label>供应商名称</label><input className="text-input" value={supplier.supplierName ?? ""} onChange={(event) => updateSupplier(supplierIndex, "supplierName", event.target.value)} /></div><div className="form-field"><label>供应商编号</label><input className="text-input mono" value={supplier.supplierCode ?? ""} onChange={(event) => updateSupplier(supplierIndex, "supplierCode", event.target.value)} /></div></div>
                <div className="source-two-col"><div className="form-field"><label>1688 采购链接</label><input className="text-input" value={supplier.sourceUrl ?? ""} onChange={(event) => updateSupplier(supplierIndex, "sourceUrl", event.target.value)} placeholder="https://detail.1688.com/offer/..." /></div><div className="form-field"><label>1688 商品 ID</label><input className="text-input mono" value={supplier.sourceProductId ?? ""} onChange={(event) => updateSupplier(supplierIndex, "sourceProductId", event.target.value)} /></div></div>
                <div className="source-two-col"><div className="form-field"><label>整单运费（CNY）</label><input className="text-input mono" type="number" min="0" step="0.01" value={supplier.shippingAmount ?? 0} onChange={(event) => updateSupplier(supplierIndex, "shippingAmount", event.target.value)} /></div><div className="form-field"><label>单份操作费（CNY）</label><input className="text-input mono" type="number" min="0" step="0.01" value={supplier.handlingFee ?? 0} onChange={(event) => updateSupplier(supplierIndex, "handlingFee", event.target.value)} /></div></div>
                <div className="supplier-sku-grid supplier-sku-grid-detailed">{draft.variants.map((variant, variantIndex) => { const offer = supplier.variants[variantIndex] ?? {}; return <div className="supplier-sku-row" key={variant.platformSku || variant.id}><span className="mono">{variant.platformSku || "未填写 SKU"}</span><input aria-label={`${supplier.supplierName || "供应商"} ${variant.platformSku || "SKU"} 采购价`} className="table-input mono" type="number" min="0" step="0.01" placeholder="采购价/份" value={offer.purchaseUnitPrice ?? ""} onChange={(event) => updateSupplierVariant(supplierIndex, variantIndex, "purchaseUnitPrice", event.target.value)} /><input aria-label={`${supplier.supplierName || "供应商"} ${variant.platformSku || "SKU"} 采购份数`} className="table-input mono" type="number" min="0" step="1" placeholder="采购份数" value={offer.purchasePackCount ?? ""} onChange={(event) => updateSupplierVariant(supplierIndex, variantIndex, "purchasePackCount", event.target.value)} /><input aria-label={`${supplier.supplierName || "供应商"} ${variant.platformSku || "SKU"} 每份单品数`} className="table-input mono" type="number" min="1" step="1" placeholder="每份单品数" value={offer.unitsPerPack ?? 1} onChange={(event) => updateSupplierVariant(supplierIndex, variantIndex, "unitsPerPack", event.target.value)} /></div>; })}</div>
              </div>;
            })}
          </Panel>
        </div>

        <div className="editor-center">
          <Panel className="mapping-panel">
            <div className="section-heading"><h2>平台映射</h2><Badge tone="info">平台 SKU 工作区全局唯一</Badge></div>
            <div className="form-field"><label className="required">商品名称</label><input aria-label="商品名称" className="text-input" value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} /></div>
            <div className="form-field"><label>英文标题</label><input aria-label="英文标题" className="text-input" value={draft.englishTitle} onChange={(event) => updateDraft("englishTitle", event.target.value)} /></div>
            <div className="mapping-two-col">
              <div className="form-field"><label>发布平台</label><input aria-label="发布平台" className="text-input" value={draft.salesPlatform ?? ""} onChange={(event) => updateDraft("salesPlatform", event.target.value)} placeholder="例如：SHEIN" /></div>
              <div className="form-field"><label>发布状态</label><select aria-label="发布状态" className="select-input" value={draft.publicationStatus ?? "unpublished"} onChange={(event) => updateDraft("publicationStatus", event.target.value)}>{PRODUCT_PUBLICATION_STATUSES.map((statusItem) => <option value={statusItem.id} key={statusItem.id}>{statusItem.label}</option>)}</select></div>
            </div>
            <div className="mapping-two-col">
              <div className="form-field"><label>平台 SKC</label><input aria-label="平台 SKC" className="text-input mono" value={draft.platformSkc} onChange={(event) => updateDraft("platformSkc", event.target.value)} /></div>
              <div className="form-field"><label>分配店铺</label><input aria-label="分配店铺" className="text-input" value={draft.store} onChange={(event) => updateDraft("store", event.target.value)} placeholder="例如：美国主店" /></div>
            </div>
            <div className="mapping-two-col">
              <div className="form-field"><label>选品状态</label><select aria-label="选品状态" className="select-input" value={draft.salesStatus} onChange={(event) => updateDraft("salesStatus", event.target.value)}>{salesStatusDefinitions.filter((status) => !status.archivedAt || status.id === draft.salesStatus).map((status) => <option value={status.id} key={status.id}>{status.label}{status.archivedAt ? "（已归档）" : ""}</option>)}</select></div>
              <div className="form-field"><label>标签</label><input aria-label="商品标签" className="text-input" value={(draft.tags ?? []).join(", ")} onChange={(event) => updateDraft("tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} placeholder="例如：高潜、活动款" /></div>
            </div>
            <div className="mapping-two-col">
              <div className="form-field"><label>可见范围</label><select aria-label="商品可见范围" className="select-input" value={draft.visibility ?? "workspace"} onChange={(event) => updateDraft("visibility", event.target.value)}>{visibilityOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
              <div className="form-field"><label>归属账号</label><div className="field-readonly mono">{draft.ownerId || "当前账号"}</div></div>
            </div>
            <div className="form-field"><label>选品备注</label><textarea aria-label="选品备注" className="text-area" rows="3" value={draft.notes ?? ""} onChange={(event) => updateDraft("notes", event.target.value)} placeholder="记录选品判断、供应商沟通或后续动作" /></div>
          </Panel>

          <Panel className="variants-panel catalog-variants-panel">
            <div className="panel-header"><div className="panel-title"><h2>平台 SKU 属性分支</h2><span className="panel-subtitle">平台 SKU 全工作区唯一；一个 ERP 仓库 SKU 可复用给多个平台 SKU</span></div><Button variant="ghost" icon={Plus} onClick={() => setDraft((current) => { const variant = createVariant(); return { ...current, variants: [...current.variants, variant], suppliers: syncSupplierVariantAdded(current.suppliers, variant) }; })}>添加规格</Button></div>
            <div className="table-wrap">
              <table className="data-table variants-table catalog-variants-table">
                <thead><tr><th>规格</th><th>平台 SKU</th><th>ERP 仓库 SKU</th><th>1688 来源 SKU</th><th>SKU 图片</th><th>采购价/份</th><th>售价</th><th>采购份数</th><th>每份单品数</th><th>参考单件成本</th><th>参考单件利润</th><th>操作</th></tr></thead>
                <tbody>{draft.variants.length === 0 ? <tr><td className="pending-text" colSpan="12">尚未添加平台 SKU 分支</td></tr> : draft.variants.map((variant, index) => { const platformSku = String(variant.platformSku ?? "").trim(); const referenceRow = platformSku ? selectionReferenceBySku.get(canonicalPlatformSku(platformSku)) : null; const supplierReference = platformSku ? supplierReferenceBySku.get(canonicalPlatformSku(platformSku)) : null; const referenceCost = referenceCosts[index]; const referenceSource = referenceRow?.authoritativeSource === "erp" ? "ERP 历史" : referenceRow?.authoritativeSource === "manual_confirmed" ? "人工确认" : referenceRow?.referenceUnitCost != null ? "定稿历史" : supplierReference ? `${supplierReference.supplierName} · 1688` : "1688 参考"; const manualDetail = referenceRow?.referenceKind === "manual_confirmed" ? `${shortReferenceDate(referenceRow.referenceUpdatedAt) ? `确认于 ${shortReferenceDate(referenceRow.referenceUpdatedAt)}` : "已确认"}${referenceRow.manualCostHistoryCount > 1 ? ` · ${referenceRow.manualCostHistoryCount} 条记录` : ""}` : null; const salePrice = Number(variant.salePrice); const referenceProfit = Number.isFinite(salePrice) && referenceCost != null ? salePrice - referenceCost - 0.7 : null; return <tr key={variant.id ?? index}><td><input aria-label={`第 ${index + 1} 个规格名称`} className="table-input catalog-text-input" value={variant.attribute} onChange={(event) => updateVariant(index, "attribute", event.target.value)} placeholder="颜色/尺寸" /></td><td><input aria-label={`第 ${index + 1} 个平台 SKU`} className="table-input catalog-sku-input mono" value={variant.platformSku} onChange={(event) => updateVariant(index, "platformSku", event.target.value)} /></td><td><input aria-label={`第 ${index + 1} 个 ERP 仓库 SKU`} className="table-input catalog-sku-input mono" value={variant.warehouseSku ?? ""} onChange={(event) => updateVariant(index, "warehouseSku", event.target.value)} placeholder="可被多个平台 SKU 复用" /></td><td><input aria-label={`第 ${index + 1} 个 1688 来源 SKU`} className="table-input catalog-sku-input mono" value={variant.sourceSku} onChange={(event) => updateVariant(index, "sourceSku", event.target.value)} /></td><td><input aria-label={`第 ${index + 1} 个 SKU 图片链接`} className="table-input catalog-sku-input" value={variant.imageUrl ?? ""} onChange={(event) => updateVariant(index, "imageUrl", event.target.value)} placeholder="图片链接" /></td><td><input aria-label={`第 ${index + 1} 个采购价`} className="table-input mono" type="number" min="0" step="0.01" value={variant.purchaseUnitPrice} onChange={(event) => updateVariant(index, "purchaseUnitPrice", event.target.value)} /></td><td><input aria-label={`第 ${index + 1} 个售价`} className="table-input mono" type="number" min="0" step="0.01" value={variant.salePrice} onChange={(event) => updateVariant(index, "salePrice", event.target.value)} /></td><td><input aria-label={`第 ${index + 1} 个采购份数`} className="table-input mono" type="number" min="1" step="1" value={variant.purchasePackCount} onChange={(event) => updateVariant(index, "purchasePackCount", event.target.value)} /></td><td><input aria-label={`第 ${index + 1} 个每份单品数`} className="table-input mono" type="number" min="1" step="1" value={variant.unitsPerPack} onChange={(event) => updateVariant(index, "unitsPerPack", event.target.value)} /></td><td className="mono"><span>{referenceCost == null ? "--" : `¥${referenceCost.toFixed(2)}`}</span>{referenceCost != null ? <small className="row-subtitle" title={referenceRow?.referenceNote ?? undefined}>{manualDetail ?? referenceSource}</small> : null}{snapshot.product?.id && platformSku ? <button type="button" className="catalog-cost-edit" title="确认人工成本" aria-label={`确认 ${platformSku} 的人工成本`} onClick={() => openManualCostDialog(variant, referenceCost)}><Pencil size={13} /></button> : null}</td><td className={`mono ${referenceProfit != null && referenceProfit < 0 ? "danger-text" : "success-text"}`}>{referenceProfit == null ? "--" : `¥${referenceProfit.toFixed(2)}`}</td><td><button className="variant-remove" aria-label={`删除第 ${index + 1} 个规格`} onClick={() => removeVariant(index)}><Trash2 size={16} /></button></td></tr>; })}</tbody>
              </table>
            </div>
          </Panel>
        </div>

        <Panel className={`validation-panel ${validation.valid ? "validation-passed" : ""}`}>
          <div className="validation-heading">{validation.valid ? <CheckCircle2 size={23} /> : <TriangleAlert size={23} />}<h2>入库校验</h2></div>
          {validation.blockingIssues.slice(0, 4).map((issue) => <div className="validation-item blocking" key={issue}><AlertCircle size={18} /><div><h3>{formatIssue(issue)}</h3><p>请先修正后再保存商品档案。</p></div></div>)}
          {validation.warningIssues.slice(0, 3).map((issue) => <div className="validation-item warning" key={issue}><AlertCircle size={18} /><div><h3>{formatIssue(issue)}</h3><p>商品档案可先保存，后续按发布进度补齐。</p></div></div>)}
          {validation.valid ? <div className="validation-item passed"><CheckCircle2 size={18} /><div><h3>商品档案可保存</h3><p>填写平台 SKU 时会检查其是否已属于其他商品。</p></div></div> : null}
          {statusRequiresReadiness ? (salesReadiness.ready ? <div className="validation-item passed"><CheckCircle2 size={18} /><div><h3>{selectedStatusDefinition.label}状态资料已完整</h3><p>店铺、供应商来源、SKU 属性、售价和参考成本均已具备。</p></div></div> : <div className="validation-item warning"><AlertCircle size={18} /><div><h3>{selectedStatusDefinition.label}状态还不能确认</h3><p>{salesReadiness.issues.slice(0, 3).map(formatSalesReadinessIssue).join("；")}{salesReadiness.issues.length > 3 ? " 等待补齐。" : "。"}</p></div></div>) : null}
          <div className="validation-item passed"><CheckCircle2 size={18} /><div><h3>成本口径已锁定</h3><p>{referenceCostCount === 0 ? "尚无可计算的参考成本。" : `已为 ${referenceCostCount}/${draft.variants.length} 个平台 SKU 形成参考成本；优先采用 ERP 历史，1688 仅作参考，不会自动成为月度正式成本。`}</p></div></div>
          <div className="readiness"><span>资料准备度 <strong>{validation.readiness}%</strong></span><ProgressBar value={validation.readiness} tone={validation.valid ? "success" : "warning"} /></div>
        </Panel>
      </div>

      <Modal open={confirmDialog} title={snapshot.product?.status === "active" ? "保存商品档案" : "确认进入工作台"} description="系统会在同一事务中写入商品档案、已填写的平台 SKU、1688 供应商资料和审计记录。" onClose={() => setConfirmDialog(false)} footer={<><Button onClick={() => setConfirmDialog(false)}>取消</Button><Button variant="primary" loading={saving} disabled={saving} onClick={confirmEntry}>确认写入</Button></>}>
        <div className="confirm-summary"><span><strong>商品</strong>{draft.name}</span><span><strong>平台 SKC</strong>{draft.platformSkc}</span><span><strong>平台 SKU</strong>{draft.variants.length} 个</span><span><strong>参考成本覆盖</strong>{referenceCostCount}/{draft.variants.length} SKU</span></div>
      </Modal>
      <Modal
        open={Boolean(manualCostTarget)}
        title="确认人工成本"
        description={manualCostTarget ? `${manualCostTarget.platformSku} · ${manualCostTarget.attribute}。该记录只用于选品档案的当前参考成本；同 SKU 有 ERP 成本时，ERP 仍然优先。` : ""}
        onClose={() => setManualCostTarget(null)}
        footer={<><Button variant="ghost" onClick={() => setManualCostTarget(null)}>取消</Button><Button variant="primary" loading={savingManualCost} disabled={savingManualCost || !manualCostAmount} onClick={confirmManualCost}>确认成本</Button></>}
      >
        <div className="manual-cost-form">
          <div className="form-field"><label>确认单件成本（CNY）</label><input className="text-input mono" aria-label="确认单件成本（CNY）" type="number" min="0" step="0.01" value={manualCostAmount} onChange={(event) => setManualCostAmount(event.target.value)} /></div>
          <div className="form-field"><label>确认说明</label><textarea className="text-area" aria-label="确认说明" rows="3" value={manualCostNote} onChange={(event) => setManualCostNote(event.target.value)} placeholder="例如：已核实运费和包装规格后的落地成本" /></div>
        </div>
      </Modal>
    </AppShell>
  );
}
