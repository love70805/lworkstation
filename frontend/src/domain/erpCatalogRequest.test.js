import { describe, expect, it } from 'vitest';
import { buildErpCatalogRequest, buildErpCatalogInboxEnvelope, validateErpCatalogInboxEnvelope } from './erpCatalogRequest';

const request = () => buildErpCatalogRequest({ id: 'catalog-1', workspaceId: 'w-1', platformSkcs: ['SKC-1'], confirmedSkus: [{ platformSku: 'SKU-1', platformSkc: 'SKC-1' }], sourceProductIds: ['product-1'], ledgerPeriod: '2026-08', idempotencyKey: 'refresh-1', requestedAt: '2026-09-29T00:00:00Z' });
const mapping = { platformSku: 'SKU-NEW', platformSkc: 'SKC-1', warehouseSku: 'WH-1', attribute: '平台蓝色', unitConversion: { warehouseUnits: 2, platformUnits: 1, source: 'erp_platform_mapping', sourceRef: 'map-1' } };
const payload = () => ({ catalog: { batchId: 'batch-1', requestId: 'catalog-1', workspaceId: 'w-1', ledgerPeriod: '2026-08', generatedAt: '2026-09-29T01:00:00Z', query: { unit: 'platform_skc', platformSkcs: ['SKC-1'] }, coverage: { directory: { state: 'complete' }, mappings: { state: 'complete' }, images: { state: 'unavailable', reasons: ['network'] }, suppliers: { state: 'complete' }, purchaseEvidence: { state: 'complete' } }, rows: [{ ...mapping, catalogMappings: [mapping], productName: '商品名称', previewUnitCost: 100, unitCost: 100 }], warehouseEvidence: [{ warehouseSku: 'WH-1', evidenceComplete: true, purchaseRecords: [{ recordId: 'purchase-1', quantity: 3, unitPrice: 0.00001, purchaseDate: '2026-08-29', purchaseCatalog: { purchaseSpecificationAndModel1688: '采购规格' } }] }] }, deliveryId: 'delivery-1', sentAt: '2026-09-29T01:00:00Z' });

