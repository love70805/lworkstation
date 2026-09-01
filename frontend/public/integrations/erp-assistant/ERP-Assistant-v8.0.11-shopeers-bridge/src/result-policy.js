(function (global) {
    'use strict';

    function text(value) {
        return String(value === undefined || value === null ? '' : value).trim();
    }

    function canonical(value) {
        return text(value).normalize('NFKC').toLocaleUpperCase('en-US');
    }

    const ANOMALY_REASON_LABELS = Object.freeze({
        unit_price_zero: '采购单价为 0',
        unit_price_one: '采购单价为 1',
        price_differs_from_majority: '采购单价与多数记录不同',
    });

    function numericPrice(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Number(number.toFixed(4)) : null;
    }

    function priceKey(value) {
        const number = numericPrice(value);
        return number === null ? '' : number.toFixed(4);
    }

    function detectCostAnomalies(records) {
        const source = Array.isArray(records) ? records : [];
        const priced = source.map((record, index) => ({
            record,
            index,
            value: numericPrice(record && (record.unitPrice ?? record.purchaseUnitPrice)),
        })).filter((item) => item.value !== null);
        const groups = new Map();
        priced.forEach((item) => {
            const key = priceKey(item.value);
            const group = groups.get(key) || { key, value: item.value, count: 0 };
            group.count += 1;
            groups.set(key, group);
        });
        const majority = [...groups.values()]
            .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, 'en-US'))[0];
        const majorityGroup = majority && majority.count > priced.length / 2 ? majority : null;

        return source.map((record, index) => {
            const originalUnitPrice = numericPrice(record && (record.unitPrice ?? record.purchaseUnitPrice));
            const reasons = [];
            if (originalUnitPrice === 0) reasons.push('unit_price_zero');
            if (originalUnitPrice === 1) reasons.push('unit_price_one');
            if (majorityGroup && priceKey(originalUnitPrice) !== majorityGroup.key) {
                reasons.push('price_differs_from_majority');
            }
            const existingReasons = Array.isArray(record?.anomalyReasons) ? record.anomalyReasons : [];
            const mergedReasons = [...new Set([...existingReasons, ...reasons])];
            return Object.assign({}, record, {
                recordId: text(record && (record.recordId || record.id)) || 'row-' + (index + 1),
                originalUnitPrice,
                anomalyReasons: mergedReasons,
                anomalyReferenceUnitPrice: majorityGroup ? majorityGroup.value : null,
                anomalyConfirmed: mergedReasons.length === 0 ? true : Boolean(record && record.anomalyConfirmed),
            });
        });
    }

    function summarizeCostAnomalies(records) {
        const anomalies = (Array.isArray(records) ? records : []).filter((record) => (
            Array.isArray(record && record.anomalyReasons) && record.anomalyReasons.length > 0
        ));
        const anomalyRecords = anomalies.map((record, index) => ({
            recordId: text(record && (record.recordId || record.id)) || 'row-' + (index + 1),
            originalUnitPrice: numericPrice(record && (record.originalUnitPrice ?? record.unitPrice)),
            referenceUnitPrice: numericPrice(record && record.anomalyReferenceUnitPrice),
            reasons: [...new Set(record.anomalyReasons.map((reason) => text(reason)).filter(Boolean))],
            confirmed: Boolean(record && record.anomalyConfirmed),
            manualUnitPrice: numericPrice(record && record.manualUnitPrice),
            confirmedAt: text(record && record.anomalyConfirmedAt) || null,
        }));
        return {
            count: anomalyRecords.length,
            pendingCount: anomalyRecords.filter((record) => !record.confirmed).length,
            confirmedCount: anomalyRecords.filter((record) => record.confirmed).length,
            reasons: [...new Set(anomalyRecords.flatMap((record) => record.reasons))],
            records: anomalyRecords,
        };
    }

    function anomalyReasonLabel(reason) {
        return ANOMALY_REASON_LABELS[text(reason)] || text(reason);
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

    global.ShopeersErpResultPolicy = Object.freeze({
        canonical,
        anomalyReasonLabel,
        canonical1688Url,
        canonical1688OfferUrl,
        detectCostAnomalies,
        extractSupplier1688Url,
        normalizeMappings,
        summarizeCostAnomalies,
        filterResultsByMappingScope
    });
})(typeof window === 'object' ? window : globalThis);
