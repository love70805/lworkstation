import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, BarChart3, CheckCircle2, Copy, Download, ExternalLink, GitMerge, Image, Inbox, Pencil, Plus, Search, Settings2, Tag, Trash2, WalletCards, Warehouse, X } from "lucide-react";
import AppShell from "../components/AppShell";
import DataTable from "../components/DataTable";
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, useToast } from "../components/UI";
import { bulkUpdateProductCatalogSalesStatus, getSelectionReferenceSnapshot, getSelectionStatusDefinitions, listPendingCaptureRecords, listProductCatalogRecords, mergeProductSkcRecords, previewProductSkcMerge, saveSelectionStatusDefinitions } from "../data/database";
import { exportWorkbook } from "../lib/spreadsheetExport";
import { buildSelectionReferenceRows, groupSelectionReferenceRows } from "../lib/selectionReferences";
import { matchesSelectionSearch } from "../lib/selectionSearch";
import { CaptureQueueContent } from "./CaptureQueue";
import { activeSelectionStatusDefinitions, createCustomSelectionStatus, selectionStatusById } from "../domain/selectionStatuses";
import { canonicalPlatformSkc } from "../domain/identifiers";
import { PRODUCT_PUBLICATION_STATUSES, productPublicationStatusById } from "../domain/productPublication";

const money = (value) => Number(value ?? 0).toLocaleString("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 });
const percent = (value) => value == null ? "--" : `${Number(value).toFixed(1)}%`;
const shortDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : null;
};

const referenceSourceLabels = {
  erp_history: "ERP 历史",
  manual_confirmed: "人工确认",
  finalized_profit_history: "定稿历史",
  supplier_landed: "1688 参考",
};

const catalogSourceLabels = {
  erp: "ERP",
  manual_confirmed: "人工确认",
  finalized_profit_history: "定稿历史",
  supplier_landed: "1688 参考",
};

const dataStatusLabels = {
  complete: "完整",
  partial: "部分覆盖",
  missing: "暂无",
};

const PRODUCT_FILTERS_KEY = "shopeers-product-library-filters-v1";

function readProductFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRODUCT_FILTERS_KEY) ?? "{}");
    return {
      store: saved.store ?? "all",
      status: saved.status ?? "all",
      publicationStatus: saved.publicationStatus ?? "all",
      dataStatus: saved.dataStatus ?? "all",
      missingOnly: Boolean(saved.missingOnly),
      duplicatesOnly: Boolean(saved.duplicatesOnly),
      productSort: saved.productSort === "cost" ? "lowestCost" : saved.productSort ?? "updated",
      referenceSource: saved.referenceSource ?? "all",
      negativeOnly: Boolean(saved.negativeOnly),
    };
  } catch {
    return { store: "all", status: "all", publicationStatus: "all", dataStatus: "all", missingOnly: false, duplicatesOnly: false, productSort: "updated", referenceSource: "all", negativeOnly: false };
  }
}

function ProductThumb({ product }) {
  if (product.image) return <img className="product-thumb" src={product.image} alt="" />;
  return <span className={`product-thumb product-placeholder ${product.status === "inactive" ? "danger" : ""}`}>{product.status === "inactive" ? <AlertCircle size={20} /> : <Image size={20} />}</span>;
}

