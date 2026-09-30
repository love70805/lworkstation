import { describe, expect, it } from "vitest";
import { buildSelectionSalesLabels, createSalesSourceCoverage, salesSourceDateEvidence, selectionSalesLabel } from "./selectionSalesLabels";

const ledger = (period = "2026-08", id = period) => ({ id, workspaceId: "W", period });
const sale = (patch = {}) => ({ id: "R", workspaceId: "W", ledgerId: "2026-08", batchId: "B", store: "甲店", platformSkc: "SKC-A", platformSku: "SKU-A", sourceRow: 2, sourceAddedDate: "2026-08-29", quantityExact: "100", quantity: 100, ...patch });
const batch = (patch = {}) => ({ id: "B", workspaceId: "W", ledgerId: "2026-08", period: "2026-08", store: "甲店", fileHash: "HASH-B", status: "completed", validRowCount: 1, sourceCoverage: createSalesSourceCoverage({ period: "2026-08", storeName: "甲店" }), ...patch });
const build = (patch = {}) => buildSelectionSalesLabels({ ledgers: [ledger()], importBatches: [batch()], salesRows: [sale()], ...patch });
const item = (result, skc = "SKC-A") => result.items.find(row => row.platformSkc === skc);

describe("selection sales label contract", () => {
  it.each([[0,"低销"],[9,"低销"],[10,"一般"],[99,"一般"],[100,"高销"],[699,"高销"],[700,"爆款"],[1000,"爆款"]])("maps exact quantity %s to %s", (quantity, label) => expect(selectionSalesLabel(String(quantity))).toBe(label));
  it("uses the full month end rather than last sale or import dates and sums by SKC", () => {
    const result = build({ importBatches: [batch({validRowCount:3})], salesRows: [sale({sourceAddedDate:"2026-08-24",quantityExact:"900",quantity:900}), sale({id:"R2",sourceRow:3,platformSku:"SKU-B",quantityExact:"600",quantity:600}), sale({id:"R3",sourceRow:4,sourceAddedDate:"2026-08-25",quantityExact:"100",quantity:100})] });
    expect(result).toMatchObject({period:"2026-08",startDate:"2026-08-25",endDate:"2026-08-31",rangeLabel:"2026-08-25—2026-08-31"});
    expect(item(result)).toMatchObject({status:"ready",quantityExact:"700",monthQuantityExact:"1600",label:"爆款"});
  });
  it("keeps an undated SKC insufficient while an unrelated SKC can be labelled", () => {
    const result = build({ importBatches: [batch({validRowCount:2})], salesRows: [sale({sourceAddedDate:null,dateStatus:"missing"}),sale({id:"R2",sourceRow:3,platformSkc:"SKC-B",platformSku:"SKU-B"})] });
    expect(result.period).toBe("2026-08");
    expect(item(result)).toMatchObject({status:"insufficient",label:null,quantityExact:null,reason:"missing_dates"});
    expect(item(result,"SKC-B").label).toBe("高销");
  });
  it("makes the whole store uncertain when a sales row cannot be located to a SKC", () => {
    const result = build({ importBatches: [batch({validRowCount:2})], salesRows: [sale(),sale({id:"R2",sourceRow:3,platformSkc:"",platformSku:"UNKNOWN",sourceAddedDate:null})] });
    expect(item(result)).toMatchObject({status:"insufficient",label:null,reason:"unresolved_identity"});
  });
  it("only proves zero for explicitly associated identities within complete store coverage", () => {
    const result = build({productSkus:[{platformSkc:"SKC-ZERO",platformSku:"Z",store:"甲店"},{platformSkc:"SKC-UNKNOWN",platformSku:"U"},{platformSkc:"SKC-OTHER",platformSku:"O",store:"乙店"}],store:"甲店"});
    expect(item(result,"SKC-ZERO")).toMatchObject({status:"ready",quantityExact:"0",label:"低销"});
    expect(item(result,"SKC-UNKNOWN")).toMatchObject({status:"unknown_store",label:null,quantityExact:null});
    expect(item(result,"SKC-OTHER")).toMatchObject({status:"out_of_scope",label:null});
  });
  it("does not upgrade dated legacy sources or partial declarations into complete coverage", () => {
    for (const sourceCoverage of [undefined,createSalesSourceCoverage({period:"2026-08",storeName:"甲店",scope:"partial"})]) {
      const result=build({importBatches:[batch({sourceCoverage})]});
      expect(result).toMatchObject({period:null,status:"no_complete_month"});
      expect(item(result).label).toBeNull();
    }
  });
  it("selects the latest common declared month without assembling different store windows", () => {
    const rows=[sale(),sale({id:"RB",ledgerId:"2026-07",batchId:"BJ",store:"乙店",sourceAddedDate:"2026-07-31"}),sale({id:"RAJ",ledgerId:"2026-07",batchId:"AJ",sourceAddedDate:"2026-07-31"})];
    const batches=[batch(),batch({id:"BJ",ledgerId:"2026-07",period:"2026-07",store:"乙店",sourceCoverage:createSalesSourceCoverage({period:"2026-07",storeName:"乙店"})}),batch({id:"AJ",ledgerId:"2026-07",period:"2026-07",sourceCoverage:createSalesSourceCoverage({period:"2026-07",storeName:"甲店"})})];
    const result=build({salesRows:rows,importBatches:batches,ledgers:[ledger(),ledger("2026-07")]});
    expect(result).toMatchObject({period:"2026-07",startDate:"2026-07-25",endDate:"2026-07-31"});
    expect(item(result)).toMatchObject({quantityExact:"200",label:"高销"});
    expect(build({salesRows:rows.slice(0,2),importBatches:batches.slice(0,2),ledgers:[ledger(),ledger("2026-07")]})).toMatchObject({period:null,status:"no_common_month"});
  });
  it("does not quietly fall back from a newer complete source with bad dates", () => {
    const result=build({ledgers:[ledger(),ledger("2026-07")],importBatches:[batch(),batch({id:"J",ledgerId:"2026-07",period:"2026-07",sourceCoverage:createSalesSourceCoverage({period:"2026-07",storeName:"甲店"})})],salesRows:[sale({sourceAddedDate:null}),sale({id:"RJ",ledgerId:"2026-07",batchId:"J",sourceAddedDate:"2026-07-30"})]});
    expect(result.period).toBe("2026-08");expect(item(result).label).toBeNull();
    expect(build({ledgers:[ledger(),ledger("2026-07")],importBatches:[batch({status:"withdrawn"}),batch({id:"J",ledgerId:"2026-07",period:"2026-07",sourceCoverage:createSalesSourceCoverage({period:"2026-07",storeName:"甲店"})})],salesRows:[sale(),sale({id:"RJ",ledgerId:"2026-07",batchId:"J",sourceAddedDate:"2026-07-30"})]}).period).toBe("2026-07");
  });
  it("respects an explicitly viewed historical month and reports incomplete selected months", () => {
    expect(build({period:"2026-07"})).toMatchObject({period:"2026-07",status:"no_complete_month"});
  });
  it("deduplicates replayed source coordinates without deduplicating real separate sales rows", () => {
    expect(item(build({salesRows:[sale(),sale({id:"COPY"})]})).quantityExact).toBe("100");
    expect(item(build({importBatches:[batch({validRowCount:2})],salesRows:[sale(),sale({id:"SECOND",sourceRow:3})]})).quantityExact).toBe("200");
  });
  it("nets valid returns in the seven-day window", () => {
    const result = build({importBatches:[batch({validRowCount:2})],salesRows:[sale({quantityExact:"105",quantity:105}),sale({id:"RETURN",sourceRow:3,quantityExact:"-5",quantity:-5})]});
    expect(item(result)).toMatchObject({status:"ready",quantityExact:"100",label:"高销"});
  });
  it.each([{quantityExact:"-1",quantity:-1},{sourceAddedDate:"2026-08-32"},{sourceAddedDate:"2026-09-01"}])("does not assign a label to anomalous sales %j", patch => expect(item(build({salesRows:[sale(patch)]})).label).toBeNull());
  it("does not retain full coverage after a source has been partly replaced", () => {
    const result=build({importBatches:[batch({validRowCount:2})]});
    expect(result.status).toBe("no_complete_month");
  });
  it("keeps monthly amounts and manual tags untouched when no daily detail exists", () => {
    const products=[{id:"P",platformSkc:"SKC-A",tags:["手工重点"]}];
    const before=structuredClone(products);
    const result=build({products,salesRows:[sale({sourceAddedDate:null})]});
    expect(item(result)).toMatchObject({monthQuantityExact:"100",label:null,reason:"missing_dates"});
    expect(products).toEqual(before);
  });
  it("separates a full-month declaration from date quality", () => {
    const coverage=createSalesSourceCoverage({period:"2026-08",storeName:"甲店"});
    expect(coverage).toEqual({version:1,period:"2026-08",store:"甲店",scope:"full_month",declarationSource:"import_preview"});
    expect(salesSourceDateEvidence([sale({sourceAddedDate:null})],{period:"2026-08"})).toMatchObject({status:"missing",salesRowCount:1,validDateRowCount:0,missingDateRowCount:1});
    expect(coverage.scope).toBe("full_month");
  });
});

