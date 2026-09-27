(function (global) {
    'use strict';

    function text(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function canonical(value) {
        return text(value).normalize('NFKC').toLocaleUpperCase('en-US');
    }

    const COST_WARNING_LABELS = Object.freeze({
        unit_price_zero: '采购单价为 0',
        unit_price_one: '采购单价为 1',
    });

    function numericPrice(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Number(number.toFixed(4)) : null;
    }

    function annotateCostWarnings(records) {
        const source = Array.isArray(records) ? records : [];
        return source.map((record, index) => {
            const unitPrice = numericPrice(record && (record.unitPrice ?? record.purchaseUnitPrice));
            const reasons = [];
            if (unitPrice === 0) reasons.push('unit_price_zero');
            if (unitPrice === 1) reasons.push('unit_price_one');
            const existingReasons = Array.isArray(record?.warningReasons) ? record.warningReasons : [];
            const mergedReasons = [...new Set([...existingReasons, ...reasons])];
            return Object.assign({}, record, {
                recordId: text(record && (record.recordId || record.id)) || 'row-' + (index + 1),
                warningReasons: mergedReasons,
            });
        });
    }

    function summarizeCostWarnings(records) {
        const warnings = (Array.isArray(records) ? records : []).filter((record) => (
            Array.isArray(record && record.warningReasons) && record.warningReasons.length > 0
        ));
        const warningRecords = warnings.map((record, index) => ({
            recordId: text(record && (record.recordId || record.id)) || 'row-' + (index + 1),
            unitPrice: numericPrice(record && record.unitPrice),
            reasons: [...new Set(record.warningReasons.map((reason) => text(reason)).filter(Boolean))],
        }));
        return {
            count: warningRecords.length,
            reasons: [...new Set(warningRecords.flatMap((record) => record.reasons))],
            records: warningRecords,
        };
    }

    function costWarningLabel(reason) {
        return COST_WARNING_LABELS[text(reason)] || text(reason);
    }

    function canonical1688OfferUrl(value) {
        const source = text(value);
        const direct = source.match(/https?:\/\/detail\.1688\.com\/offer\/(\d{7,20})\.html/i);
        if (direct) return 'https://detail.1688.com/offer/' + direct[1] + '.html';

        if (/(?:https?:)?\/\/[^\s"'<>]+/i.test(source)) return '';

        const embedded = source.match(/(?:offer(?:[_-]?id)?|1688(?:[_-]?offer)?)[^\d]{0,24}(\d{7,20})/i);
        return embedded ? 'https://detail.1688.com/offer/' + embedded[1] + '.html' : '';
    }

    function canonical1688Url(value) {
        const offerUrl = canonical1688OfferUrl(value);
        if (offerUrl) return offerUrl;

        const source = text(value);
        const direct = source.match(/(?:https?:)?\/\/(?:[a-z0-9-]+\.)*1688\.com(?=[\/?#\s"'<>]|$)(?:\/[^\s"'<>]*)?/i);
        if (!direct) return '';

        const normalized = direct[0].replace(/[),.;]+$/, '');
        return normalized.startsWith('//') ? 'https:' + normalized : normalized;
    }

    function extractSupplier1688Url(record) {
        const visited = new Set();
        const candidates = [];
        const offerIdCandidates = [];

        function visit(value, key, depth) {
            if (value === null || value === undefined || depth > 3) return;
            if (typeof value === 'string' || typeof value === 'number') {
                const candidate = canonical1688Url(value);
                if (candidate) candidates.push(candidate);
                if (/(?:^|[_-])(?:offer|ali(?:baba)?offer|1688offer)(?:[_-]?id)?$/i.test(key)) {
                    const offerId = text(value).match(/^\d{7,20}$/);
                    if (offerId) offerIdCandidates.push('https://detail.1688.com/offer/' + offerId[0] + '.html');
                }
                return;
            }
            if (typeof value !== 'object' || visited.has(value)) return;
            visited.add(value);
            Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey, depth + 1));
        }

        visit(record, '', 0);
        return candidates[0] || offerIdCandidates[0] || '';
    }

    function normalizeMappings(data) {
        const seen = new Set();
        const mappings = [];
        (Array.isArray(data) ? data : []).forEach((item) => {
            const platformSku = text(item && (
                item.barcodeSkuid || item.barCodeSkuid || item.barCodeSkuId || item.barcodeSku ||
                item.platformSku || item.platformSkuId || item.sku || item.skuId || item.sellerSku || item.skuCode
            ));
            const platformSkc = text(item && (
                item.barcodeSkcid || item.barCodeSkcid || item.barCodeSkcId || item.barcodeSkc ||
                item.platformSkc || item.platformSkcId || item.skc || item.skcId || item.productSkc
            ));
            if (!platformSku || !platformSkc) return;
            const key = canonical(platformSku);
            if (seen.has(key)) return;
            seen.add(key);
            mappings.push({
                platformSku,
                platformSkc,
                articleNumber: text(item && (item.barcodeArticleNumber || item.articleNumber || item.goodsNo || item.itemNo)),
                platform: text(item && (item.platform || item.platformName)),
                storeName: text(item && (item.storeName || item.store || item.shopName))
            });
        });
        mappings.sort((left, right) => {
            const skcCompare = left.platformSkc.localeCompare(right.platformSkc, 'zh-CN', { numeric: true });
            return skcCompare || left.platformSku.localeCompare(right.platformSku, 'zh-CN', { numeric: true });
        });
        return mappings;
    }

    function normalizeScope(values) {
        const seen = new Set();
        const scope = [];
        (Array.isArray(values) ? values : []).forEach((value) => {
            const original = text(value);
            const key = canonical(original);
            if (!key || seen.has(key)) return;
            seen.add(key);
            scope.push({ original, key });
        });
        return scope;
    }

    function filterResultsByMappingScope(results, values) {
        const scope = normalizeScope(values);
        const scopeKeys = new Set(scope.map((item) => item.key));
        const scoped = scopeKeys.size > 0;
        let excludedMappingCount = 0;
        let excludedWarehouseSkuCount = 0;

        const filteredResults = (Array.isArray(results) ? results : []).flatMap((result) => {
            const mappings = Array.isArray(result && result.mappings) ? result.mappings : [];
            if (!scoped) return [{ ...result, mappings: mappings.slice() }];

            const warehouseSkuMatchesScope = scopeKeys.has(canonical(result && result.warehouseSku));
            const retainedMappings = warehouseSkuMatchesScope
                ? mappings.slice()
                : mappings.filter((mapping) => (
                    scopeKeys.has(canonical(mapping && mapping.platformSku))
                    || scopeKeys.has(canonical(mapping && mapping.platformSkc))
                ));
            excludedMappingCount += mappings.length - retainedMappings.length;
            if (!warehouseSkuMatchesScope && retainedMappings.length === 0) {
                excludedWarehouseSkuCount += 1;
                return [];
            }
            return [{ ...result, mappings: retainedMappings }];
        });

        return {
            results: filteredResults,
            scope: scope.map((item) => item.original),
            scoped,
            excludedMappingCount,
            excludedWarehouseSkuCount
        };
    }

    function partitionResultsByMapping(results) {
        const mapped = [];
        const evidenceOnly = [];
        (Array.isArray(results) ? results : []).forEach((result) => {
            if (Array.isArray(result?.mappings) && result.mappings.length > 0) mapped.push(result);
            else evidenceOnly.push(result);
        });
        return { mapped, evidenceOnly };
    }

    function buildEvidenceOnlyResults({ unmappedResults = [], sourceRecords = [], excludedWarehouseSkus = [] } = {}) {
        const excluded = new Set((Array.isArray(excludedWarehouseSkus) ? excludedWarehouseSkus : []).map(canonical).filter(Boolean));
        const recordsByWarehouseSku = new Map();

        (Array.isArray(unmappedResults) ? unmappedResults : []).forEach((item) => {
            const key = canonical(item?.warehouseSku);
            if (!key || excluded.has(key)) return;
            recordsByWarehouseSku.set(key, { item, hasCalculatedResult: true });
        });
        (Array.isArray(sourceRecords) ? sourceRecords : []).forEach((item) => {
            const key = canonical(item?.warehouseSku);
            if (!key || excluded.has(key) || recordsByWarehouseSku.has(key)) return;
            recordsByWarehouseSku.set(key, { item, hasCalculatedResult: false });
        });

        return [...recordsByWarehouseSku.values()].map(({ item, hasCalculatedResult }) => {
            if (hasCalculatedResult) {
                const costWarnings = item?.costWarnings && typeof item.costWarnings === 'object'
                    ? {
                        ...item.costWarnings,
                        reasons: Array.isArray(item.costWarnings.reasons) ? item.costWarnings.reasons.slice() : [],
                        records: Array.isArray(item.costWarnings.records) ? item.costWarnings.records.map((record) => ({ ...record })) : [],
                    }
                    : { count: 0, reasons: [], records: [] };
                return {
                    ...item,
                    mappings: [],
                    details: Array.isArray(item?.details) ? item.details.map((detail) => ({ ...detail })) : [],
                    selectedRecordIds: Array.isArray(item?.selectedRecordIds) ? item.selectedRecordIds.slice() : [],
                    sourceWarnings: [...new Set([
                        ...(Array.isArray(item?.sourceWarnings) ? item.sourceWarnings.map(text).filter(Boolean) : []),
                        'evidence_only_warehouse_sku',
                        'mapping_missing_for_warehouse_sku',
                    ])],
                    costWarnings,
                };
            }

            return {
                warehouseSku: text(item?.warehouseSku),
                mappings: [],
                details: [],
                orderNumber: text(item?.purchaseOrderNo || item?.purchaseOrderId || item?.order1688),
                sourceType: 'evidence_only',
                name: text(item?.productName || item?.name),
                calcTimes: 0,
                dateRange: '',
                totalQty: null,
                totalPrice: null,
                unitCost: null,
                supplierName: text(item?.supplierName),
                supplier1688Url: text(item?.supplier1688Url),
                selectedRecordIds: [],
                sourceWarnings: [...new Set([
                    ...(Array.isArray(item?.sourceWarnings) ? item.sourceWarnings.map(text).filter(Boolean) : []),
                    'evidence_only_warehouse_sku',
                ])],
                costWarnings: { count: 0, reasons: [], records: [] },
            };
        });
    }

    function validLedgerPeriod(value) {
        return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') ? value : null;
    }

    // ERP wall-clock dates are China business dates, regardless of machine timezone.
    function purchaseDateInfo(value) {
        const raw = text(value);
        const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
        if (!match) return null;
        const [, y, m, d, h = '00', min = '00', sec = '00', fraction = '', zone = '+08:00'] = match;
        const day = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        const check = new Date(`${day}T00:00:00Z`);
        if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== day
            || Number(h) > 23 || Number(min) > 59 || Number(sec) > 59) return null;
        const timestamp = Date.parse(`${day}T${h.padStart(2, '0')}:${min}:${sec}${fraction}${zone}`);
        if (!Number.isFinite(timestamp)) return null;
        const businessDay = new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
        return { text: raw, day: businessDay, period: businessDay.slice(0, 7), timestamp };
    }

    function exactDecimal(value) {
        const match = String(value).match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
        if (!match) return null;
        const scale = (match[2] || '').length - Number(match[3] || 0);
        if (Math.abs(scale) > 100) return null;
        return { n: BigInt(match[1] + (match[2] || '')) * (scale < 0 ? 10n ** BigInt(-scale) : 1n), s: Math.max(0, scale) };
    }

    function addDecimal(a, b) {
        const s = Math.max(a.s, b.s);
        return { n: a.n * 10n ** BigInt(s - a.s) + b.n * 10n ** BigInt(s - b.s), s };
    }

    function decimalString({ n, s }) {
        const value = n.toString().padStart(s + 1, '0');
        return s ? `${value.slice(0, -s)}.${value.slice(-s)}` : value;
    }

    function previewForLedger(results, evidence, ledgerPeriod) {
        const period = validLedgerPeriod(ledgerPeriod);
        const warehouses = new Map((evidence?.warehouses || []).map(item => [canonical(item.warehouseSku), item]));
        return (results || []).map(result => {
            const warehouse = warehouses.get(canonical(result.warehouseSku));
            const selected = period ? (warehouse?.purchaseRecords || []).filter(record => {
                const date = purchaseDateInfo(record.purchaseDate);
                const cancelled = Object.values(record.statusFields || {}).some(value => /(?:^|[\s:：])(?:11|cancel(?:led)?|void(?:ed)?|已取消|取消|已作废|作废|已关闭|关闭)(?:$|[\s:：])/i.test(text(value).normalize('NFKC')));
                return record.eligible !== false && !(record.exclusionReasons || []).length && !cancelled
                    && date && date.period <= period && Number(record.quantity) > 0
                    && Number.isFinite(Number(record.quantity)) && record.unitPrice != null
                    && Number.isFinite(Number(record.unitPrice)) && Number(record.unitPrice) >= 0
                    && exactDecimal(record.quantity) && exactDecimal(record.unitPrice);
            }).sort((a, b) => purchaseDateInfo(b.purchaseDate).timestamp - purchaseDateInfo(a.purchaseDate).timestamp
                || text(b.purchaseOrderId).localeCompare(text(a.purchaseOrderId), 'zh-CN', { numeric: true })
                || text(b.recordId).localeCompare(text(a.recordId), 'zh-CN', { numeric: true })).slice(0, 3) : [];
            let qty = { n: 0n, s: 0 }, amount = { n: 0n, s: 0 };
            selected.forEach(record => {
                const q = exactDecimal(record.quantity), p = exactDecimal(record.unitPrice);
                qty = addDecimal(qty, q);
                amount = addDecimal(amount, { n: q.n * p.n, s: q.s + p.s });
            });
            const unitCost = qty.n ? decimalString({ n: amount.n * 10n ** BigInt(qty.s + 4) / (qty.n * 10n ** BigInt(amount.s)), s: 4 }) : null;
            const details = selected.map(record => ({
                recordId: record.recordId, date: record.purchaseDate,
                orderNumber: record.order1688 || record.purchaseOrderNo || record.purchaseOrderId || '',
                sourceType: record.order1688 ? '1688' : '采购单', qty: record.quantity,
                price: decimalString({ n: exactDecimal(record.quantity).n * exactDecimal(record.unitPrice).n, s: exactDecimal(record.quantity).s + exactDecimal(record.unitPrice).s }),
                unitPrice: record.unitPrice, warningReasons: record.warningReasons || [],
                supplierName: record.supplierName, supplier1688Url: record.supplier1688Url,
            }));
            const costWarnings = summarizeCostWarnings(annotateCostWarnings(selected));
            return { ...result, ledgerPeriod: period, previewStatus: !period ? 'period_unknown' : !warehouse ? 'evidence_missing' : !selected.length ? 'no_purchase' : 'ready',
                calcTimes: selected.length, selectedRecordIds: selected.map(record => record.recordId), details,
                unitCost, proposedUnitCost: unitCost, totalQty: qty.n ? decimalString(qty) : null,
                totalPrice: qty.n ? decimalString(amount) : null,
                dateRange: selected.length ? `${selected.at(-1).purchaseDate} ~ ${selected[0].purchaseDate}` : '',
                orderNumber: details.map(detail => detail.orderNumber).join(' / '),
                sourceType: [...new Set(details.map(detail => detail.sourceType))].join(' / '),
                supplierName: selected[0]?.supplierName || '',
                supplier1688Url: selected.find(record => record.supplier1688Url)?.supplier1688Url || '',
                costWarnings, costWarningCount: costWarnings.count,
            };
        });
    }

    global.ShopeersErpResultPolicy = Object.freeze({
        validLedgerPeriod,
        purchaseDateInfo,
        previewForLedger,
        canonical,
        annotateCostWarnings,
        canonical1688Url,
        canonical1688OfferUrl,
        costWarningLabel,
        extractSupplier1688Url,
        buildEvidenceOnlyResults,
        normalizeMappings,
        partitionResultsByMapping,
        summarizeCostWarnings,
        filterResultsByMappingScope
    });
})(typeof window === 'object' ? window : globalThis);