function formatUpdatedAt(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function SelectionDomainSearch({ value, onChange, label }) {
  return (
    <div className="selection-domain-search">
      <Search size={17} aria-hidden="true" />
      <input
        aria-label={label}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="搜索商品名、平台 SKC/SKU、仓库 SKU 或供应商"
      />
      {value ? <button type="button" aria-label="清除搜索" title="清除搜索" onClick={() => onChange("")}><X size={16} /></button> : null}
    </div>
  );
}

export default function ProductLibrary() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { notify } = useToast();
  const initialFilters = useMemo(readProductFilters, []);
  const [query, setQuery] = useState("");
  const [store, setStore] = useState(initialFilters.store);
  const [status, setStatus] = useState(initialFilters.status);
  const [publicationStatus, setPublicationStatus] = useState(initialFilters.publicationStatus);
  const [dataStatus, setDataStatus] = useState(initialFilters.dataStatus);
  const [missingOnly, setMissingOnly] = useState(initialFilters.missingOnly);
  const [duplicatesOnly, setDuplicatesOnly] = useState(initialFilters.duplicatesOnly);
  const [productSort, setProductSort] = useState(initialFilters.productSort);
  const [referenceSource, setReferenceSource] = useState(initialFilters.referenceSource);
  const [negativeOnly, setNegativeOnly] = useState(initialFilters.negativeOnly);
  const [exporting, setExporting] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [updatingBulkStatus, setUpdatingBulkStatus] = useState(false);
  const [statusManagerOpen, setStatusManagerOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState([]);
  const [newStatusLabel, setNewStatusLabel] = useState("");
  const [newStatusTone, setNewStatusTone] = useState("neutral");
  const [savingStatusDefinitions, setSavingStatusDefinitions] = useState(false);
  const [mergeManagerOpen, setMergeManagerOpen] = useState(false);
  const [mergeSkc, setMergeSkc] = useState("");
  const [mergePrimaryId, setMergePrimaryId] = useState("");
  const [mergePreview, setMergePreview] = useState(null);
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [mergingSkcRecords, setMergingSkcRecords] = useState(false);
  const requestedView = searchParams.get("view");
  const view = requestedView === "reference" ? "reference" : requestedView === "pending" ? "pending" : "official";
  const catalogProducts = useLiveQuery(listProductCatalogRecords, [], []);
  const pendingCaptures = useLiveQuery(listPendingCaptureRecords, [], []);
  const salesStatusDefinitions = useLiveQuery(getSelectionStatusDefinitions, [], []);
  const activeSalesStatuses = useMemo(() => activeSelectionStatusDefinitions(salesStatusDefinitions), [salesStatusDefinitions]);
  const pendingCount = pendingCaptures.length;
  const missingProductCount = catalogProducts.filter((product) => product.dataReadiness?.hasGaps || product.skuCount === 0).length;
  const duplicateSkcGroups = useMemo(() => {
    const groups = new Map();
    catalogProducts.forEach((product) => {
      const platformSkc = String(product.platformSkc ?? "").trim();
      if (!platformSkc) return;
      const canonical = canonicalPlatformSkc(platformSkc);
      if (!canonical) return;
      const current = groups.get(canonical) ?? [];
      current.push(product);
      groups.set(canonical, current);
    });
    return [...groups.values()].filter((group) => group.length > 1);
  }, [catalogProducts]);
  const duplicateSkcProductIds = useMemo(() => new Set(duplicateSkcGroups.flatMap((group) => group.map((product) => product.id))), [duplicateSkcGroups]);
  const duplicateSkcCountByProductId = useMemo(() => new Map(duplicateSkcGroups.flatMap((group) => group.map((product) => [product.id, group.length]))), [duplicateSkcGroups]);
  const selectedMergeGroup = useMemo(() => duplicateSkcGroups.find((group) => canonicalPlatformSkc(group[0]?.platformSkc) === mergeSkc) ?? [], [duplicateSkcGroups, mergeSkc]);
  const mergeSourceIds = useMemo(() => selectedMergeGroup.filter((product) => product.id !== mergePrimaryId).map((product) => product.id), [mergePrimaryId, selectedMergeGroup]);
  const referenceRows = useLiveQuery(async () => (
    buildSelectionReferenceRows(await getSelectionReferenceSnapshot())
  ), [], []);

  useEffect(() => {
    localStorage.setItem(PRODUCT_FILTERS_KEY, JSON.stringify({
      store,
      status,
      publicationStatus,
      dataStatus,
      missingOnly,
      duplicatesOnly,
      productSort,
      referenceSource,
      negativeOnly,
    }));
  }, [dataStatus, duplicatesOnly, missingOnly, negativeOnly, productSort, publicationStatus, referenceSource, status, store]);

  useEffect(() => {
    if (statusManagerOpen) setStatusDraft(salesStatusDefinitions);
  }, [salesStatusDefinitions, statusManagerOpen]);

  const changeView = (nextView) => {
    // The reference view is query-driven; clearing the query falls back to the official catalog.
    const params = nextView === "official" ? {} : { view: nextView };
    setSearchParams(params, { replace: true });
  };

  const filteredProducts = useMemo(() => catalogProducts.filter((product) => {
    const supplierSearch = (product.supplierProfiles ?? []).flatMap((supplier) => [supplier.supplierCode, supplier.supplierName]);
    const matchesQuery = matchesSelectionSearch(query, [
      product.name,
      product.supplier,
      product.platformSkc,
      supplierSearch,
      product.skus.map((sku) => [sku.platformSku, sku.warehouseSku]),
    ]);
    const matchesStore = store === "all" || product.store === store;
    const matchesStatus = status === "all" || product.salesStatus === status || product.status === status;
    const matchesPublication = publicationStatus === "all" || product.publicationStatus === publicationStatus;
    const matchesData = dataStatus === "all"
      || (dataStatus === "missing_purchase" && product.dataReadiness?.purchase.status !== "complete")
      || (dataStatus === "missing_profit" && product.dataReadiness?.profit.status !== "complete")
      || (dataStatus === "missing_mapping" && product.dataReadiness?.warehouseMapping.status !== "complete")
      || (dataStatus === "erp_complete" && product.dataReadiness?.purchase.status === "complete")
      || (dataStatus === "profit_complete" && product.dataReadiness?.profit.status === "complete")
      || (dataStatus === "mapping_complete" && product.dataReadiness?.warehouseMapping.status === "complete");
    const matchesMissing = !missingOnly || product.skuCount === 0 || product.dataReadiness?.hasGaps;
    const matchesDuplicate = !duplicatesOnly || duplicateSkcProductIds.has(product.id);
    return matchesQuery && matchesStore && matchesStatus && matchesPublication && matchesData && matchesMissing && matchesDuplicate;
  }).toSorted((a, b) => {
    if (productSort === "lowestCost") return (a.lowestReferenceCost ?? Number.POSITIVE_INFINITY) - (b.lowestReferenceCost ?? Number.POSITIVE_INFINITY);
    if (productSort === "coverage") {
      const coverage = (product) => product.referenceCostCoverage?.totalSkuCount
        ? product.referenceCostCoverage.coveredSkuCount / product.referenceCostCoverage.totalSkuCount
        : -1;
      return coverage(b) - coverage(a) || (a.referenceCostCoverage?.missingSkuCount ?? 0) - (b.referenceCostCoverage?.missingSkuCount ?? 0);
    }
    if (productSort === "name") return a.name.localeCompare(b.name, "zh-CN");
    return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
  }), [catalogProducts, dataStatus, duplicateSkcProductIds, duplicatesOnly, missingOnly, productSort, publicationStatus, query, status, store]);
  const filteredProductIds = useMemo(() => filteredProducts.map((product) => product.id), [filteredProducts]);
  const selectedProductIdSet = useMemo(() => new Set(selectedProductIds), [selectedProductIds]);
  const allFilteredSelected = filteredProductIds.length > 0 && filteredProductIds.every((id) => selectedProductIdSet.has(id));

  const filteredReferences = useMemo(() => referenceRows.filter((row) => {
    return matchesSelectionSearch(query, [row.platformSku, row.platformSkc, row.productName, row.warehouseSku, row.supplierCode, row.supplierName])
      && (referenceSource === "all" || row.referenceKind === referenceSource)
      && (!negativeOnly || row.hasNegativeProfit);
  }), [negativeOnly, query, referenceRows, referenceSource]);
  const groupedReferences = useMemo(() => groupSelectionReferenceRows(filteredReferences), [filteredReferences]);

  const statusLabel = { active: "启用", draft: "草稿", inactive: "停用" };
  const resolveSalesStatus = (value) => selectionStatusById(salesStatusDefinitions, value);
  const salesStatusLabel = (value) => resolveSalesStatus(value)?.label ?? "未设置";
  useEffect(() => {
    setSelectedProductIds((current) => current.filter((id) => filteredProductIds.includes(id)));
  }, [filteredProductIds]);

  const toggleProductSelection = (productId) => {
    setSelectedProductIds((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  };
  const toggleFilteredProductSelection = () => {
    setSelectedProductIds(allFilteredSelected ? [] : filteredProductIds);
  };
  const copyProductIdentity = async (product) => {
    const text = [product.platformSkc, ...product.skus.map((sku) => sku.platformSku)].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      notify(`已复制 ${product.platformSkc || product.name} 的 SKC 与平台 SKU。`, "success");
    } catch {
      notify("浏览器未授权写入剪贴板，请稍后重试。", "error");
    }
  };
  const productColumns = useMemo(() => [
    {
      id: "selection",
      header: <input className="row-select-input" type="checkbox" aria-label="全选当前筛选结果" checked={allFilteredSelected} onChange={toggleFilteredProductSelection} onClick={(event) => event.stopPropagation()} />,
      enableSorting: false,
      cell: ({ row }) => <input className="row-select-input" type="checkbox" aria-label={`选择 ${row.original.name}`} checked={selectedProductIdSet.has(row.original.id)} onChange={() => toggleProductSelection(row.original.id)} onClick={(event) => event.stopPropagation()} />,
      meta: { headerStyle: { width: 48 }, cellStyle: { width: 48 } },
    },
    { id: "image", header: "商品图", enableSorting: false, cell: ({ row }) => <ProductThumb product={row.original} />, meta: { headerStyle: { width: 68 } } },
    {
      accessorKey: "name",
      header: "SKC 商品档案",
      cell: ({ row }) => <div className="product-name-cell product-skc-cell">
        <strong className="truncate-name">{row.original.name || "未命名商品"}</strong>
        <span className="product-skc-identity"><strong className="mono">{row.original.platformSkc || "未填写 SKC"}</strong><button type="button" title="复制 SKC 与平台 SKU" aria-label={`复制 ${row.original.name} 的 SKC 与平台 SKU`} onClick={(event) => { event.stopPropagation(); copyProductIdentity(row.original); }}><Copy size={13} /></button></span>
        <span className="product-publication-line"><Badge>{row.original.salesPlatform || "未设平台"}</Badge><Badge tone={productPublicationStatusById(row.original.publicationStatus).tone}>{productPublicationStatusById(row.original.publicationStatus).label}</Badge></span>
        {row.original.tags?.length || duplicateSkcCountByProductId.has(row.original.id) ? <span className="product-tag-list">{duplicateSkcCountByProductId.has(row.original.id) ? <small className="product-conflict-tag">重复 SKC · {duplicateSkcCountByProductId.get(row.original.id)} 份档案</small> : null}{(row.original.tags ?? []).slice(0, 3).map((tag) => <small key={tag}>{tag}</small>)}</span> : null}
        {row.original.skuCount === 0 ? <span className="missing-sku"><AlertCircle size={12} />{row.original.pendingVariantCount ? `待分配平台 SKU · ${row.original.pendingVariantCount} 个属性分支` : "缺少平台 SKU"}</span> : <span className="product-sku-branches">{row.original.skuReferences.map((sku) => <span className="product-sku-branch" key={sku.id ?? sku.platformSku}><strong className="mono">{sku.platformSku}</strong><small>{sku.attribute || "未填写属性"}</small></span>)}</span>}
      </div>,
    },
    {
      id: "suppliers",
      header: "供应商与 1688 来源",
      enableSorting: false,
      cell: ({ row }) => {
        const suppliers = row.original.supplierProfiles ?? row.original.offers ?? [];
        return suppliers.length ? <div className="product-supplier-stack">{suppliers.map((offer) => <span className="product-supplier-line" key={`${offer.id ?? offer.supplierCode}-${offer.sourceUrl ?? ""}`}><span><strong>{offer.supplierCode || offer.supplierName || "未填写供应商"}</strong><small>{offer.supplierName && offer.supplierCode ? offer.supplierName : "1688 供应商"}</small></span>{offer.sourceUrl ? <a href={offer.sourceUrl} target="_blank" rel="noreferrer" title="打开 1688 来源" aria-label={`打开 ${offer.supplierCode || offer.supplierName || row.original.name} 的 1688 来源`} onClick={(event) => event.stopPropagation()}><ExternalLink size={14} /></a> : null}</span>)}</div> : <span className="pending-text">待补供应商</span>;
      },
    },
    {
      id: "warehouseSku",
      header: "ERP 仓库 SKU",
      enableSorting: false,
      cell: ({ row }) => row.original.skuCount === 0 ? <span className="pending-text">--</span> : <span className="product-warehouse-stack">{row.original.skuReferences.map((sku) => <span className="product-warehouse-line" key={sku.id ?? sku.platformSku}>{sku.warehouseSku ? <><Warehouse size={14} /><strong className="mono">{sku.warehouseSku}</strong></> : <Badge tone="warning">待映射</Badge>}</span>)}</span>,
    },
    { accessorKey: "cost", header: "SKU 参考成本", cell: ({ row }) => row.original.skuCount === 0 ? <span className="pending-text">--</span> : <span className="product-cost-stack">{row.original.skuReferences.map((sku) => <span className="product-cost-line" key={sku.id ?? sku.platformSku}>{sku.unitCost == null ? <Badge tone="warning">待补</Badge> : <><strong className="mono money-cell">{money(sku.unitCost)}</strong><Badge tone={sku.source === "erp" ? "success" : sku.source === "manual_confirmed" ? "info" : "neutral"}>{catalogSourceLabels[sku.source] ?? "参考"}</Badge></>}</span>)}</span> },
    { accessorKey: "salePrice", header: "SKU 售价", cell: ({ row }) => row.original.skuCount === 0 ? <span className="pending-text">--</span> : <span className="product-price-stack">{row.original.skuReferences.map((sku) => <span className="product-price-line mono" key={sku.id ?? sku.platformSku}>{sku.salePrice == null ? "待填写" : money(sku.salePrice)}</span>)}</span> },
    { id: "referenceProfit", header: "参考单件利润", enableSorting: false, cell: ({ row }) => row.original.skuCount === 0 ? <span className="pending-text">--</span> : <span className="product-profit-stack">{row.original.skuReferences.map((sku) => <span className={`product-profit-line ${sku.referenceUnitProfit == null ? "" : sku.referenceUnitProfit < 0 ? "danger-text" : "success-text"}`} key={sku.id ?? sku.platformSku}>{sku.referenceUnitProfit == null ? <span className="pending-text">待成本/售价</span> : <><strong className="mono">{money(sku.referenceUnitProfit)}</strong><small>{percent(sku.referenceProfitRate)}</small></>}</span>)}</span> },
    { accessorKey: "store", header: "店铺", cell: ({ getValue }) => <Badge>{getValue()}</Badge> },
    { accessorKey: "salesStatus", header: "选品状态", cell: ({ getValue }) => { const definition = resolveSalesStatus(getValue()); return <Badge tone={definition?.tone ?? "neutral"} dot>{definition?.label ?? "未设置"}</Badge>; } },
    { id: "dataReadiness", header: "经营数据", enableSorting: false, cell: ({ row }) => <span className="product-data-stack"><small>采购 <Badge tone={row.original.dataReadiness?.purchase.status === "complete" ? "success" : row.original.dataReadiness?.purchase.status === "partial" ? "warning" : "neutral"}>{dataStatusLabels[row.original.dataReadiness?.purchase.status] ?? "暂无"}</Badge></small><small>利润 <Badge tone={row.original.dataReadiness?.profit.status === "complete" ? "success" : row.original.dataReadiness?.profit.status === "partial" ? "warning" : "neutral"}>{dataStatusLabels[row.original.dataReadiness?.profit.status] ?? "暂无"}</Badge></small><small>映射 <Badge tone={row.original.dataReadiness?.warehouseMapping.status === "complete" ? "success" : row.original.dataReadiness?.warehouseMapping.status === "partial" ? "warning" : "neutral"}>{dataStatusLabels[row.original.dataReadiness?.warehouseMapping.status] ?? "暂无"}</Badge></small></span> },
    { accessorKey: "updatedAt", header: "最后更新", cell: ({ getValue }) => <span className="mono">{formatUpdatedAt(getValue())}</span> },
  ], [allFilteredSelected, duplicateSkcCountByProductId, notify, salesStatusDefinitions, selectedProductIdSet]);

  const referenceColumns = useMemo(() => [
    {
      accessorKey: "platformSku",
      header: "平台 SKC / SKU",
      enableSorting: false,
      cell: ({ row }) => <span className="selection-sku"><strong className="mono">{row.original.platformSkc}</strong><small>{row.original.skuCount} 个 SKU · {row.original.productName}</small><span className="selection-variant-stack">{row.original.variants.map((variant) => <span className="selection-variant-line" key={variant.canonicalPlatformSku}><strong className="mono">{variant.platformSku}</strong><small>{variant.attribute || "未提供属性"}</small></span>)}</span></span>,
    },
    {
      accessorKey: "referenceUnitCost",
      header: "当前参考成本",
      enableSorting: false,
      cell: ({ row }) => <span className="selection-variant-stack align-right">{row.original.variants.map((variant) => variant.referenceUnitCost == null ? <span className="selection-variant-line" key={variant.canonicalPlatformSku}><Badge tone="danger">缺失</Badge></span> : <span className="selection-variant-line" key={variant.canonicalPlatformSku}><strong className="mono">{money(variant.referenceUnitCost)}</strong><span title={variant.referenceNote ?? undefined}><Badge tone={variant.authoritativeSource === "erp" ? "success" : "neutral"}>{referenceSourceLabels[variant.referenceKind] ?? "参考"}</Badge>{variant.referenceKind === "manual_confirmed" ? <small className="row-subtitle">{shortDate(variant.referenceUpdatedAt) ? `确认于 ${shortDate(variant.referenceUpdatedAt)}` : "已确认"}{variant.manualCostHistoryCount > 1 ? ` · ${variant.manualCostHistoryCount} 条记录` : ""}</small> : null}</span></span>)}</span>,
      meta: { cellStyle: { textAlign: "right" } },
    },
    {
      accessorKey: "latestPeriod",
      header: "最近定稿月",
      enableSorting: false,
      cell: ({ row }) => <span className="selection-variant-stack">{row.original.variants.map((variant) => variant.latestPeriod ? <span className="selection-variant-line" key={variant.canonicalPlatformSku}><strong className="mono">{variant.latestPeriod}</strong><small className="row-subtitle">销量 {variant.latestQuantity.toLocaleString("zh-CN")}</small></span> : <span className="selection-variant-line" key={variant.canonicalPlatformSku}><span className="pending-text">暂无定稿</span></span>)}</span>,
    },
    {
      accessorKey: "recentRevenue",
      header: "近三月经营",
      enableSorting: false,
      cell: ({ row }) => <span className="selection-variant-stack align-right">{row.original.variants.map((variant) => <span className="selection-variant-line" key={variant.canonicalPlatformSku}><strong className="mono">{money(variant.recentRevenue)}</strong><small className="row-subtitle">{variant.recentMonthCount} 个月 · {variant.recentQuantity.toLocaleString("zh-CN")} 件</small></span>)}</span>,
      meta: { cellStyle: { textAlign: "right" } },
    },
    {
      accessorKey: "latestProfit",
      header: "最近实际利润",
      enableSorting: false,
      cell: ({ row }) => <span className="selection-variant-stack align-right">{row.original.variants.map((variant) => variant.latestProfit == null ? <span className="selection-variant-line" key={variant.canonicalPlatformSku}><span className="pending-text">--</span></span> : <span className={`selection-variant-line ${variant.latestProfit < 0 ? "danger-text" : "success-text"}`} key={variant.canonicalPlatformSku}><strong className="mono">{money(variant.latestProfit)}</strong><small className="row-subtitle">利润率 {percent(variant.latestProfitRate)}</small></span>)}</span>,
      meta: { cellStyle: { textAlign: "right" } },
    },
    {
      accessorKey: "referenceUnitProfit",
      header: "单件参考利润",
      enableSorting: false,
      cell: ({ row }) => <span className="selection-variant-stack align-right">{row.original.variants.map((variant) => variant.referenceUnitProfit == null ? <span className="selection-variant-line" key={variant.canonicalPlatformSku}><span className="pending-text">缺少售价历史</span></span> : <span className={`selection-variant-line ${variant.referenceUnitProfit < 0 ? "danger-text" : "success-text"}`} key={variant.canonicalPlatformSku}><strong className="mono">{money(variant.referenceUnitProfit)}</strong><small className="row-subtitle">参考利润率 {percent(variant.referenceProfitRate)}</small></span>)}</span>,
      meta: { cellStyle: { textAlign: "right" } },
    },
    {
      id: "referenceStatus",
      header: "参考状态",
      enableSorting: false,
      cell: ({ row }) => <span className="selection-variant-stack">{row.original.variants.map((variant) => <span className="selection-variant-line" key={variant.canonicalPlatformSku}>{variant.referenceUnitCost == null ? <Badge tone="danger"><AlertCircle size={12} />缺参考成本</Badge> : variant.averageSalePrice == null ? <Badge>等待售价历史</Badge> : variant.hasNegativeProfit ? <Badge tone="danger"><AlertCircle size={12} />出现负利润</Badge> : <Badge tone="success">可用于选品参考</Badge>}</span>)}</span>,
    },
    {
      id: "catalogAction",
      header: "商品档案",
      enableSorting: false,
      cell: ({ row }) => {
        const target = row.original.productId
          ? `/products/edit?product=${encodeURIComponent(row.original.productId)}`
          : `/products/edit?skc=${encodeURIComponent(row.original.platformSkc ?? "")}&sku=${encodeURIComponent(row.original.platformSku ?? "")}&name=${encodeURIComponent(row.original.productName ?? "")}`;
        return <Button variant="ghost" icon={Pencil} onClick={(event) => { event.stopPropagation(); navigate(target); }}>{row.original.productId ? "编辑档案" : "建立档案"}</Button>;
      },
    },
  ], []);

  const exportProducts = async (products) => {
    const exportRows = Array.isArray(products) ? products : filteredProducts;
    setExporting(true);
    try {
      await exportWorkbook(exportRows.map((product) => ({
        商品ID: product.id,
        商品名称: product.name,
        平台SKC: product.platformSkc,
        平台SKU数量: product.skuCount,
        平台SKU: product.skus.map((sku) => sku.platformSku).join(", "),
        ERP仓库SKU映射: product.skuReferences.map((sku) => `${sku.platformSku || "未填写SKU"}=${sku.warehouseSku || "待映射"}`).join("；"),
        供应商编号: product.supplier,
        SKU参考成本明细: product.skuReferences.map((sku) => sku.unitCost == null ? `${sku.platformSku || "未填写SKU"}=待补` : `${sku.platformSku || "未填写SKU"}=${sku.unitCost}（${catalogSourceLabels[sku.source] ?? "参考"}）`).join("；"),
        SKU参考成本覆盖: `${product.referenceCostCoverage?.coveredSkuCount ?? 0}/${product.referenceCostCoverage?.totalSkuCount ?? product.skuCount ?? 0}`,
        售价: product.salePrice ?? "",
        币种: "CNY",
        店铺: product.store,
        发布平台: product.salesPlatform || "",
        发布状态: productPublicationStatusById(product.publicationStatus).label,
        采购数据: dataStatusLabels[product.dataReadiness?.purchase.status] ?? "暂无",
        利润数据: dataStatusLabels[product.dataReadiness?.profit.status] ?? "暂无",
        仓库SKU映射: dataStatusLabels[product.dataReadiness?.warehouseMapping.status] ?? "暂无",
        数据状态: statusLabel[product.status] ?? product.status,
        选品状态: salesStatusLabel(product.salesStatus),
        重复SKC档案数: duplicateSkcCountByProductId.get(product.id) ?? 1,
        供应商数量: product.supplierCount,
        最后更新: product.updatedAt,
      })), "product-library.xlsx", "商品库");
      notify(`已导出 ${exportRows.length} 条商品记录。`);
    } catch (error) {
      notify(`导出失败：${error.message}`, "error");
    } finally {
      setExporting(false);
    }
  };

  const confirmBulkStatusUpdate = async () => {
    setUpdatingBulkStatus(true);
    try {
      const updated = await bulkUpdateProductCatalogSalesStatus({
        productIds: selectedProductIds,
        salesStatus: bulkStatus,
      });
      notify(`已将 ${updated.length} 条商品更新为“${salesStatusLabel(bulkStatus)}”。`, "success");
      setSelectedProductIds([]);
      setBulkStatus("");
      setBulkConfirmOpen(false);
    } catch (error) {
      notify(`批量更新失败：${error.message}`, "error");
    } finally {
      setUpdatingBulkStatus(false);
    }
  };

  const exportReferences = async () => {
    setExporting(true);
    try {
      await exportWorkbook(filteredReferences.map((row) => ({
        平台SKU: row.platformSku,
        平台SKC: row.platformSkc,
        商品档案: row.productName,
        当前参考成本: row.referenceUnitCost ?? "缺失",
        登记售价: row.catalogSalePrice ?? row.averageSalePrice ?? "缺失",
        参考成本来源: referenceSourceLabels[row.referenceKind] ?? "缺失",
        参考成本事实ID: row.referenceCostId ?? "",
        参考来源账本: row.referenceLedgerId ?? "",
        参考审批ID: row.referenceApprovalId ?? "",
        人工确认说明: row.referenceKind === "manual_confirmed" ? row.referenceNote ?? "" : "",
        人工确认人: row.referenceKind === "manual_confirmed" ? row.referenceConfirmedBy ?? "" : "",
        参考更新时间: row.referenceUpdatedAt ?? "",
        参考币种: row.referenceCurrency ?? "CNY",
        最近定稿月: row.latestPeriod ?? "",
        最近月销量: row.latestQuantity,
        最近月销售额: row.latestRevenue,
        最近月实际利润: row.latestProfit ?? "",
        最近月利润率: row.latestProfitRate ?? "",
        近三月销量: row.recentQuantity,
        近三月销售额: row.recentRevenue,
        近三月利润: row.recentProfit,
        单件参考利润: row.referenceUnitProfit ?? "",
        参考利润率: row.referenceProfitRate ?? "",
      })), "selection-reference.xlsx", "选品参考");
      notify(`已导出 ${filteredReferences.length} 条选品参考记录。`);
    } catch (error) {
      notify(`导出失败：${error.message}`, "error");
    } finally {
      setExporting(false);
    }
  };

  const updateStatusDraft = (statusId, changes) => {
    setStatusDraft((current) => current.map((statusItem) => statusItem.id === statusId ? { ...statusItem, ...changes } : statusItem));
  };

  const archiveStatusDraft = (statusId) => {
    setStatusDraft((current) => current.map((statusItem) => statusItem.id === statusId ? { ...statusItem, archivedAt: new Date().toISOString() } : statusItem));
  };

  const addCustomStatus = () => {
    try {
      const created = createCustomSelectionStatus({ label: newStatusLabel, tone: newStatusTone, sortOrder: (statusDraft.at(-1)?.sortOrder ?? 0) + 10 });
      setStatusDraft((current) => [...current, created]);
      setNewStatusLabel("");
      setNewStatusTone("neutral");
    } catch (error) {
      notify(error.message, "error");
    }
  };

  const saveStatusDefinitions = async () => {
    setSavingStatusDefinitions(true);
    try {
      await saveSelectionStatusDefinitions({ definitions: statusDraft });
      setStatusManagerOpen(false);
      notify("销售状态配置已保存。", "success");
    } catch (error) {
      notify(`保存状态配置失败：${error.message}`, "error");
    } finally {
      setSavingStatusDefinitions(false);
    }
  };

  const openMergeManager = () => {
    setMergeSkc("");
    setMergePrimaryId("");
    setMergePreview(null);
    setMergeConfirmOpen(false);
    setMergeManagerOpen(true);
  };

  const closeMergeManager = () => {
    if (mergingSkcRecords) return;
    setMergeManagerOpen(false);
    setMergeConfirmOpen(false);
    setMergePreview(null);
  };

  const selectMergeSkc = (nextSkc) => {
    setMergeSkc(nextSkc);
    setMergePrimaryId("");
    setMergePreview(null);
  };

  const selectMergePrimary = (productId) => {
    setMergePrimaryId(productId);
    setMergePreview(null);
  };

  const requestMergePreview = async () => {
    if (!mergePrimaryId || !mergeSourceIds.length) {
      notify("请先选择一个需要保留的主商品档案。", "error");
      return;
    }
    try {
      setMergePreview(await previewProductSkcMerge({ primaryProductId: mergePrimaryId, sourceProductIds: mergeSourceIds }));
    } catch (error) {
      notify(`无法生成合并预览：${error.message}`, "error");
    }
  };

  const confirmSkcMerge = async () => {
    if (!mergePreview) return;
    setMergingSkcRecords(true);
    try {
      const result = await mergeProductSkcRecords({ primaryProductId: mergePreview.primaryProductId, sourceProductIds: mergeSourceIds });
      closeMergeManager();
      notify(`已将 ${result.mergedSourceCount} 份重复档案合并到主商品档案。`, "success");
      navigate(`/products/edit?product=${encodeURIComponent(result.product.id)}`);
    } catch (error) {
      notify(`合并失败：${error.message}`, "error");
    } finally {
      setMergingSkcRecords(false);
    }
  };

  const referenceWithHistory = referenceRows.filter((row) => row.latestPeriod).length;
  const referenceWithErp = referenceRows.filter((row) => row.authoritativeSource === "erp").length;
  const negativeCount = referenceRows.filter((row) => row.hasNegativeProfit).length;
  const pageTitle = view === "reference" ? "成本与利润参考" : view === "pending" ? "待确认采集" : "选品工作台";
  const pageDescription = view === "reference"
    ? "使用已定稿利润和 ERP 历史成本形成参考，不修改任何月度正式账本。"
    : view === "pending"
      ? "审核 1688 采集结果，补齐平台 SKC、平台 SKU 和供应商资料后再写入选品商品库。"
      : "自由建立商品档案，管理发布状态、平台 SKC/SKU、仓库 SKU 映射、供应商、图片、1688 链接和售价。";

  return (
    <AppShell pageClass={`product-library-page ${view === "pending" ? "pending-view" : ""}`}>
      <PageHeader
        title={pageTitle}
        description={pageDescription}
        actions={view === "reference" ? (
          <><Button icon={Download} loading={exporting} disabled={exporting || filteredReferences.length === 0} onClick={exportReferences}>导出参考</Button><Button variant="primary" icon={WalletCards} onClick={() => navigate("/ledger")}>月度账本</Button></>
        ) : view === "official" ? (
          <><Button icon={Download} loading={exporting} disabled={exporting || filteredProducts.length === 0} onClick={exportProducts}>导出</Button><Button variant="primary" icon={Plus} onClick={() => navigate("/products/edit")}>新建商品</Button></>
        ) : null}
      />

      <div className="product-view-tabs" role="tablist" aria-label="商品管理视图">
        <button role="tab" aria-selected={view === "official"} className={view === "official" ? "active" : ""} onClick={() => changeView("official")}><CheckCircle2 size={17} /><span>选品商品库</span><small>{catalogProducts.length}</small></button>
        <button role="tab" aria-selected={view === "reference"} className={view === "reference" ? "active" : ""} onClick={() => changeView("reference")}><BarChart3 size={17} /><span>成本与利润参考</span><small>{referenceRows.length}</small></button>
        <button role="tab" aria-selected={view === "pending"} className={view === "pending" ? "active" : ""} onClick={() => changeView("pending")}><Inbox size={17} /><span>待确认采集</span><small>{pendingCount}</small></button>
      </div>

      {view === "reference" ? (
        <>
          <div className="reference-summary" aria-label="选品参考摘要">
            <span><small>平台 SKU</small><strong>{referenceRows.length}</strong></span>
            <span><small>已有定稿历史</small><strong>{referenceWithHistory}</strong></span>
            <span><small>采用 ERP 历史参考</small><strong>{referenceWithErp}</strong></span>
            <span className={negativeCount ? "danger" : ""}><small>负利润预警</small><strong>{negativeCount}</strong></span>
          </div>
          <Panel className="library-filter-panel">
            <div className="library-filters">
              <SelectionDomainSearch value={query} onChange={setQuery} label="搜索选品参考" />
              <select className="select-input" aria-label="按参考成本来源筛选" value={referenceSource} onChange={(event) => setReferenceSource(event.target.value)}>
                <option value="all">全部成本来源</option><option value="erp_history">ERP 历史</option><option value="manual_confirmed">人工确认</option><option value="finalized_profit_history">定稿历史</option><option value="supplier_landed">1688 参考</option>
              </select>
              <button className={`filter-chip ${negativeOnly ? "active" : ""}`} onClick={() => setNegativeOnly((value) => !value)}><AlertCircle size={17} />只看负利润</button>
            </div>
            <span className="reference-filter-count">当前 {filteredReferences.length} 条</span>
          </Panel>
          <Panel className="product-table-panel">
            {referenceRows.length ? (
              <DataTable
                className="selection-reference-table"
                columns={referenceColumns}
                data={groupedReferences}
                getRowId={(row) => row.id}
                getRowProps={(row) => row.latestLedgerId ? ({ onClick: () => navigate(`/profit?ledger=${encodeURIComponent(row.latestLedgerId)}`), tabIndex: 0, onKeyDown: (event) => event.key === "Enter" && navigate(`/profit?ledger=${encodeURIComponent(row.latestLedgerId)}`) }) : {}}
                emptyState="没有符合当前筛选条件的选品参考记录。"
              />
            ) : <EmptyState icon={BarChart3} title="还没有选品经营参考" description="完成一个月度账本定稿后，平台 SKU 的正式成本与利润历史会自动出现在这里。" action={<Button variant="primary" icon={WalletCards} onClick={() => navigate("/ledger")}>打开月度账本</Button>} />}
          </Panel>
        </>
      ) : view === "official" ? (
        <>
          <Panel className="library-filter-panel">
            <div className="library-filters">
              <SelectionDomainSearch value={query} onChange={setQuery} label="搜索商品档案" />
              <select className="select-input" aria-label="按店铺筛选" value={store} onChange={(event) => setStore(event.target.value)}>
                <option value="all">全部店铺</option>{[...new Set(catalogProducts.map((product) => product.store).filter(Boolean))].map((storeName) => <option value={storeName} key={storeName}>{storeName}</option>)}
              </select>
              <select className="select-input" aria-label="按选品状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">全部状态</option>{salesStatusDefinitions.map((statusItem) => <option value={statusItem.id} key={statusItem.id}>{statusItem.label}{statusItem.archivedAt ? "（已归档）" : ""}</option>)}<option value="draft">草稿资料</option><option value="inactive">停用资料</option>
              </select>
              <select className="select-input" aria-label="按发布状态筛选" value={publicationStatus} onChange={(event) => setPublicationStatus(event.target.value)}>
                <option value="all">全部发布状态</option>{PRODUCT_PUBLICATION_STATUSES.map((statusItem) => <option value={statusItem.id} key={statusItem.id}>{statusItem.label}</option>)}
              </select>
              <select className="select-input" aria-label="按经营数据筛选" value={dataStatus} onChange={(event) => setDataStatus(event.target.value)}>
                <option value="all">全部经营数据</option><option value="missing_purchase">缺少采购数据</option><option value="missing_profit">缺少利润数据</option><option value="missing_mapping">缺少仓库 SKU 映射</option><option value="erp_complete">采购数据已覆盖</option><option value="profit_complete">已有利润数据</option><option value="mapping_complete">仓库 SKU 已映射</option>
              </select>
              <button className={`filter-chip ${missingOnly ? "active" : ""}`} onClick={() => setMissingOnly((value) => !value)}><AlertCircle size={17} />缺失数据（{missingProductCount}）</button>
              {duplicateSkcGroups.length ? <button className={`filter-chip ${duplicatesOnly ? "active" : ""}`} onClick={() => setDuplicatesOnly((value) => !value)}><Copy size={17} />重复 SKC（{duplicateSkcGroups.length}）</button> : null}
              {duplicateSkcGroups.length ? <Button variant="ghost" icon={GitMerge} onClick={openMergeManager}>整理重复 SKC</Button> : null}
              <Button variant="ghost" icon={Settings2} onClick={() => setStatusManagerOpen(true)}>管理状态</Button>
            </div>
            <label className="sort-control">排序：
              <select value={productSort} onChange={(event) => setProductSort(event.target.value)}><option value="updated">最后更新</option><option value="coverage">成本覆盖情况</option><option value="lowestCost">最低 SKU 参考成本</option><option value="name">商品名称</option></select>
            </label>
          </Panel>
          <Panel className="product-table-panel">
            {selectedProductIds.length ? (
              <div className="product-bulk-toolbar" role="status">
                <span><strong>{selectedProductIds.length}</strong> 条已选</span>
                <div className="product-bulk-actions">
                  <label className="bulk-status-select">批量状态
                    <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
                      <option value="">选择状态</option>
                      {activeSalesStatuses.map((statusItem) => <option key={statusItem.id} value={statusItem.id}>{statusItem.label}</option>)}
                    </select>
                  </label>
                  <Button icon={Tag} disabled={!bulkStatus} onClick={() => setBulkConfirmOpen(true)}>更新状态</Button>
                  <Button icon={Download} variant="ghost" loading={exporting} disabled={exporting} onClick={() => exportProducts(filteredProducts.filter((product) => selectedProductIdSet.has(product.id)))}>导出已选</Button>
                  <Button variant="ghost" onClick={() => setSelectedProductIds([])}>取消选择</Button>
                </div>
              </div>
            ) : null}
            <DataTable
              className="product-table"
              columns={productColumns}
              data={filteredProducts}
              getRowId={(row) => row.id}
              getRowProps={(row) => ({ onClick: () => navigate(`/products/edit?product=${encodeURIComponent(row.id)}`), tabIndex: 0, onKeyDown: (event) => event.key === "Enter" && navigate(`/products/edit?product=${encodeURIComponent(row.id)}`) })}
              emptyState="没有符合当前筛选条件的商品，请清除部分筛选条件。"
            />
          </Panel>
        </>
      ) : <CaptureQueueContent query={query} onQueryChange={setQuery} />}
      <Modal
        open={bulkConfirmOpen}
        title="确认批量更新选品状态"
        description={`将 ${selectedProductIds.length} 条商品更新为“${salesStatusLabel(bulkStatus)}”。此操作会写入商品操作记录。`}
        onClose={() => setBulkConfirmOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setBulkConfirmOpen(false)}>取消</Button><Button variant="primary" loading={updatingBulkStatus} onClick={confirmBulkStatusUpdate}>确认更新</Button></>}
      />
      <Modal
        open={statusManagerOpen}
        className="status-manager-modal"
        title="管理销售状态"
        description="状态可用于筛选、批量更新和商品档案。系统预置状态可以改名或调整颜色；自定义状态可归档，已使用的历史状态会保留在商品记录中。"
        onClose={() => setStatusManagerOpen(false)}
        footer={<><Button variant="ghost" onClick={() => setStatusManagerOpen(false)}>取消</Button><Button variant="primary" loading={savingStatusDefinitions} disabled={savingStatusDefinitions} onClick={saveStatusDefinitions}>保存状态</Button></>}
      >
        <div className="status-manager-list">
          {statusDraft.map((statusItem) => <div className={`status-manager-row ${statusItem.archivedAt ? "archived" : ""}`} key={statusItem.id}>
            <input className="text-input" aria-label={`${statusItem.label} 状态名称`} value={statusItem.label} disabled={Boolean(statusItem.archivedAt)} onChange={(event) => updateStatusDraft(statusItem.id, { label: event.target.value })} />
            <select className="select-input" aria-label={`${statusItem.label} 状态颜色`} value={statusItem.tone} disabled={Boolean(statusItem.archivedAt)} onChange={(event) => updateStatusDraft(statusItem.id, { tone: event.target.value })}>
              <option value="neutral">灰色</option><option value="info">蓝色</option><option value="success">绿色</option><option value="warning">黄色</option><option value="danger">红色</option>
            </select>
            <label className="status-readiness-toggle"><input type="checkbox" checked={Boolean(statusItem.requiresReadiness)} disabled={Boolean(statusItem.archivedAt)} onChange={(event) => updateStatusDraft(statusItem.id, { requiresReadiness: event.target.checked })} />需资料完整</label>
            {!statusItem.isSystem && !statusItem.archivedAt ? <Button variant="ghost" icon={Trash2} onClick={() => archiveStatusDraft(statusItem.id)}>归档</Button> : <span className="status-manager-kind">{statusItem.archivedAt ? "已归档" : "系统"}</span>}
          </div>)}
        </div>
        <div className="status-manager-add">
          <input className="text-input" aria-label="新销售状态名称" value={newStatusLabel} onChange={(event) => setNewStatusLabel(event.target.value)} placeholder="新增状态名称" />
          <select className="select-input" aria-label="新销售状态颜色" value={newStatusTone} onChange={(event) => setNewStatusTone(event.target.value)}><option value="neutral">灰色</option><option value="info">蓝色</option><option value="success">绿色</option><option value="warning">黄色</option><option value="danger">红色</option></select>
          <Button icon={Plus} disabled={!newStatusLabel.trim()} onClick={addCustomStatus}>新增状态</Button>
        </div>
      </Modal>
      <Modal
        open={mergeManagerOpen}
        className="skc-merge-modal"
        title="整理重复 SKC 档案"
        description="此工具不会自动合并。请先选择同一平台 SKC 下需要保留的主档案，其余档案的 SKU、供应商报价和人工确认成本将转入主档。月度已定稿利润不会被改写。"
        onClose={closeMergeManager}
        footer={<><Button variant="ghost" disabled={mergingSkcRecords} onClick={closeMergeManager}>取消</Button><Button icon={GitMerge} disabled={!mergePrimaryId || !mergeSourceIds.length || mergingSkcRecords} onClick={requestMergePreview}>查看合并预览</Button>{mergePreview ? <Button variant="primary" icon={GitMerge} disabled={mergingSkcRecords} onClick={() => setMergeConfirmOpen(true)}>发起合并</Button> : null}</>}
      >
        <div className="skc-merge-form">
          <label>重复平台 SKC
            <select className="select-input" aria-label="选择重复平台 SKC" value={mergeSkc} onChange={(event) => selectMergeSkc(event.target.value)}>
              <option value="">请选择要整理的 SKC</option>
              {duplicateSkcGroups.map((group) => {
                const skc = canonicalPlatformSkc(group[0]?.platformSkc);
                return <option value={skc} key={skc}>{group[0]?.platformSkc} · {group.length} 份档案</option>;
              })}
            </select>
          </label>
          {selectedMergeGroup.length ? <div className="skc-merge-choice" role="radiogroup" aria-label="选择需要保留的主商品档案">
            <span className="skc-merge-choice-label">保留为主档</span>
            {selectedMergeGroup.map((product) => <label className={`skc-merge-product ${mergePrimaryId === product.id ? "selected" : ""}`} key={product.id}>
              <input type="radio" name="merge-primary-product" value={product.id} checked={mergePrimaryId === product.id} onChange={() => selectMergePrimary(product.id)} />
              <span><strong>{product.name || "未命名商品"}</strong><small>{product.store || "未分配店铺"} · 最后更新 {formatUpdatedAt(product.updatedAt)}</small></span>
              <span className="skc-merge-product-meta">{product.skuCount} SKU · {product.supplierCount} 供应商</span>
            </label>)}
          </div> : null}
          {mergePreview ? <div className="skc-merge-preview" aria-live="polite">
            <div><small>主商品档案</small><strong>{mergePreview.primaryName || "未命名商品"}</strong></div>
            <div><small>转入平台 SKU</small><strong>{mergePreview.movedSkuCount}</strong></div>
            <div><small>有效报价 / 历史报价</small><strong>{mergePreview.movedSupplierOfferCount} / {mergePreview.retainedSupplierOfferHistoryCount}</strong></div>
            <div><small>转入人工成本</small><strong>{mergePreview.movedManualCostCount}</strong></div>
            <p><AlertCircle size={15} />将合并 {mergePreview.sourceProducts.map((product) => product.name || "未命名商品").join("、")}。标签会去重，备注会合并保留。</p>
          </div> : null}
        </div>
      </Modal>
      <Modal
        open={mergeConfirmOpen}
        title="确认合并重复 SKC"
        description={`确认将 ${mergePreview?.sourceProducts.length ?? 0} 份来源档案并入“${mergePreview?.primaryName ?? "主商品档案"}”？来源商品档案会从商品库移除，但供应商报价历史和人工成本会保留并转入主档。`}
        tone="danger"
        onClose={() => !mergingSkcRecords && setMergeConfirmOpen(false)}
        footer={<><Button variant="ghost" disabled={mergingSkcRecords} onClick={() => setMergeConfirmOpen(false)}>返回检查</Button><Button variant="primary" icon={GitMerge} loading={mergingSkcRecords} onClick={confirmSkcMerge}>确认合并</Button></>}
      />
    </AppShell>
  );
}
