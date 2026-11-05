var ShopeersErpProductArchive = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // frontend/src/domain/productArchiveWorkbook.js
  var productArchiveWorkbook_exports = {};
  __export(productArchiveWorkbook_exports, {
    parseProductArchiveWorkbook: () => parseProductArchiveWorkbook,
    productArchiveRows: () => productArchiveRows
  });

  // frontend/src/domain/erpCatalogFields.js
  function text(value) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    const normalized = String(value).normalize("NFKC").trim();
    return normalized || null;
  }
  function normalizeErpCatalogUrl(value) {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
      if ([...url.searchParams.keys()].some((key) => /token|cookie|authorization|password|secret|capability|endpoint|baseurl/i.test(key))) return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }
  function normalizeErpSupplierLinks(values) {
    const links = [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of Array.isArray(values) ? values : []) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const url = normalizeErpCatalogUrl(entry.url);
      if (!url) continue;
      const parsed = new URL(url);
      const isProduct = parsed.hostname === "detail.1688.com" && /^\/offer\/\d{7,20}\.html$/.test(parsed.pathname);
      const isStore = parsed.hostname.endsWith(".1688.com") && !["detail.1688.com", "www.1688.com"].includes(parsed.hostname);
      if (!(entry.type === "product" && isProduct) && !(entry.type === "store" && isStore)) continue;
      parsed.search = "";
      const link = { type: entry.type, url: parsed.href, supplierName: text(entry.supplierName) };
      const key = JSON.stringify(link);
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(link);
    }
    return links;
  }
  var ERP_CATALOG_COVERAGE_GROUPS = Object.freeze(["directory", "mappings", "images", "suppliers", "purchaseEvidence"]);

  // frontend/src/domain/erpProductCatalog.js
  function safeUrl(value) {
    return normalizeErpCatalogUrl(value) || "";
  }
  function erpSupplierLink(value) {
    const url = safeUrl(value);
    if (!url) return null;
    const parsed = new URL(url);
    if (!/(^|\.)1688\.com$/i.test(parsed.hostname)) return null;
    const offer = /^\/offer\/(\d+)\.html$/.exec(parsed.pathname);
    const link = normalizeErpSupplierLinks([{ type: offer ? "product" : "store", url }])[0];
    return link ? { ...link, sourceProductId: offer?.[1] ?? "" } : null;
  }

  // frontend/src/domain/productArchiveWorkbook.js
  var text2 = (value) => String(value ?? "").trim();
  function productArchiveRows(sheet, XLSX) {
    const cells = Object.keys(sheet).filter((key) => /^[A-Z]+[1-9][0-9]*$/.test(key));
    const positions = cells.map((key) => XLSX.utils.decode_cell(key));
    const end = positions.reduce((max, cell) => ({ r: Math.max(max.r, cell.r), c: Math.max(max.c, cell.c) }), { r: 0, c: 0 });
    if (end.r > 1e5 || end.c > 255) throw new Error("\u5546\u54C1\u6863\u6848\u8D85\u8FC7\u53EF\u5904\u7406\u8303\u56F4\u3002");
    const headers = Array.from({ length: end.c + 1 }, (_, c) => text2(sheet[XLSX.utils.encode_cell({ r: 0, c })]?.v));
    if (!headers.includes("\u5546\u54C1ID") || !headers.includes("\u5546\u54C1\u540D\u79F0")) throw new Error("\u672A\u627E\u5230\u5546\u54C1ID\u3001\u5546\u54C1\u540D\u79F0\u5217\uFF0C\u8BF7\u9009\u62E9 ERP \u5546\u54C1\u6863\u6848\u5BFC\u51FA\u6587\u4EF6\u3002");
    if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error("\u5546\u54C1\u6863\u6848\u5305\u542B\u91CD\u590D\u8868\u5934\uFF0C\u8BF7\u6838\u5BF9\u3002");
    const columns = Object.fromEntries(headers.map((name, c) => [name, c]));
    const rows = [], seen = /* @__PURE__ */ new Map();
    for (let r = 1; r <= end.r; r++) {
      const cell = (name) => columns[name] == null ? null : sheet[XLSX.utils.encode_cell({ r, c: columns[name] })];
      const value = (name) => cell(name)?.f ? "" : text2(cell(name)?.v);
      const warehouseSku = value("\u5546\u54C1ID");
      if (!warehouseSku) continue;
      if (cell("\u5546\u54C1ID")?.t === "n") throw new Error(`\u7B2C ${r + 1} \u884C\u5546\u54C1ID\u88AB\u4FDD\u5B58\u4E3A\u6570\u503C\uFF0C\u65E0\u6CD5\u4FDD\u8BC1\u6807\u8BC6\u5B8C\u6574\u3002`);
      const image = cell("\u56FE\u7247\u94FE\u63A5");
      const imageLiteral = image?.f ? /^(?:_xlfn\.)?IMAGE\s*\(\s*"([^"]+)"\s*(?:[,;)]|$)/i.exec(image.f.replace(/^=/, ""))?.[1] : image?.v;
      const imageUrl = normalizeErpCatalogUrl(imageLiteral) || "";
      const supplier1688Links = [...new Map((value("1688\u94FE\u63A5\u7247\u6BB5").match(/https?:\/\/[^\s，,;；|<>"']+/g) ?? []).map((url) => erpSupplierLink(url)).filter(Boolean).map((link) => [link.url, link])).values()];
      const row = {
        warehouseSku,
        productName: value("\u5546\u54C1\u540D\u79F0"),
        imageUrl,
        color: value("\u5546\u54C1\u989C\u8272"),
        attribute: [value("\u5546\u54C1\u989C\u8272"), value("\u89C4\u683C\u578B\u53F7")].filter(Boolean).join(" \xB7 "),
        supplier1688Links
      };
      const identity = warehouseSku.normalize("NFKC").toUpperCase();
      if (seen.has(identity) && JSON.stringify(seen.get(identity)) !== JSON.stringify(row)) throw new Error(`\u7B2C ${r + 1} \u884C\u5546\u54C1ID\u5B58\u5728\u51B2\u7A81\uFF0C\u672A\u5BFC\u5165\u3002`);
      if (!seen.has(identity)) {
        seen.set(identity, row);
        rows.push(row);
      }
    }
    if (!rows.length) throw new Error("\u5546\u54C1\u6863\u6848\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684\u6570\u636E\u884C\u3002");
    return rows;
  }
  function parseProductArchiveWorkbook(bytes, XLSX) {
    if (!bytes || bytes.byteLength > 32 * 1024 * 1024) throw new Error("\u8BF7\u9009\u62E9\u4E0D\u8D85\u8FC7 32 MB \u7684\u5546\u54C1\u6863\u6848\u3002");
    const workbook = XLSX.read(new Uint8Array(bytes), { type: "array", cellFormula: true, cellHTML: false, cellStyles: false });
    const sheets = workbook.SheetNames.filter((name) => Object.values(workbook.Sheets[name]).some((cell) => cell?.v === "\u5546\u54C1ID"));
    if (sheets.length !== 1) throw new Error("\u9700\u8981\u4E00\u4E2A\u5305\u542B\u5546\u54C1ID\u5217\u7684\u5546\u54C1\u6863\u6848\u660E\u7EC6\u9875\u3002");
    return productArchiveRows(workbook.Sheets[sheets[0]], XLSX);
  }
  return __toCommonJS(productArchiveWorkbook_exports);
})();
