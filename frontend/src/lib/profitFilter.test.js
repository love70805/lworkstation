import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCostMatchingHref, buildProfitHref, filterProfitRows, filterProfitRowsByScope, searchProfitRows, readProfitFilter, saveProfitFilter } from "./profitFilter";
afterEach(() => vi.unstubAllGlobals());

describe("profit filter context", () => {
  it('retains store-specific supplier scope through saved filters and both profit/ERP routes', () => {
    const storage = new Map();
    const clientStorage = {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
    vi.stubGlobal('sessionStorage', clientStorage); vi.stubGlobal('localStorage', clientStorage);
    const excluded = { store:'甲', supplierNumber:'A-LBY', platformSku:'SKU-A', finalizable:false };
    const included = { store:'乙', supplierNumber:'A-LBY', platformSku:'SKU-B', finalizable:false };
    const other = { store:'乙', supplierNumber:'OTHER', platformSku:'SKU-C', finalizable:false };
    const filter = { query:'', storeFilter:'all', supplierSelection:['A-LBY'], supplierStoreSelection:[{store:'乙',supplierNumber:'A-LBY'}], missingOnly:false };
    const rows = [excluded,included,other];
    expect(filterProfitRowsByScope(rows,filter)).toEqual([included]);
    saveProfitFilter('L', filter);
    expect(readProfitFilter(new URLSearchParams(),'L')).toEqual(filter);
    for (const build of [buildCostMatchingHref,buildProfitHref]) {
      const href = build({ledgerId:'L',workspaceId:'W',...filter});
      expect(href.length).toBeLessThan(200);
      const params = new URL(href,'http://localhost').searchParams;
      const restored = readProfitFilter(params,'L',{workspaceId:'W'});
      expect(restored).toEqual(filter);
      expect(filterProfitRows(rows,restored)).toEqual([included]);
      expect(filterProfitRows(rows,readProfitFilter(params,'L',{workspaceId:'OTHER'}))).toEqual([]);
    }
    expect(filterProfitRowsByScope(rows,{...filter,supplierSelection:null,supplierStoreSelection:[]})).toEqual([]);
    expect(filterProfitRowsByScope(rows,{...filter,supplierSelection:[],supplierStoreSelection:filter.supplierStoreSelection})).toEqual([]);
    expect(filterProfitRowsByScope(rows,{...filter,supplierSelection:null,supplierStoreSelection:null})).toEqual(rows);
    expect(filterProfitRowsByScope(rows,{...filter,storeFilter:'甲'})).toEqual([]);
  });
  it('fails closed when a saved store-specific scope or its URL reference is malformed or unavailable', () => {
    const storage = new Map();
    const clientStorage = {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
    vi.stubGlobal('sessionStorage', clientStorage); vi.stubGlobal('localStorage', clientStorage);
    storage.set('shopeers:profit-filter:L', JSON.stringify({supplierSelection:['A'],supplierStoreSelection:{store:'乙'}}));
    expect(readProfitFilter(new URLSearchParams(),'L')).toMatchObject({supplierSelection:[],supplierScopeError:expect.any(String)});
    storage.set('shopeers:profit-filter:scope:bad', JSON.stringify({ledgerId:'L',workspaceId:'W',suppliers:['A'],supplierStoreSelection:[{supplierNumber:'A'}]}));
    expect(readProfitFilter(new URLSearchParams('supplier_scope=bad'),'L',{workspaceId:'W'})).toMatchObject({supplierSelection:[],supplierScopeError:expect.any(String)});
    vi.stubGlobal('sessionStorage',{setItem:()=>{throw Error('unavailable');}});
    const href = buildCostMatchingHref({ledgerId:'L',workspaceId:'W',supplierSelection:['A'],supplierStoreSelection:[{store:'乙',supplierNumber:'A'}]});
    expect(readProfitFilter(new URL(href,'http://localhost').searchParams,'L')).toMatchObject({supplierSelection:[],supplierScopeError:expect.any(String)});
  });
  it('round-trips 10000 suppliers through a bounded, ledger/workspace-bound reference and fails closed if unavailable', () => {
    const storage = new Map();
    vi.stubGlobal('sessionStorage', {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)});
    const selection = Array.from({length:10000},(_,i)=>`000${i}-LBY`);
    const href = buildCostMatchingHref({ledgerId:'L',workspaceId:'W',supplierSelection:selection});
    expect(href.length).toBeLessThan(200);
    const params = new URL(href,'http://localhost').searchParams;
    expect(readProfitFilter(params,'L',{workspaceId:'W'}).supplierSelection).toHaveLength(10000);
    expect(readProfitFilter(params,'other',{workspaceId:'W'})).toMatchObject({supplierSelection:[],supplierScopeError:expect.any(String)});
    expect(readProfitFilter(params,'L',{workspaceId:'other'}).supplierSelection).toEqual([]);
    const old = params.get('supplier_scope');
    const next = new URL(buildProfitHref({ledgerId:'L',workspaceId:'W',supplierSelection:selection.slice(0,9000)}),'http://localhost');
    expect(next.searchParams.get('supplier_scope')).not.toBe(old);
    expect(readProfitFilter(params,'L',{workspaceId:'W'}).supplierSelection).toHaveLength(10000);
    storage.clear();
    expect(readProfitFilter(params,'L',{workspaceId:'W'}).supplierSelection).toEqual([]);
  });
  it("round-trips selected suppliers through profit and ERP routes", () => {
    const href = buildCostMatchingHref({ ledgerId: "L-1", query: "SKC-1", storeFilter: "680店", supplierSelection: ["YW-B", "YW-A"], missingOnly: true });
    const params = new URL(href, "http://localhost").searchParams;
    const filter = readProfitFilter(params, "L-1");
    expect(filter).toEqual({ query: "SKC-1", storeFilter: "680店", supplierSelection: ["YW-A", "YW-B"], missingOnly: true });
    const profitUrl = new URL(buildProfitHref({ ledgerId: "L-1", ...filter }), "http://localhost");
    expect(profitUrl.pathname).toBe("/profit");
    expect(profitUrl.searchParams.get("ledger")).toBe("L-1");
    expect(readProfitFilter(profitUrl.searchParams, "L-1")).toEqual(filter);
  });

  it("keeps an explicitly empty supplier selection when moving to ERP", () => {
    const href = buildCostMatchingHref({ ledgerId: "L-2", missingOnly: true, supplierSelection: [] });
    const filter = readProfitFilter(new URL(href, "http://localhost").searchParams, "L-2");
    expect(filter.supplierSelection).toEqual([]);
    expect(filter.missingOnly).toBe(true);
  });

  it("filters the same sales rows used by the profit and cost pages", () => {
    const rows = [
      { groupSkc: "SKC-1", platformSku: "SKU-1", attribute: "红", supplierNumber: "YW-A", store: "680店", finalizable: false },
      { groupSkc: "SKC-2", platformSku: "SKU-2", attribute: "蓝", supplierNumber: "YW-B", store: "680店", finalizable: true },
    ];
    expect(filterProfitRows(rows, { query: "", storeFilter: "all", supplierSelection: ["YW-A"], missingOnly: false })).toEqual([rows[0]]);
    expect(filterProfitRows(rows, { query: "SKC-2", storeFilter: "680店", supplierSelection: null, missingOnly: true })).toEqual([]);
  });

  it("restores the most recent filter when the profit route has no ledger query", () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    };
    const expected = { query: "SKU-9", storeFilter: "680店", supplierSelection: ["YW-A"], missingOnly: true };
    saveProfitFilter("L-9", expected);
    expect(readProfitFilter(new URLSearchParams(), "")).toEqual(expected);
    expect(readProfitFilter(new URLSearchParams(), "L-9")).toEqual(expected);
    delete globalThis.localStorage;
  });

  it("narrows the ledger before constructing search text and reuses it for repeated queries", () => {
    let reads = 0;
    const selected = { store: "甲店", supplierNumber: "货号1", platformSku: "SKU-A", platformSkc: "SKC-A", get attribute() { reads += 1; return "红色"; } };
    const excluded = { store: "乙店", supplierNumber: "货号2", get attribute() { throw Error("outside selected store"); } };
    const filter = { storeFilter: "甲店", supplierSelection: ["货号1"], missingOnly: false };
    const scoped = filterProfitRowsByScope([selected, excluded], filter);
    expect(searchProfitRows(scoped, " skc-a ")).toEqual([selected]);
    expect(searchProfitRows(scoped, "sku-a")).toEqual([selected]);
    expect(reads).toBe(1);
    expect(filterProfitRows([selected, excluded], { ...filter, query: "货号1" })).toEqual([selected]);
    expect(searchProfitRows(scoped, "")).toBe(scoped);
  });
});
