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

    global.ShopeersErpResultPolicy = Object.freeze({
        canonical,
        annotateCostWarnings,
        canonical1688Url,
        canonical1688OfferUrl,
        costWarningLabel,
        extractSupplier1688Url,
        normalizeMappings,
        summarizeCostWarnings,
        filterResultsByMappingScope
    });
})(typeof window === 'object' ? window : globalThis);