describe('ERP independent catalog requests', () => {
  it('validates every platform pair in exact-scope deliveries and preserves that policy on replay', () => {
    const input = payload();
    input.catalog.platformScopePolicy = 'ledger_platform_pair';
    input.catalog.rows = [{ ...input.catalog.rows[0], platformSku: 'SKU-1', catalogMappings: [{ ...mapping, platformSku: 'SKU-1' }] }];
    const envelope = buildErpCatalogInboxEnvelope(input, { request: request() });
    expect(envelope.catalog.platformScopePolicy).toBe('ledger_platform_pair');
    expect(validateErpCatalogInboxEnvelope(envelope, { request: request() }).envelope).toEqual(envelope);
    for (const mutate of [value => { value.catalog.rows[0].platformSku = 'SKU-UNUSED'; }, value => { value.catalog.rows[0].catalogMappings.push(mapping); }, value => { value.catalog.rows[0].catalogMappings[0].platformSkc = 'WRONG'; }]) {
      const changed = structuredClone(input); mutate(changed);
      expect(() => buildErpCatalogInboxEnvelope(changed, { request: request() })).toThrow();
    }
  });
  it('uses confirmed identity without a ledger or sales and requires an explicit reference period', () => {
    expect(request()).toMatchObject({ kind: 'catalog', ledgerId: null, ledgerPeriod: '2026-08' });
    expect(() => request({})).not.toThrow();
    expect(() => buildErpCatalogRequest({ ...request(), ledgerPeriod: null })).toThrow('适用月份');
    expect(() => buildErpCatalogRequest({ ...request(), platformSkcs: ['SKC-1', 'OTHER'] })).toThrow('已确认');
    expect(() => buildErpCatalogRequest({ ...request(), confirmedSkus: [{ platformSku: 'SKU-1', platformSkc: 'OTHER' }] })).toThrow('范围');
    expect(() => buildErpCatalogRequest({ ...request(), sourceProductIds: [] })).toThrow('来源');
  });
  it('keeps an unsold sibling with warehouse evidence and conversion, never a formal or preview price', () => {
    const envelope = buildErpCatalogInboxEnvelope(payload(), { request: request() });
    expect(envelope.catalog.rows[0]).toMatchObject({ platformSku: 'SKU-NEW', unitConversion: mapping.unitConversion, attribute: '平台蓝色' });
    expect(envelope.catalog.rows[0]).not.toHaveProperty('unitCost');
    expect(envelope.catalog.rows[0]).not.toHaveProperty('previewUnitCost');
    expect(envelope.catalog.warehouseEvidence[0].purchaseRecords[0].unitPrice).toBe(0.00001);
    expect(envelope.catalog.status).toBe('partial');
    expect(envelope.catalog.warehouseEvidence[0].purchaseRecords[0].purchaseCatalog.purchaseSpecificationAndModel1688).toBe('采购规格');
  });
  it('rejects widened workspace, SKC, warehouse evidence and mismatch in the registered period', () => {
    for (const mutate of [input => { input.catalog.workspaceId = 'foreign'; }, input => { input.catalog.ledgerPeriod = '2026-09'; }, input => { input.catalog.query.platformSkcs = ['OTHER']; }, input => { input.catalog.rows[0].platformSkc = 'OTHER'; }, input => { input.catalog.warehouseEvidence[0].warehouseSku = 'WH-FOREIGN'; }]) {
      const input = payload(); mutate(input);
      expect(() => buildErpCatalogInboxEnvelope(input, { request: request() })).toThrow();
    }
  });
  it('keeps identity conflicts as evidence instead of rebinding, protects real zero, and is stable on replay', () => {
    const input = payload(); input.catalog.rows[0].catalogMappings.push({ ...mapping, platformSkc: 'CONFLICT' }); input.catalog.warehouseEvidence[0].purchaseRecords[0].unitPrice = 0;
    const envelope = buildErpCatalogInboxEnvelope(input, { request: request() });
    expect(envelope.catalog.rows[0].catalogMappings).toHaveLength(2);
    expect(envelope.catalog.warehouseEvidence[0].purchaseRecords[0].unitPrice).toBe(0);
    expect(validateErpCatalogInboxEnvelope(envelope, { request: request() }).envelope).toEqual(envelope);
  });
});


describe('catalog evidence hygiene', () => {
  it('deduplicates exact rows while retaining different evidence and sanitizes optional URLs/status fields', () => {
    const input = payload(); input.catalog.rows.push({ ...input.catalog.rows[0] });
    input.catalog.rows[0].supplier1688Url = 'https://detail.1688.com/offer/123456789.html?token=bad';
    input.catalog.rows[1].supplier1688Url = input.catalog.rows[0].supplier1688Url;
    input.catalog.warehouseEvidence[0].purchaseRecords[0].statusFields = { status: '11', token: 'bad', productSeller: 'person' };
    const envelope = buildErpCatalogInboxEnvelope(input, { request: request() });
    expect(envelope.catalog.rows).toHaveLength(1);
    expect(envelope.catalog.rows[0].supplier1688Url).toBeNull();
    expect(envelope.catalog.warehouseEvidence[0].purchaseRecords[0].statusFields).toEqual({ status: '11' });
    input.catalog.rows[1].productName = 'another observed title';
    expect(buildErpCatalogInboxEnvelope(input, { request: request() }).catalog.rows).toHaveLength(2);
  });
  it('rejects contradictory warehouse records and request self-superseding', () => {
    const input = payload(); input.catalog.warehouseEvidence[0].purchaseRecords[0].warehouseSku = 'FOREIGN';
    expect(() => buildErpCatalogInboxEnvelope(input, { request: request() })).toThrow('仓库');
    expect(() => buildErpCatalogRequest({ ...request(), supersedesRequestId: 'catalog-1' })).toThrow('自身');
    expect(buildErpCatalogRequest({ ...request(), supersedesRequestId: 'catalog-old' }).supersedesRequestId).toBe('catalog-old');
  });
});
