import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, CheckCircle2, ChevronRight, ExternalLink, Image, Pencil, Plus, Trash2 } from "lucide-react";
import AppShell from "../components/AppShell";
import SelectionSalesTag from "../components/SelectionSalesTag";
import ProductEditorLeaveGuard from "../components/ProductEditorLeaveGuard";
import { productLibraryReturnPath } from "../components/productLibraryViewState";
import { Badge, Button, Modal, Panel, useToast } from "../components/UI";
import { getProductEditorSnapshot, getSelectionReferenceSnapshot, getSelectionStatusDefinitions, saveCatalogManualCost, saveProductCatalogRecord, updateCaptureDraft } from "../data/database";
import { normalizeProductTags, productDraftReferences, productSalePrice, productSaveReadiness, productReadinessIssueLabel } from "../domain/productSelectionDraft";
import { requestErpProductCatalog } from "../data/repositories/erpCatalogRepository";
import { ERP_CATALOG_GROUPS } from "../domain/erpCatalogRequest";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";
import { normalizeSelectionStatusDefinitions, resolveProductStatus, selectionStatusById } from "../domain/selectionStatuses";
import { canonicalPlatformSku } from "../domain/identifiers";

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

function modeLabel(snapshot) {
  if (snapshot?.mode === "capture") return "待确认采集";
  if (snapshot?.mode === "product") return "正式商品";
  return "新建商品";
}

export default function ProductEditorRoute() {
  const location = useLocation();
  return <ProductEditor key={location.search} />;
}

function ProductEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { notify } = useToast();
  const captureId = searchParams.get("capture");
  const returnTo = productLibraryReturnPath(location.state?.productLibraryReturnTo, captureId ? "/products?view=pending" : "/products?view=official");
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
  const [tagsText, setTagsText] = useState("");
  const [savedFingerprint, setSavedFingerprint] = useState(null);
  const [persistedProduct, setPersistedProduct] = useState(null);
  const allowNavigationRef = useRef(false);
  const currentDraftRef = useRef(null);
  const fingerprint = JSON.stringify({ draft, tagsText });
  currentDraftRef.current = { draft, tagsText, fingerprint };
  const dirty = draft != null && savedFingerprint != null && fingerprint !== savedFingerprint;
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [manualCostTarget, setManualCostTarget] = useState(null);
  const [manualCostAmount, setManualCostAmount] = useState("");
  const [manualCostNote, setManualCostNote] = useState("");
  const [savingManualCost, setSavingManualCost] = useState(false);
  const [catalogRequestPeriod, setCatalogRequestPeriod] = useState("");
  const [requestingCatalog, setRequestingCatalog] = useState(false);
  const [catalogRequestMessage, setCatalogRequestMessage] = useState("");
  const [catalogRequestFailed, setCatalogRequestFailed] = useState(false);
  const [saveFieldErrors, setSaveFieldErrors] = useState({});

  useEffect(() => {
    if (!snapshot) return;
    const key = `${snapshot.mode}:${snapshot.capture?.id ?? snapshot.product?.id ?? `${referenceSkc}:${referenceSku}:${referenceName}`}`;
    const sameRecord = loadedKeyRef.current === key;
    if (sameRecord && currentDraftRef.current?.fingerprint !== savedFingerprint) return;
    loadedKeyRef.current = key;
    const nextDraft = {
      ...snapshot.draft,
      variants: Array.isArray(snapshot.draft.variants) ? snapshot.draft.variants : [],
      suppliers: Array.isArray(snapshot.draft.suppliers) ? snapshot.draft.suppliers : [],
      tags: Array.isArray(snapshot.draft.tags) ? snapshot.draft.tags : [],
      productStatus: snapshot.draft.legacyStatusConflict ? undefined : snapshot.draft.productStatus ?? (resolveProductStatus(snapshot.draft).legacyConflict ? undefined : resolveProductStatus(snapshot.draft).statusId),
    };
    const nextTags = nextDraft.tags.join(", ");
    if (sameRecord && JSON.stringify({ draft: nextDraft, tagsText: nextTags }) === currentDraftRef.current?.fingerprint) return;
    setDraft(nextDraft);
    setTagsText(nextTags);
    setSavedFingerprint(JSON.stringify({ draft: nextDraft, tagsText: nextTags }));
    setPersistedProduct(snapshot.product ?? null);
    setSaved(false);
    const sourcePeriod = snapshot.prefill?.referencePeriod ?? snapshot.draft.referencePeriod ?? snapshot.draft.variants?.map(variant => variant.referencePeriod).filter(Boolean).sort().at(-1) ?? "";
    setCatalogRequestPeriod(current => sameRecord && current ? current : sourcePeriod);
  }, [snapshot]);

  const historicalRows = useMemo(() => referenceSnapshot ? buildSelectionReferenceRows(referenceSnapshot) : [], [referenceSnapshot]);
  const draftReferences = useMemo(() => productDraftReferences(draft ?? {}, historicalRows), [draft, historicalRows]);
  const referenceCosts = useMemo(() => draftReferences.map(reference => reference.unitCost), [draftReferences]);
  const userStatus = useMemo(() => resolveProductStatus(draft ?? {}, salesStatusDefinitions), [draft, salesStatusDefinitions]);
  const selectedStatusDefinition = useMemo(() => selectionStatusById(salesStatusDefinitions, userStatus.statusId), [userStatus.statusId, salesStatusDefinitions]);
  const statusOptions = useMemo(() => {
    const definitions = normalizeSelectionStatusDefinitions(salesStatusDefinitions);
    if (!definitions.some(status => status.id === userStatus.statusId)) definitions.push(selectedStatusDefinition);
    return definitions.filter(status => !status.archivedAt || status.id === userStatus.statusId);
  }, [salesStatusDefinitions, userStatus.statusId, selectedStatusDefinition]);
  const saveReadiness = useMemo(() => productSaveReadiness({ draft: { ...(draft ?? {}), ...(snapshot?.prefill?.source === "erp" ? { catalogOrigin: "accounting" } : {}) }, statusDefinition: selectedStatusDefinition, historicalRows }), [draft, selectedStatusDefinition, historicalRows]);
  const validation = saveReadiness.validation;
  const unresolvedConflicts = (snapshot?.prefill?.identityConflicts ?? []).filter(conflict => !(draft?.excludedIdentitySkus ?? []).some(sku => canonicalPlatformSku(sku) === canonicalPlatformSku(conflict.platformSku)));
  const statusChoiceRequired = Boolean(draft?.legacyStatusConflict || userStatus.legacyConflict) && !draft?.statusEdited;
  const canSave = saveReadiness.valid && !statusChoiceRequired && !unresolvedConflicts.length;

  if (snapshot === undefined) {
    return <AppShell pageClass="editor-page"><Panel className="route-loader">正在读取商品资料...</Panel></AppShell>;
  }

  if (snapshot === null) {
    return <AppShell pageClass="editor-page"><Panel className="route-loader">找不到对应的商品或采集记录。</Panel></AppShell>;
  }

  if (draft === null) {
    return <AppShell pageClass="editor-page"><Panel className="route-loader">正在准备商品编辑器...</Panel></AppShell>;
  }
  const currentProductId = persistedProduct?.id ?? snapshot.product?.id;

  const updateDraft = (field, value) => {
    setSaved(false);
    setDraft((current) => {
      const next = { ...current, [field]: value, fieldEdits: { ...current.fieldEdits, [field]: true } };
      if (field === "productStatus") next.statusEdited = true;
      const primarySupplierFields = new Set(["supplierCode", "supplierName", "sourceProductId", "sourceUrl", "shippingAmount", "handlingFee"]);
      if (primarySupplierFields.has(field) && current.suppliers?.length) {
        next.suppliers = current.suppliers.map((supplier, index) => index === 0 ? { ...supplier, [field]: value } : supplier);
        const supplierId = current.suppliers[0].id ?? "primary";
        next.fieldEdits.suppliers = { ...current.fieldEdits?.suppliers, [supplierId]: { ...current.fieldEdits?.suppliers?.[supplierId], [field]: true } };
      }
      return next;
    });
  };

  const updateVariant = (index, field, value) => {
    setSaved(false); setSaveFieldErrors({});
    setDraft((current) => {
      const previousVariant = current.variants[index];
      const variants = current.variants.map((variant, rowIndex) => rowIndex === index ? { ...variant, [field]: value } : variant);
      const skuKey = canonicalPlatformSku(previousVariant?.platformSku || value);
      const next = { ...current, variants, fieldEdits: { ...current.fieldEdits, variants: { ...current.fieldEdits?.variants, [skuKey]: { ...current.fieldEdits?.variants?.[skuKey], [field]: true } } } };
      if (["purchaseUnitPrice", "purchasePackCount", "unitsPerPack"].includes(field)) {
        next.quoteEditIntent = { supplierIds: [...new Set([...(current.quoteEditIntent?.supplierIds ?? []), current.suppliers?.[0]?.id ?? "primary"])] };
      }
      if (field === "platformSku") {
        next.suppliers = syncSupplierVariantRenamed(current.suppliers, previousVariant?.platformSku, value, index);
      } else if (current.suppliers?.length && current.suppliers[0]?.variants?.length) {
        next.suppliers = current.suppliers.map((supplier, supplierIndex) => supplierIndex === 0
          ? { ...supplier, variants: supplier.variants.map(variant => String(variant.platformSku).trim().toUpperCase() === String(previousVariant.platformSku).trim().toUpperCase() ? { ...variant, [field]: value } : variant) }
          : supplier);
      }
      return next;
    });
  };

  const openManualCostDialog = (variant, referenceCost) => {
    if (!currentProductId || !variant.platformSku) return;
    setManualCostTarget({ platformSku: variant.platformSku, attribute: variant.attribute || "未填写属性" });
    setManualCostAmount(referenceCost == null ? "" : String(referenceCost));
    setManualCostNote("");
  };

  const confirmManualCost = async () => {
    if (!manualCostTarget || !currentProductId) return;
    setSavingManualCost(true);
    try {
      await saveCatalogManualCost({
        productId: currentProductId,
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
      fieldEdits: { ...current.fieldEdits, suppliers: { ...current.fieldEdits?.suppliers, [current.suppliers[supplierIndex].id ?? `supplier-${supplierIndex}`]: { ...current.fieldEdits?.suppliers?.[current.suppliers[supplierIndex].id ?? `supplier-${supplierIndex}`], [field]: true } } },
    }));
  };

  const updateSupplierVariant = (supplierIndex, platformSku, field, value) => {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      quoteEditIntent: { supplierIds: [...new Set([...(current.quoteEditIntent?.supplierIds ?? []), current.suppliers[supplierIndex].id ?? (supplierIndex === 0 ? "primary" : `supplier-${supplierIndex}`)])] },
      suppliers: current.suppliers.map((supplier, index) => {
        if (index !== supplierIndex) return supplier;
        const key = String(platformSku).trim().toUpperCase();
        const existing = supplier.variants.find(variant => String(variant.platformSku).trim().toUpperCase() === key);
        return { ...supplier, variants: existing
          ? supplier.variants.map(variant => variant === existing ? { ...variant, [field]: value } : variant)
          : [...supplier.variants, { ...supplierVariantFor(platformSku), [field]: value }] };
      }),
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

  const navigateSaved = (target, options) => {
    allowNavigationRef.current = true;
    navigate(target, options);
    window.setTimeout(() => { allowNavigationRef.current = false; }, 0);
  };
  const isFormalProduct = (persistedProduct ?? snapshot.product)?.status === "active";
  const locateSaveError = error => {
    const variantIndex = draft.variants.findIndex(variant => variant.platformSku && (error.message.includes(variant.platformSku) || error.message.toUpperCase().includes(canonicalPlatformSku(variant.platformSku))));
    if (variantIndex < 0 || !/SKU|SKC|身份|重复/i.test(error.message)) return;
    const sku = canonicalPlatformSku(draft.variants[variantIndex].platformSku);
    setSaveFieldErrors({ [sku]: error.message });
    window.setTimeout(() => document.getElementById(`variant-${variantIndex}-sku`)?.focus(), 0);
  };
  const saveDraft = async ({ stay = false } = {}) => {
    if (saving) return false;
    if (!canSave && (snapshot.prefill?.source === "erp" || isFormalProduct)) {
      notify("请先处理商品名称、身份或状态选择。", "error"); return false;
    }
    const submitted = currentDraftRef.current;
    const submittedDraft = { ...submitted.draft, tags: normalizeProductTags(submitted.tagsText) };
    setSaving(true);
    try {
      if (snapshot.mode === "capture" && !persistedProduct) {
        await updateCaptureDraft({ captureId: snapshot.capture.id, draft: submittedDraft });
        notify("采集草稿已保存，待确认队列已同步更新。", "success");
      } else {
        const status = isFormalProduct ? "active" : "draft";
        const result = await saveProductCatalogRecord({ productId: persistedProduct?.id ?? snapshot.product?.id, draft: submittedDraft, status });
        setPersistedProduct(result.product);
        notify(status === "active" ? "商品修改已保存。" : "商品草稿已保存到本机。", "success");
        if (snapshot.mode === "new" && !stay && currentDraftRef.current.fingerprint === submitted.fingerprint) {
          navigateSaved(`/products/edit?product=${encodeURIComponent(result.product.id)}`, { replace: true, state: { productLibraryReturnTo: returnTo } });
        }
      }
      setSavedFingerprint(submitted.fingerprint);
      setSaved(true);
      return currentDraftRef.current.fingerprint === submitted.fingerprint;
    } catch (error) {
      locateSaveError(error);
      notify(`保存失败：${error.message}`, "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const confirmEntry = async () => {
    if (saving) return;
    const submitted = currentDraftRef.current;
    setSaving(true);
    try {
      const result = await saveProductCatalogRecord({
        productId: persistedProduct?.id ?? snapshot.product?.id,
        captureId: persistedProduct ? undefined : snapshot.capture?.id,
        draft: { ...submitted.draft, tags: normalizeProductTags(submitted.tagsText) },
        status: "active",
      });
      setConfirmDialog(false);
      setPersistedProduct(result.product);
      setSavedFingerprint(submitted.fingerprint);
      setSaved(true);
      notify(`${result.product.name} 已写入正式商品库；1688 成本仅作为选品参考。`, "success");
      if (currentDraftRef.current.fingerprint === submitted.fingerprint) navigateSaved(returnTo);
      else notify("已提交的内容已保存；保存期间的新修改仍保留在编辑器中。", "info");
    } catch (error) {
      locateSaveError(error);
      notify(`保存商品失败：${error.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const breadcrumbTarget = returnTo;
  const referenceCostCount = referenceCosts.filter(value => value != null && Number.isFinite(Number(value)) && Number(value) >= 0).length;
  const isAccountingDraft = snapshot.mode === "new" && (snapshot.prefill?.source === "erp" || Boolean(referenceSkc || referenceSku));
  const issueText = issue => saveReadiness.issues.includes(issue) ? productReadinessIssueLabel(issue) : null;
  const showFieldIssue = (id, issue) => issueText(issue) ? <small id={id} className="field-error" role="status">{issueText(issue)}</small> : null;
  const excludeConflict = conflict => {
    setDraft(current => ({ ...current, excludedIdentitySkus: [...new Set([...(current.excludedIdentitySkus ?? []), conflict.platformSku])], variants: current.variants.filter(variant => canonicalPlatformSku(variant.platformSku) !== canonicalPlatformSku(conflict.platformSku)) }));
  };
  const supplierRows = draft.suppliers.length ? draft.suppliers : [{ id: "primary", supplierName: draft.supplierName, sourceUrl: draft.sourceUrl, variants: draft.variants }];
  const prefill = snapshot.prefill;
  const pendingNewVariants = (snapshot.draft.variants ?? []).filter(candidate => candidate.platformSku && !draft.variants.some(variant => canonicalPlatformSku(variant.platformSku) === canonicalPlatformSku(candidate.platformSku)) && !(draft.excludedIdentitySkus ?? []).some(sku => canonicalPlatformSku(sku) === canonicalPlatformSku(candidate.platformSku)));
  const addNewCatalogData = () => {
    setDraft(current => {
      const identity = supplier => supplier.supplierId || supplier.id;
      const suppliers = current.suppliers.map(supplier => {
        const incoming = (snapshot.draft.suppliers ?? []).find(item => identity(item) === identity(supplier));
        if (!incoming) return supplier;
        return { ...supplier, variants: [...(supplier.variants ?? []), ...(incoming.variants ?? []).filter(candidate => !(supplier.variants ?? []).some(item => canonicalPlatformSku(item.platformSku) === canonicalPlatformSku(candidate.platformSku)))] };
      });
      for (const incoming of snapshot.draft.suppliers ?? []) if (!suppliers.some(item => identity(item) === identity(incoming))) suppliers.push(incoming);
      return { ...current, variants: [...current.variants, ...pendingNewVariants], suppliers };
    });
  };
  const catalogCoverage = prefill?.catalogCoverage ?? draft.catalogCoverage ?? {};
  const missingCatalogGroups = ERP_CATALOG_GROUPS.filter(group => (catalogCoverage[group]?.status ?? catalogCoverage[group]) !== "complete");
  const requestCatalog = async () => {
    if (requestingCatalog || !draft.platformSkc || !catalogRequestPeriod) return;
    setRequestingCatalog(true); setCatalogRequestFailed(false);
    try {
      const result = await requestErpProductCatalog({ platformSkcs: [draft.platformSkc], productId: currentProductId ?? null, period: catalogRequestPeriod, missingGroups: missingCatalogGroups });
      setCatalogRequestMessage(result.registered ? "资料请求已登记，等待 ERP 返回资料。" : "资料请求已保存在本机，尚未送达 ERP；请重试登记。");
      setCatalogRequestFailed(!result.registered);
    } catch (error) {
      setCatalogRequestMessage(`资料请求未完成：${error.message}`); setCatalogRequestFailed(true);
    } finally { setRequestingCatalog(false); }
  };


  return (
    <AppShell searchPlaceholder="搜索商品、SKU 或供应商..." pageClass="editor-page">
      <ProductEditorLeaveGuard dirty={dirty} saving={saving} allowNavigationRef={allowNavigationRef} onSave={() => saveDraft({ stay: true })} />
      <div className="editor-breadcrumb"><button onClick={() => navigate(breadcrumbTarget)}>商品管理</button><ChevronRight size={15} /><span>{modeLabel(snapshot)}</span></div>
      <div className="editor-titlebar">
        <div className="editor-heading"><h1>{draft.name || "新建商品档案"}</h1>{dirty ? <Badge tone="warning">未保存修改</Badge> : saved ? <Badge tone="success">已保存</Badge> : null}</div>
        <div className="page-actions"><Button variant="ghost" disabled={saving} onClick={() => navigate(returnTo)}>取消</Button>{isFormalProduct ? <Button variant="primary" icon={CheckCircle2} loading={saving} disabled={saving || !canSave} onClick={saveDraft}>保存修改</Button> : isAccountingDraft ? <Button variant="primary" icon={CheckCircle2} loading={saving} disabled={saving || !canSave} onClick={confirmEntry}>保存商品</Button> : <><Button loading={saving} disabled={saving || !draft.name.trim()} onClick={saveDraft}>保存草稿</Button><Button variant="primary" icon={CheckCircle2} disabled={!canSave || saving} onClick={() => setConfirmDialog(true)}>确认进入工作台</Button></>}</div>
      </div>

      <div className="editor-grid">
        <Panel className="editor-basic-panel">
          <div className="section-heading"><h2>基本信息</h2>{prefill?.source === "erp" ? <Badge tone="info">ERP 来源 · {prefill.skuCount ?? draft.variants.length} 个 SKU</Badge> : null}</div>
          <div className="editor-basic-layout">
            <div className="product-gallery">
              <div className="main-product-image">{draft.imageUrl ? <img src={draft.imageUrl} alt={draft.name || "商品图片"} /> : <span className="catalog-image-placeholder"><Image size={28} aria-hidden="true" /><small>图片可后续补充</small></span>}</div>
              <div className="form-field image-url-field"><label htmlFor="product-image-url">商品图片链接</label><input id="product-image-url" aria-label="商品图片链接" className="text-input" value={draft.imageUrl ?? ""} onChange={event => updateDraft("imageUrl", event.target.value)} placeholder="https://..." /></div>
            </div>
            <div className="editor-basic-fields">
              <div className="form-field"><label className="required" htmlFor="product-name">商品名称</label><input id="product-name" aria-label="商品名称" aria-invalid={Boolean(issueText("product_name_required"))} aria-describedby={issueText("product_name_required") ? "product-name-error" : undefined} className="text-input" value={draft.name ?? ""} onChange={event => updateDraft("name", event.target.value)} />{showFieldIssue("product-name-error", "product_name_required")}
                {prefill?.titleCandidates?.length > 0 && prefill.needsTitleChoice && !draft.name ? <div className="title-candidates"><small>主体名称需要选择；可直接修改名称。</small>{prefill.titleCandidates.map(candidate => <button type="button" key={candidate.name} onClick={() => updateDraft("name", candidate.name)} title={(candidate.rawNames ?? []).join("；")}>{candidate.name}</button>)}</div> : null}
              </div>
              <div className="mapping-two-col">
                <div className="form-field"><label htmlFor="product-user-status">状态</label><select id="product-user-status" aria-label="商品状态" aria-describedby={statusChoiceRequired ? "product-status-conflict" : undefined} className="select-input" value={statusChoiceRequired ? "" : userStatus.statusId} onChange={event => updateDraft("productStatus", event.target.value)}>{statusChoiceRequired ? <option value="">请选择统一状态</option> : null}{statusOptions.map(status => <option value={status.id} key={status.id}>{status.label}{status.archivedAt ? "（已归档）" : ""}</option>)}</select>{statusChoiceRequired ? <small id="product-status-conflict" className="field-error">旧选品状态“{selectionStatusById(salesStatusDefinitions, userStatus.legacyStatuses.salesStatus).label}”与旧发布状态“{selectionStatusById(salesStatusDefinitions, userStatus.legacyStatuses.publicationStatus).label}”不一致，请选择一次。</small> : null}</div>
                <div className="form-field"><label htmlFor="product-tags">手工标签</label><input id="product-tags" aria-label="商品标签" className="text-input" value={tagsText} onChange={event => { setTagsText(event.target.value); setDraft(current => ({ ...current, fieldEdits: { ...current.fieldEdits, tags: true } })); }} placeholder="逗号分隔，例如：高潜、活动款" /></div>
              </div>
              <div className="mapping-two-col">
                <div className="form-field"><label htmlFor="product-platform-skc">平台 SKC</label><input id="product-platform-skc" aria-label="平台 SKC" aria-invalid={Boolean(issueText("platform_skc_required"))} aria-describedby={issueText("platform_skc_required") ? "product-skc-error" : undefined} className="text-input mono" value={draft.platformSkc ?? ""} onChange={event => updateDraft("platformSkc", event.target.value)} />{showFieldIssue("product-skc-error", "platform_skc_required")}</div>
                <div className="form-field"><label htmlFor="product-store">店铺来源</label><input id="product-store" aria-label="分配店铺" className="text-input" value={draft.store ?? ""} onChange={event => updateDraft("store", event.target.value)} placeholder="可后续补充" /></div>
              </div>
              <SelectionSalesTag item={draft.automaticSalesTag} />
              <details className="editor-secondary-details"><summary>备注与可见范围</summary><div className="form-field"><label htmlFor="product-notes">选品备注</label><textarea id="product-notes" aria-label="选品备注" className="text-area" rows="3" value={draft.notes ?? ""} onChange={event => updateDraft("notes", event.target.value)} /></div><div className="mapping-two-col"><div className="form-field"><label htmlFor="product-visibility">可见范围</label><select id="product-visibility" aria-label="商品可见范围" className="select-input" value={draft.visibility ?? "workspace"} onChange={event => updateDraft("visibility", event.target.value)}>{visibilityOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><div className="form-field"><label>归属账号</label><div className="field-readonly mono">{draft.ownerId || "当前账号"}</div></div></div></details>
            </div>
          </div>
        </Panel>

        <Panel className="variants-panel catalog-variants-panel">
          <div className="panel-header"><div className="panel-title"><h2>SKU 规格与成本</h2><span className="panel-subtitle">名称和明确的 SKC—SKU 关系即可保存；图片、售价及参考成本可后续补充。</span></div><Button variant="ghost" icon={Plus} onClick={() => setDraft(current => { const variant = createVariant(); return { ...current, variants: [...current.variants, variant], suppliers: syncSupplierVariantAdded(current.suppliers, variant) }; })}>添加规格</Button></div>
          {showFieldIssue("product-sku-error", "platform_sku_required")}
          {pendingNewVariants.length ? <div className="catalog-new-data"><span>新资料有 {pendingNewVariants.length} 个明确 SKU，可带入当前草稿。</span><Button variant="ghost" onClick={addNewCatalogData}>带入新增资料</Button></div> : null}
          {unresolvedConflicts.length ? <div className="identity-conflicts" role="alert">{unresolvedConflicts.map((conflict, index) => <div key={`${conflict.platformSku}-${index}`}><span><strong className="mono">{conflict.platformSku}</strong> · {({ relationship_conflict: "SKC 与仓库映射存在冲突", owned_elsewhere: "已属于其他商品档案" })[conflict.reason] || conflict.reason || "身份关系存在冲突"}{conflict.productId ? <a href={`/products/edit?product=${encodeURIComponent(conflict.productId)}`}>查看对应档案</a> : null}</span><Button variant="ghost" onClick={() => excludeConflict(conflict)}>排除此冲突分支</Button></div>)}</div> : null}
          {draft.excludedIdentitySkus?.length ? <p className="editor-inline-note">已明确排除 {draft.excludedIdentitySkus.join("、")}；冲突线索会保留供后续补充。</p> : null}
          <div className="table-wrap" tabIndex="0" aria-label="SKU 规格与成本表，可横向滚动">
            <table className="data-table variants-table catalog-variants-table">
              <thead><tr><th>平台属性 / 规格</th><th>平台 SKU</th><th>参考单件成本</th><th>当前售价</th><th>参考单件利润</th><th>详情</th><th>操作</th></tr></thead>
              <tbody>{draft.variants.length === 0 ? <tr><td className="pending-text" colSpan="7">尚未添加平台 SKU 分支</td></tr> : draft.variants.map((variant, index) => {
                const platformSku = String(variant.platformSku ?? "").trim();
                const reference = draftReferences[index] ?? {};
                const referenceRow = reference.historical;
                const cost = reference.unitCost;
                const salePrice = productSalePrice(variant.salePrice);
                const profit = salePrice != null && cost != null ? salePrice - cost - 0.7 : null;
                const skuIssue = issueText(`variant_${index}_platform_sku_duplicate`) || saveFieldErrors[canonicalPlatformSku(platformSku)];
                return <tr key={variant.id ?? index}>
                  <td><input aria-label={`第 ${index + 1} 个规格名称`} className="table-input catalog-text-input" value={variant.attribute ?? ""} onChange={event => updateVariant(index, "attribute", event.target.value)} placeholder="颜色 / 尺寸" /></td>
                  <td><input id={`variant-${index}-sku`} aria-label={`第 ${index + 1} 个平台 SKU`} aria-invalid={Boolean(skuIssue)} aria-describedby={skuIssue ? `variant-${index}-sku-error` : undefined} className="table-input catalog-sku-input mono" value={variant.platformSku ?? ""} onChange={event => updateVariant(index, "platformSku", event.target.value)} />{skuIssue ? <small className="field-error" id={`variant-${index}-sku-error`}>{skuIssue}</small> : null}</td>
                  <td><div className="catalog-cost-cell"><strong className="mono">{cost == null ? "待补" : `¥${Number(cost).toFixed(reference.referenceKind?.startsWith("erp") ? 4 : 2)}`}</strong>{cost != null ? <small className="row-subtitle" title={referenceRow?.referenceNote}>{reference.sourceLabel}</small> : null}{reference.historical && reference.supplier ? <small>当前 1688 报价 ¥{reference.supplier.unitCost.toFixed(2)}</small> : null}{currentProductId && platformSku ? <button type="button" className="catalog-cost-edit" title="确认人工成本" aria-label={`确认 ${platformSku} 的人工成本`} onClick={() => openManualCostDialog(variant, cost)}><Pencil size={13} /></button> : null}</div></td>
                  <td><input aria-label={`第 ${index + 1} 个售价`} className="table-input mono" type="number" min="0" step="0.01" value={variant.salePrice ?? ""} onChange={event => updateVariant(index, "salePrice", event.target.value)} /></td>
                  <td className={`mono ${profit != null && profit < 0 ? "danger-text" : ""}`}>{salePrice == null ? "待填写售价" : profit == null ? "待参考成本" : `¥${profit.toFixed(2)}`}</td>
                  <td><details className="sku-details"><summary>查看 / 编辑</summary><div className="sku-detail-fields">{[["warehouseSku", "ERP 仓库 SKU"], ["sourceSku", "1688 来源 SKU"], ["imageUrl", "SKU 图片链接"]].map(([field, label]) => <label className="form-field" key={field}><span>{label}</span><input aria-label={`第 ${index + 1} 个 ${label}`} className="text-input" value={variant[field] ?? ""} onChange={event => updateVariant(index, field, event.target.value)} /></label>)}{variant.purchaseSpecification ? <p>采购规格：{variant.purchaseSpecification}</p> : null}{referenceRow?.referenceEvidence?.unitConversion ? <p>采购单位换算：{referenceRow.referenceEvidence.unitConversion.warehouseUnits} 个仓库单位对应 {referenceRow.referenceEvidence.unitConversion.platformUnits} 个平台单品</p> : null}<div className="sku-quote-fields">{[["purchaseUnitPrice", "采购价", "0.01", "0"], ["purchasePackCount", "采购份数", "1", "0"], ["unitsPerPack", "每份单品数", "1", "1"]].map(([field, label, step, min]) => <label className="form-field" key={field}><span>{label}</span><input aria-label={`第 ${index + 1} 个${label}`} className="table-input mono" type="number" min={min} step={step} value={variant[field] ?? ""} onChange={event => updateVariant(index, field, event.target.value)} />{showFieldIssue(`variant-${index}-${field}-error`, `variant_${index}_${field === "purchasePackCount" ? "purchase_pack_count_invalid" : "units_per_pack_invalid"}`)}</label>)}</div><small>报价只在主动修改时更新；采购规格与平台属性分别保留。</small></div></details></td>
                  <td><button type="button" className="variant-remove" aria-label={`删除第 ${index + 1} 个规格`} onClick={() => removeVariant(index)}><Trash2 size={16} /></button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <p className="editor-inline-note">参考成本覆盖 {referenceCostCount}/{draft.variants.length} 个 SKU。ERP 与 1688 来源各自保留；本页保存不会写入月度正式利润。</p>
        </Panel>

        <Panel className="supplier-list-panel">
          <div className="panel-header"><div className="panel-title"><h2>供应商来源</h2><span className="panel-subtitle">每个供应商保留自己的链接和 SKU 关联</span></div><Button variant="ghost" icon={Plus} onClick={addSupplier}>添加供应商</Button></div>
          <div className="editor-supplier-grid">{supplierRows.map((supplier, index) => <div className="supplier-card" key={supplier.id ?? index}>
            <div className="supplier-card-heading"><strong>{supplier.supplierName || `供应商 ${index + 1}`}</strong><span>{supplier.sourceUrl ? <a className="inline-link" href={supplier.sourceUrl} target="_blank" rel="noreferrer">打开来源<ExternalLink size={14} /></a> : null}{index > 0 ? <button type="button" className="icon-button danger" aria-label={`删除供应商 ${index + 1}`} onClick={() => removeSupplier(index)}><Trash2 size={16} /></button> : null}</span></div>
            <div className="form-field"><label htmlFor={`supplier-${index}-name`}>供应商名称</label><input id={`supplier-${index}-name`} aria-label={index === 0 ? "供应商名称" : `供应商 ${index + 1} 名称`} className="text-input" value={supplier.supplierName ?? ""} onChange={event => index === 0 ? updateDraft("supplierName", event.target.value) : updateSupplier(index, "supplierName", event.target.value)} /></div>
            <div className="form-field"><label htmlFor={`supplier-${index}-url`}>1688 来源链接</label><input id={`supplier-${index}-url`} aria-label={index === 0 ? "1688 来源链接" : `供应商 ${index + 1} 来源链接`} className="text-input" value={supplier.sourceUrl ?? ""} onChange={event => index === 0 ? updateDraft("sourceUrl", event.target.value) : updateSupplier(index, "sourceUrl", event.target.value)} placeholder="可后续补充" /></div>
            <small className="supplier-associated-skus">{(supplier.variants ?? []).map(variant => variant.platformSku).filter(Boolean).join(" · ") || "保存后可补充 SKU 关联"}</small>
            {index > 0 ? <details className="editor-secondary-details"><summary>参考报价与单位换算</summary><div className="supplier-sku-grid supplier-sku-grid-detailed">{draft.variants.map(variant => { const offer = supplier.variants?.find(item => canonicalPlatformSku(item.platformSku) === canonicalPlatformSku(variant.platformSku)) ?? {}; return <div className="supplier-sku-row" key={variant.platformSku || variant.id}><span className="mono">{variant.platformSku || "未填写 SKU"}</span>{[["purchaseUnitPrice", "采购价", "0.01", "0"], ["purchasePackCount", "采购份数", "1", "0"], ["unitsPerPack", "每份单品数", "1", "1"]].map(([field, label, step, min]) => <label className="supplier-quote-field" key={field}><span>{label}</span><input aria-label={`${supplier.supplierName || "供应商"} ${variant.platformSku || "SKU"} ${label}`} className="table-input mono" type="number" min={min} step={step} value={offer[field] ?? (field === "unitsPerPack" ? 1 : "")} onChange={event => updateSupplierVariant(index, variant.platformSku, field, event.target.value)} /></label>)}</div>; })}</div></details> : null}
          </div>)}</div>
        </Panel>

        {prefill?.source === "erp" || prefill?.warnings?.length || currentProductId && draft.platformSkc ? <Panel className="erp-catalog-prefill"><details><summary>ERP 档案资料与来源详情</summary>
          <div className="catalog-request-controls"><label className="form-field"><span>资料采购截止月份</span><input aria-label="资料采购截止月份" className="text-input" type="month" value={catalogRequestPeriod} onChange={event => setCatalogRequestPeriod(event.target.value)} /></label><Button variant="ghost" loading={requestingCatalog} disabled={requestingCatalog || !draft.platformSkc || !catalogRequestPeriod || !missingCatalogGroups.length} onClick={requestCatalog}>{catalogRequestFailed ? "重试补充资料" : "补充 ERP 资料"}</Button></div>
          {!catalogRequestPeriod ? <p className="editor-inline-note">请选择明确的采购截止月份；没有销量也可以为已确认身份的档案补充资料。</p> : null}
          {!missingCatalogGroups.length ? <p className="editor-inline-note">资料已收齐。</p> : null}
          {catalogRequestMessage ? <p className={`editor-inline-note ${catalogRequestFailed ? "field-error" : ""}`} role="status">{catalogRequestMessage}</p> : null}
          {(prefill.warnings ?? []).map(warning => <p className="erp-catalog-warning" key={warning}><AlertCircle size={15} />{warning}</p>)}
          <ul className="erp-catalog-evidence">{(prefill.sources ?? []).map((item, index) => <li key={index}><strong className="mono">{item.platformSku}</strong><span>{item.platformSkc} · {item.attribute || "平台属性未提供"} · {item.productName || "原始名称未提供"}</span>{item.trusted === false ? <span>身份关系待核对</span> : null}</li>)}</ul>
          <ul className="erp-catalog-evidence erp-purchase-evidence">{(prefill.purchases ?? []).map((item, index) => { const purchase = item.purchaseCatalog ?? {}; return <li key={index}><strong>{item.supplierName || "供应商未提供"} · {item.source?.purchaseOrderNo || item.source?.recordId || "采购明细"}</strong><span className="mono">仓库 {item.warehouseSku} · {(item.platformSkus ?? []).join("、")}</span><span>采购规格：{purchase.purchaseSpecificationAndModel1688 || "未提供"}</span>{purchase.purchaseProportion1688 ? <span>单位换算：{purchase.purchaseProportion1688.replace(/^(\d+)-(\d+)$/, "$1:$2")}</span> : null}{purchase.pictureLink1688 ? <a href={purchase.pictureLink1688} target="_blank" rel="noreferrer">采购图片<ExternalLink size={12} /></a> : null}</li>; })}</ul>
        </details></Panel> : null}
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