it("does not prove zero from an identity projection already marked conflicting",()=>{
 const result=build({productSkus:[{platformSkc:"SKC-ZERO",platformSku:"Z",store:"甲店",platformSkcConflict:true}]});
 expect(item(result,"SKC-ZERO")).toMatchObject({status:"insufficient",label:null,reason:"identity_conflict"});
});
it("does not assign zero to either side of a globally conflicting SKU relationship",()=>{
 const result=build({productSkus:[{platformSkc:"SKC-X",platformSku:"CONFLICT",store:"甲店"},{platformSkc:"SKC-Y",platformSku:"CONFLICT",store:"甲店"}]});
 expect(item(result,"SKC-X").label).toBeNull();expect(item(result,"SKC-Y").label).toBeNull();
});

it("labels each product using only its own source stores without combining different months", () => {
  const result = build({ ledgers: [ledger(), ledger("2026-07")], importBatches: [batch(), batch({ id: "J", ledgerId: "2026-07", period: "2026-07", store: "乙店", sourceCoverage: createSalesSourceCoverage({ period: "2026-07", storeName: "乙店" }) })], salesRows: [sale(), sale({ id: "RJ", batchId: "J", ledgerId: "2026-07", store: "乙店", platformSku: "SKU-B", platformSkc: "SKC-B", sourceAddedDate: "2026-07-31", quantityExact: "20" })] });
  expect(result.status).toBe("no_common_month");
  expect(item(result)).toMatchObject({ status: "ready", period: "2026-08", quantityExact: "100", label: "高销" });
  expect(item(result, "SKC-B")).toMatchObject({ status: "ready", period: "2026-07", quantityExact: "20", label: "一般" });
});
it("does not let an unrelated incomplete shop erase a complete shop's label", () => {
  const result = build({ importBatches: [batch(), batch({ id: "B2", store: "乙店", sourceCoverage: null })], salesRows: [sale(), sale({ id: "R2", batchId: "B2", store: "乙店", platformSku: "SKU-B", platformSkc: "SKC-B" })] });
  expect(item(result).label).toBe("高销");
  expect(item(result, "SKC-B")).toMatchObject({ status: "no_complete_month", quantityExact: null });
});

it("uses a verified SKU mapping to attribute a legacy row's actual store without inventing ownership", () => {
  const result = build({ productSkus: [{ platformSku: "SKU-A", platformSkc: "SKC-A" }], salesRows: [sale({ platformSkc: "" })] });
  expect(item(result)).toMatchObject({ status: "ready", stores: ["甲店"], quantityExact: "100" });
});
