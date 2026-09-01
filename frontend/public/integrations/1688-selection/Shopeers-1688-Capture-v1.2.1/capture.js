/**
 * 选品工作台 Chrome 扩展 · 1688 确认订单采集引擎 24.0
 *
 * 页面脚本只读取订单 DOM 并生成采集数据。连接密钥、端口探测和
 * 本机网络请求全部由扩展 Service Worker 处理。
 */

(function() {
    'use strict';

    const ExtensionBridge = globalThis.SelectionWorkbenchExtensionBridge;
    if (!ExtensionBridge) {
        console.error('[选品采集助手] 扩展通信桥未加载');
        return;
    }

    // ═════════════════════════════════════════════
    //  UTILS
    // ═════════════════════════════════════════════

    const $ = (sel, ctx) => (ctx || document).querySelector(sel);
    const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
    const cleanText = (s) => (s || '').replace(/[\s\u3000]+/g, '');

    const clampRange = (val, min, max) => {
        const n = parseInt(val, 10);
        if (isNaN(n)) return null;
        if (n < min) return null;
        if (n > max) return null;
        return n;
    };

    const extractNumber = (text) => {
        const m = String(text).match(/(\d+(?:\.\d+)?)/);
        return m ? parseFloat(m[1]) : null;
    };

    const parseMoneyNumber = (value) => {
        const normalized = String(value ?? '').replace(/,/g, '');
        const number = Number(normalized);
        return Number.isFinite(number) ? number : null;
    };

    /** 从文本中提取第一组 ¥/￥ 后面的金额，支持 ¥1,190.00 */
    const extractPrice = (text) => {
        const m = String(text).match(/[¥￥]\s*(\d[\d,]*(?:\.\d+)?)/);
        return m ? parseMoneyNumber(m[1]) : null;
    };

    const EXTRACTOR_VERSION = 'chrome-extension/1.1.2';

    function createRequestId() {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
        const random = Math.random().toString(36).slice(2);
        return `${Date.now().toString(36)}-${random}-${random.slice(0, 6)}`;
    }

    function parsePriceRange(rawPrice) {
        const numbers = String(rawPrice || '')
            .replace(/,/g, '')
            .match(/\d+(?:\.\d+)?/g);
        const values = (numbers || [])
            .map(Number)
            .filter(value => Number.isFinite(value) && value >= 0);
        if (values.length === 0) return { purchasePrice: null, priceMin: null, priceMax: null };
        return {
            purchasePrice: values[0],
            priceMin: Math.min(...values),
            priceMax: Math.max(...values)
        };
    }

    function checkoutConsistencyWarnings(checkout, skus) {
        if (!Array.isArray(skus) || skus.length === 0) {
            return [{
                code: 'missing_checkout_skus',
                field: 'product.skus',
                message: '确认订单页未识别到逐行规格，请在工作台重点核对规格和单价'
            }];
        }

        const warnings = [];
        const quantities = skus.map(sku => Number(sku.qty));
        const hasAllQuantities = skus.every(
            sku => sku.qty !== null
                && sku.qty !== undefined
                && Number.isFinite(Number(sku.qty))
                && Number(sku.qty) > 0
        );
        if (hasAllQuantities) {
            const quantitySum = quantities.reduce((sum, value) => sum + value, 0);
            if (Number.isFinite(Number(checkout?.qty)) && Math.abs(quantitySum - Number(checkout.qty)) > 0.0001) {
                warnings.push({
                    code: 'checkout_qty_mismatch',
                    field: 'product.skus',
                    message: `SKU 数量合计 ${quantitySum} 与订单总数量 ${checkout.qty} 不一致`
                });
            }
        } else {
            warnings.push({
                code: 'checkout_sku_qty_incomplete',
                field: 'product.skus',
                message: '部分 SKU 未识别到实际采购数量'
            });
        }

        const subtotals = skus.map(sku => Number(sku.lineSubtotal));
        const hasAllSubtotals = skus.every(
            sku => sku.lineSubtotal !== null
                && sku.lineSubtotal !== undefined
                && Number.isFinite(Number(sku.lineSubtotal))
                && Number(sku.lineSubtotal) >= 0
        );
        if (hasAllSubtotals) {
            const subtotalSum = subtotals.reduce((sum, value) => sum + value, 0);
            if (Number.isFinite(Number(checkout?.total)) && Math.abs(subtotalSum - Number(checkout.total)) > 0.02) {
                warnings.push({
                    code: 'checkout_total_adjustment',
                    field: 'product.skus',
                    message: `SKU 逐行合计 ${subtotalSum.toFixed(2)}，商品总计 ${Number(checkout.total).toFixed(2)}；可能存在订单级优惠或活动调整，已保持原值且不分摊到长期成本`
                });
            }
        } else {
            warnings.push({
                code: 'checkout_sku_subtotal_incomplete',
                field: 'product.skus',
                message: '部分 SKU 未识别到商品小计'
            });
        }
        return warnings;
    }

    function toCaptureEnvelope(data) {
        const idUrl = DOMExtractors.getIdAndUrl();
        const prices = parsePriceRange(data.price);
        const warnings = (data._errors || []).map((entry, index) => {
            if (entry && typeof entry === 'object') {
                const warning = {
                    code: String(entry.code || `extract_warning_${index + 1}`).slice(0, 64),
                    message: String(entry.message || '采集字段需要确认').slice(0, 500)
                };
                if (entry.field) warning.field = String(entry.field).slice(0, 128);
                return warning;
            }
            return {
                code: `extract_warning_${index + 1}`,
                message: String(entry).slice(0, 500)
            };
        });
        if (!data.imageUrl) warnings.push({ code: 'missing_image', field: 'product.imageUrl', message: '未提取到商品主图' });
        if (prices.purchasePrice === null) warnings.push({ code: 'missing_price', field: 'product.purchasePrice', message: '未提取到采购价格' });
        if (!idUrl.id) warnings.push({ code: 'missing_product_id', field: 'product.sourceProductId', message: '未识别到平台商品 ID' });
        if (data.captureScene !== 'checkout') {
            warnings.push({
                code: 'detail_price_estimate',
                field: 'product.purchasePrice',
                message: '详情页价格可能是阶梯价或限量优惠；建议在确认订单页按实际规格和数量重新采集'
            });
        } else {
            if (!data.qty) warnings.push({ code: 'missing_checkout_qty', field: 'product.purchaseQty', message: '确认订单页未识别到本次采购数量' });
            if (data.shippingFee === null || data.shippingFee === undefined) {
                warnings.push({ code: 'missing_checkout_shipping', field: 'product.shippingFee', message: '确认订单页未识别到整单运费' });
            }
        }

        return {
            schemaVersion: 1,
            requestId: createRequestId(),
            source: idUrl.platform,
            sourceUrl: idUrl.url,
            capturedAt: data.capturedAt || Date.now(),
            extractorVersion: EXTRACTOR_VERSION,
            product: {
                name: data.name || '',
                sourceProductId: idUrl.id || '',
                imageUrl: data.imageUrl || '',
                purchasePrice: prices.purchasePrice,
                priceMin: prices.priceMin,
                priceMax: prices.priceMax,
                rawPrice: String(data.price || ''),
                shippingFee: data.shippingFee ?? null,
                purchaseQty: data.qty ?? null,
                bundleQty: null,
                platformSkc: data.platformSkc || '',
                skus: Array.isArray(data.skus) ? data.skus.map(sku => ({
                    spec: String(sku.spec || ''),
                    sourceSkuId: String(sku.platformSku || ''),
                    purchasePrice: Number.isFinite(Number(sku.cost)) ? Number(sku.cost) : null,
                    imageUrl: sku.imageUrl || '',
                    purchaseQty: Number.isFinite(Number(sku.qty)) && Number(sku.qty) > 0 ? Number(sku.qty) : null,
                    lineSubtotal: Number.isFinite(Number(sku.lineSubtotal)) && Number(sku.lineSubtotal) >= 0 ? Number(sku.lineSubtotal) : null
                })) : []
            },
            warnings
        };
    }

    async function sendToWorkbench(envelope) {
        return ExtensionBridge.sendCapture(envelope);
    }

    function copyFallback(data) {
        const json = JSON.stringify(data);
        try {
            ExtensionBridge.copyText(json);
            return true;
        } catch (_) {
            try {
                navigator.clipboard.writeText(json);
                return true;
            } catch (_) {
                const ta = document.createElement('textarea');
                ta.value = json;
                ta.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(ta);
                ta.select();
                const copied = document.execCommand('copy');
                document.body.removeChild(ta);
                return copied;
            }
        }
    }

    // ═════════════════════════════════════════════
    //  PLATFORM DETECTION
    // ═════════════════════════════════════════════

    const Platform = {
        is1688()   { return location.hostname.includes('1688.com'); },
        isTaobao() { return location.hostname.includes('taobao.com'); },
        isTmall()  { return location.hostname.includes('tmall.com'); },
        isCheckout() {
            const title = document.title || '';
            const url = location.href || '';
            return title.includes('确认订单') || title.includes('订单确认') || title.includes('提交订单')
                || (title.includes('结算') && !title.includes('购物车'))
                || /(?:buy|trade|order)\.[^/]+\/[^?#]*(?:confirm|checkout|order|trade)/i.test(url);
        }
    };

    // ═════════════════════════════════════════════
    //  STRUCTURED DATA EXTRACTORS (优先)
    // ═════════════════════════════════════════════

    const StructuredData = {
        /** 尝试从页面内嵌的结构化数据中提取信息 */
        getJsonLd() {
            try {
                const scripts = $$('script[type="application/ld+json"]');
                for (const s of scripts) {
                    const data = JSON.parse(s.textContent);
                    // Product 或 Offer schema
                    const graph = data['@graph'] || [data];
                    for (const item of (Array.isArray(graph) ? graph : [graph])) {
                        if (item['@type'] === 'Product' || item['@type'] === 'Offer') {
                            return {
                                name: item.name || item.alternateName || '',
                                image: Array.isArray(item.image) ? item.image[0] : (item.image || ''),
                                price: item.offers?.price || item.price || '',
                                url: item.url || item.offers?.url || ''
                            };
                        }
                    }
                }
            } catch (_) {}
            return null;
        },

        /** 1688 detail 页的 __INITIAL_STATE__ */
        get1688State() {
            try {
                const raw = window.__INITIAL_STATE__ || window.__PRELOADED_STATE__;
                if (!raw) return null;
                const detail = raw?.offerDetail || raw?.detail || raw?.offer || {};
                return {
                    name: detail.title || detail.subject || '',
                    image: (detail.mainImage || detail.imageList?.[0] || ''),
                    price: detail.price || detail.priceRange?.[0]?.price || ''
                };
            } catch (_) {}
            return null;
        },

        /** 淘宝/天猫的页面内嵌数据 */
        getTaobaoState() {
            try {
                const scripts = $$('script');
                for (const s of scripts) {
                    const t = s.textContent || '';
                    // g_config 中的商品数据
                    const m = t.match(/"?item\s*(?:Detail|Info)"?\s*:\s*(\{.+?\})\s*[,\n]/s);
                    if (m) {
                        try {
                            const data = JSON.parse(m[1]);
                            return {
                                name: data.title || '',
                                image: data.images?.[0] || '',
                                price: data.price || ''
                            };
                        } catch (_) {}
                    }
                }
            } catch (_) {}
            return null;
        },

        /** 聚合所有结构化数据源 */
        all() {
            return this.getJsonLd()
                || (Platform.is1688() && this.get1688State())
                || ((Platform.isTaobao() || Platform.isTmall()) && this.getTaobaoState())
                || null;
        }
    };

    // ═════════════════════════════════════════════
    //  DOM-BASED EXTRACTORS (降级)
    // ═════════════════════════════════════════════

    const DOMExtractors = {
        /** 提取 offer ID / item ID 和商品链接 */
        getIdAndUrl() {
            // 1688: offer/数字.html
            const url1688 = location.href.match(/offer\/(\d{7,16})\.html/i);
            if (url1688) {
                return { id: url1688[1], url: `https://detail.1688.com/offer/${url1688[1]}.html`, platform: '1688' };
            }

            // 淘宝/天猫: ?id=数字
            const urlTb = location.search.match(/[?&]id=(\d{7,16})/i);
            if (urlTb) {
                const base = Platform.isTmall()
                    ? 'https://detail.tmall.com/item.htm?id='
                    : 'https://item.taobao.com/item.htm?id=';
                return { id: urlTb[1], url: base + urlTb[1], platform: Platform.isTmall() ? 'tmall' : 'taobao' };
            }

            // 商品页内链接兜底
            const allLinks = $$('a[href]');
            const offerLink = allLinks.find(a => /\/offer\/(\d{7,16})\.html/i.test(a.href));
            if (offerLink) {
                const m = offerLink.href.match(/\/offer\/(\d{7,16})\.html/i);
                return { id: m[1], url: `https://detail.1688.com/offer/${m[1]}.html`, platform: '1688' };
            }

            const itemLink = allLinks.find(a => /[?&]id=(\d{7,16})/i.test(a.href) && /item\.htm|detail\.tmall/i.test(a.href));
            if (itemLink) {
                const m = itemLink.href.match(/[?&]id=(\d{7,16})/i);
                const base = Platform.isTmall()
                    ? 'https://detail.tmall.com/item.htm?id='
                    : 'https://item.taobao.com/item.htm?id=';
                return { id: m[1], url: base + m[1], platform: Platform.isTmall() ? 'tmall' : 'taobao' };
            }

            // 结算页：搜索页面源码中的 offerId
            if (Platform.isCheckout()) {
                const pageHtml = document.body.innerHTML;
                const offerMatch = pageHtml.match(/"offerId"\s*:\s*"?(\d{7,16})"?/i) || pageHtml.match(/offer\/(\d{7,16})\.html/i);
                if (offerMatch) {
                    return { id: offerMatch[1], url: `https://detail.1688.com/offer/${offerMatch[1]}.html`, platform: '1688' };
                }
            }

            return { id: '', url: location.href.split('?')[0], platform: 'unknown' };
        },

        /** 从订单结算页提取价格/运费/数量（仅当前商品） */
        getCheckoutData() {
            const allText = cleanText(document.body.innerText);
            let shipping = null;
            let shippingGross = null;
            let shippingDiscount = 0;
            let qty = null;
            let total = null;
            let totalNeedsShippingDeduction = false;
            const seenShippingDiscounts = new Set();

            // 1688 新版确认订单页：优先读取右侧店铺汇总行。
            // 这些节点把商品总计和运费分开，避免误读服务费、优惠或 SKU 小计。
            const summaryRows = $$('.order-footer .list-item, .sub-summary-items .list-item');
            for (const row of summaryRows) {
                const text = cleanText(row.innerText || row.textContent || '');
                if (/^(?:商品总计|商品总价|商品小计)/.test(text)) {
                    const quantityMatch = text.match(/(\d+)种(\d+)件/);
                    if (quantityMatch) qty = parseInt(quantityMatch[2], 10);
                    const subtotal = extractPrice(text);
                    if (subtotal !== null) total = subtotal;
                } else if (/^(?:总运费|运费|快递运费|物流)/.test(text)) {
                    const freight = extractPrice(text);
                    if (freight !== null) {
                        shippingGross = freight;
                        shipping = freight;
                    }
                } else if (
                    /(?:(?:运费|物流).*(?:补贴|优惠)|(?:补贴|优惠).*(?:运费|物流))/.test(text)
                    && !seenShippingDiscounts.has(text)
                ) {
                    const discount = extractPrice(text);
                    if (discount !== null) {
                        shippingDiscount += discount;
                        seenShippingDiscounts.add(text);
                    }
                }
            }

            // ── 运费 ──
            if (shipping === null) {
                const shipMatch = allText.match(/(?:总运费|运费|快递运费|物流)[^¥￥\d]*[¥￥](\d[\d,]*(?:\.\d+)?)/);
                if (shipMatch) {
                    shippingGross = parseMoneyNumber(shipMatch[1]);
                    shipping = shippingGross;
                }
                else if (allText.includes('包邮') || allText.includes('免运费')) shipping = 0;
            }

            // 明确标注为物流/运费补贴的金额会直接抵扣本单物流成本。
            // 例如：总运费 40.00 - 官方物流补贴 16.73 = 实际承担运费 23.27。
            if (shippingDiscount <= 0) {
                const discountMatch = allText.match(
                    /(?:(?:官方)?(?:物流|运费)(?:补贴|优惠)|(?:补贴|优惠)(?:物流|运费))[^¥￥\d]*(?:减)?[¥￥]\s*(\d[\d,]*(?:\.\d+)?)/
                );
                if (discountMatch) shippingDiscount = parseMoneyNumber(discountMatch[1]);
            }
            if (shipping !== null && shippingDiscount > 0) {
                shippingGross = shippingGross ?? shipping;
                shipping = Math.max(0, Number((shippingGross - shippingDiscount).toFixed(2)));
            }

            // ── 数量（关键修复：只取当前商品行的数量，不求和）──
            // 方案A：找到"X种Y件"中的 Y（总件数）
            if (!qty || qty <= 0) {
                const qMatch = allText.match(/(\d+)种(\d+)件/);
                if (qMatch) qty = parseInt(qMatch[2], 10); // qMatch[2] = 总件数，qMatch[1] = 品种数
            }

            // 方案B：如果只有一件商品，用汇总数
            if (!qty || qty <= 0) {
                const totalMatch = allText.match(/(?:共|总计|合计|总数)[^\d]*(\d+)(?:件|个)/);
                if (totalMatch) qty = parseInt(totalMatch[1], 10);
            }

            // 方案C：定位当前商品行的数量输入框
            if (!qty || qty <= 0) {
                // 按商品行找数量控件，取第一个（当前页面的第一个商品）
                const rows = $$('[class*="item"], [class*="product"], [class*="goods"], [class*="orderItem"], [class*="order-item"], [class*="line"]');
                for (const row of rows) {
                    const inputs = $$('input[type="number"], input[type="text"]', row).filter(el => {
                        const v = parseInt(el.value, 10);
                        return v >= 1 && v <= 99999
                            && el.readOnly !== true
                            && el.disabled !== true;
                    });
                    if (inputs.length > 0) {
                        qty = parseInt(inputs[0].value, 10);
                        break;
                    }
                }
            }

            // 方案D：页面唯一数量输入框
            if (!qty || qty <= 0) {
                const allInputs = $$('input[type="number"], input[type="text"]').filter(el => {
                    const v = parseInt(el.value, 10);
                    return v >= 1 && v <= 99999
                        && el.readOnly !== true
                        && el.disabled !== true;
                });
                if (allInputs.length === 1) {
                    qty = parseInt(allInputs[0].value, 10);
                }
            }

            // ── 总价（核心修复：必须用"商品总计"，不能直接用"合计"）──
            // 错误案例：合计=283.20 = 商品总计266 + 运费18.20 - 补贴1
            //   V22.0 旧逻辑：(283.20 - 18.20) / 100 = 2.65   ← 漏了 1 元补贴
            //   正确逻辑：266.00 / 100 = 2.66
            // "商品总计" = 单价 × 数量，是最准确的成本基础
            // 主路径：定位"商品总计"位置，取其后第一个 ¥XX.XX
            // 不能用 [^¥￥\d]{0,15} —— 实际页面"商品总计1种100件已减14.00"中间有数字
            if (total === null) {
                const subtotalKeywords = ['商品总计', '商品总价', '商品小计', '应付小计'];
                for (const kw of subtotalKeywords) {
                    const idx = allText.indexOf(kw);
                    if (idx < 0) continue;
                    const after = allText.slice(idx + kw.length);
                    const priceMatch = after.match(/[¥￥]\s*(\d[\d,]*(?:\.\d+)?)/);
                    if (priceMatch) {
                        total = parseMoneyNumber(priceMatch[1]);
                        break;
                    }
                }
            }

            // 兜底：应付总额/实付款/实付合计（这种total仍含运费，需扣减）
            if (total === null) {
                const grandMatch = allText.match(/(?:应付总额|实付款|实付合计|合计应付)[^¥￥\d]*[¥￥](\d[\d,]*(?:\.\d+)?)/);
                if (grandMatch) {
                    total = parseMoneyNumber(grandMatch[1]);
                    totalNeedsShippingDeduction = true;
                }
            }

            // ── 计算单价 ──
            let price = null;
            if (total !== null && qty && qty > 0) {
                if (totalNeedsShippingDeduction) {
                    // 兜底分支：合计 - 运费（不完美，但比旧版准确一点）
                    const ship = shipping || 0;
                    price = ((total - ship) / qty).toFixed(2);
                } else {
                    // 主路径：商品总计 ÷ 数量 = 真实单价
                    price = (total / qty).toFixed(2);
                }
            }

            return { price, shipping, shippingGross, shippingDiscount, qty, total };
        },

        /** 从结算页逐行提取 SKU 明细 */
        getCheckoutSkus() {
            const skus = [];
            const seen = new Set();

            // 1688 新版确认订单页：一条 .cargo-container 对应一个实际下单规格。
            // 优先读取页面明确标注的最终单价、数量和小计，避免把优惠金额误当 SKU 单价。
            const cargoRows = $$('.cargo-container');
            for (const row of cargoRows) {
                const specElement = $('.cargo-spec, .spec-item', row);
                const priceElement = $('.final-unit-price, .cargo-unit-price', row);
                const quantityElement = $('q-inputnumber, input[type="number"]', row);
                const subtotalElement = $('.cargo-amount', row);
                const imageElement = $('.cargo-thumb, img', row);

                const spec = (specElement?.innerText || specElement?.textContent || '')
                    .trim()
                    .replace(/\s+/g, ' ');
                const unitPrice = extractPrice(priceElement?.innerText || priceElement?.textContent || '');
                const quantity = Number(
                    quantityElement?.getAttribute?.('value')
                    || quantityElement?.value
                    || 0
                );
                const lineSubtotal = extractPrice(subtotalElement?.innerText || subtotalElement?.textContent || '');
                const sourceSkuId = String(
                    row.getAttribute?.('data-sku-id')
                    || row.getAttribute?.('data-skuid')
                    || ''
                );

                if (!spec || unitPrice === null) continue;
                const dedupKey = `${spec}|${sourceSkuId}`;
                if (seen.has(dedupKey)) continue;
                seen.add(dedupKey);

                skus.push({
                    spec,
                    imageUrl: imageElement?.src || imageElement?.getAttribute?.('src') || '',
                    platformSku: sourceSkuId,
                    cost: unitPrice,
                    price: unitPrice,
                    qty: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
                    lineSubtotal: lineSubtotal === null ? null : lineSubtotal
                });
            }
            if (skus.length > 0) return skus;

            // 旧版结算页文本降级。
            const allText = cleanText(document.body.innerText);

            // 全局匹配 "规格型号:XXX" 或 "规格:XXX"，提取每个变体
            const specRegex = /(?:规格型号|规格)[：:]\s*([^￥\xA5]{2,80}?)(?=\s*[￥\xA5])/g;
            let m;
            while ((m = specRegex.exec(allText)) !== null) {
                let spec = m[1].trim();
                if (spec.length < 2) continue;

                // 噪音过滤（精简版：只过滤明显的非商品文本）
                if (/^(?:留言|店铺明细|商品总计|运费|合计|提前续费|PLUS|红包|补贴|限时解锁)$/.test(spec)) continue;

                const dedupKey = spec.substring(0, 20);
                if (seen.has(dedupKey)) continue;
                seen.add(dedupKey);

                // 从匹配位置往后80字符内提取价格
                const startIdx = m.index;
                const nearby = allText.substring(startIdx, Math.min(startIdx + 150, allText.length));
                const priceMatches = nearby.match(/[￥\xA5]\s*(\d[\d,]*(?:\.\d+)?)/g);
                if (!priceMatches) continue;

                const prices = priceMatches.map(function(p) {
                    return parseMoneyNumber(p.replace(/[￥\xA5\s]/g, ''));
                }).filter(function(p) { return p > 0 && p < 9999; });
                if (prices.length === 0) continue;

                const unitPrice = Math.min.apply(null, prices);

                // 图片：从页面找包含颜色关键词的图片
                let imageUrl = '';
                const allImgs = document.querySelectorAll('img');
                for (const img of allImgs) {
                    const src = img.src || '';
                    if (src && src.includes('alicdn.com') && !src.includes('svg') && !src.includes('tps-')) {
                        if (!imageUrl) imageUrl = src;
                    }
                }

                skus.push({
                    spec: spec,
                    imageUrl: imageUrl,
                    platformSku: '',
                    cost: unitPrice,
                    price: unitPrice,
                    qty: null,
                    lineSubtotal: null
                });
            }

            return skus.length > 0 ? skus : null;
        },

                getCheckoutTitle() {
            // 方法1：商品链接文字
            const productLinks = $$('a[href*="offer/"], a[href*="item.htm"], a[href*="detail.tmall.com"]')
                .filter(function(a) {
                    const t = (a.innerText || '').trim();
                    return t.length > 6
                        && !/有限(?:责任)?公司/.test(t)
                        && !/(?:厂|商行|店|官方旗舰店|自营|[店铺])$/.test(t)
                        && !/^(?:颜色|规格|尺寸|尺码|版本|款式|型号)[：:]/.test(t)
                        && !/发货|送达|退货|物流/.test(t);
                });
            productLinks.sort(function(a, b) { return b.innerText.trim().length - a.innerText.trim().length; });
            if (productLinks.length > 0) {
                const t = productLinks[0].innerText.trim();
                if (t.length > 3 && t.length < 200) return t;
            }

            // 方法2：从页面正文规格型号前提取
            const allText = cleanText(document.body.innerText);
            const specIdx = allText.search(/(?:规格型号|规格)[：:]/);
            if (specIdx > 5) {
                const beforeSpec = allText.substring(0, specIdx).trim();
                const parts = beforeSpec.split(/[\n\r]+/);
                for (let i = parts.length - 1; i >= 0; i--) {
                    const line = parts[i].trim();
                    if (line.length > 6 && line.length < 200 && !/确认订单|结算|提交|阿里巴巴/.test(line)) return line;
                }
            }

            // 方法3：取正文前80字符
            const firstLine = allText.split(/[\n\r]+/)[0] || '';
            return firstLine.substring(0, 80).trim() || null;
        },

        /** 从普通商品页提取标题 */
        getPageTitle() {
            const ogTitle = $('meta[property="og:title"]');
            if (ogTitle?.content) {
                const title = cleanText(ogTitle.content);
                if (title.length >= 4 && title.length <= 300) return title;
            }

            const selectors = [
                'h1',
                '[class*="title"] h1',
                '[class*="Title"] h1',
                '[data-testid*="title"]'
            ];
            for (const selector of selectors) {
                const element = $(selector);
                const title = cleanText(element?.innerText || element?.textContent || '');
                if (title.length >= 4 && title.length <= 300) return title;
            }

            return cleanText(document.title || '').replace(/\s*[-–—|]\s*(?:阿里巴巴|淘宝网|天猫).*$/i, '');
        },

        /** 从普通商品页提取主图 */
        getImage() {
            if (Platform.isCheckout()) {
                const checkoutImage = $('.offer-thumb, .cargo-thumb');
                const checkoutSrc = checkoutImage?.src || checkoutImage?.getAttribute?.('src') || '';
                if (checkoutSrc && !checkoutSrc.startsWith('data:')) {
                    return checkoutSrc.replace(/^\/\//, 'https://');
                }
            }

            // og:image
            const ogImg = $('meta[property="og:image"]');
            if (ogImg && ogImg.content && !ogImg.content.startsWith('data:')) {
                return ogImg.content.replace(/^\/\//, 'https://');
            }

            // 图片：优先 CDN 大图，排除 Logo/图标/广告
            const allImgs = $$('img').filter(img => {
                const src = img.src || img.getAttribute('data-src') || '';
                if (!src || src.startsWith('data:')) return false;
                const w = img.clientWidth || img.naturalWidth || 0;
                const h = img.clientHeight || img.naturalHeight || 0;
                if (w < 40 || h < 40) return false;
                // 排除明显非商品图
                const parentClass = (img.parentElement?.className || '') + (img.className || '');
                if (/logo|icon|avatar|banner|ad|广告|二维码/i.test(parentClass)) return false;
                if (/logo|icon|avatar|qrcode|weixin|wechat/i.test(src)) return false;
                return true;
            });

            // 优先 CDN 图
            const cdnImgs = allImgs.filter(img =>
                /(?:alicdn|taobaocdn|tmall|1688|img\.alibaba)\.com/i.test(img.src || img.getAttribute('data-src'))
            );
            const candidates = cdnImgs.length > 0 ? cdnImgs : allImgs;

            if (candidates.length > 0) {
                // 取面积最大的
                candidates.sort((a, b) => {
                    const aArea = (a.clientWidth || 0) * (a.clientHeight || 0);
                    const bArea = (b.clientWidth || 0) * (b.clientHeight || 0);
                    return bArea - aArea;
                });
                let img = candidates[0].src || candidates[0].getAttribute('data-src');
                if (img.startsWith('//')) img = 'https:' + img;
                // 去掉尺寸后缀
                img = img.replace(/_\d+x\d+[a-zA-Z0-9_]*\./, '.');
                img = img.replace(/\.jpg_.*\.jpg$/, '.jpg');
                img = img.replace(/\.png_.*\.png$/, '.png');
                return img;
            }

            // 非商品页（结算页）取小图
            const smallImgs = $$('img').filter(img => {
                const w = img.clientWidth || img.naturalWidth || 0;
                return w >= 40 && w <= 220 && img.src && !img.src.startsWith('data:');
            });
            if (smallImgs.length > 0) {
                let img = smallImgs[0].src;
                if (img.startsWith('//')) img = 'https:' + img;
                return img;
            }

            return '';
        },

        /** 普通商品页的价格 */
        getPrice() {
            const selectors = [
                'span[class*="price"]', '.price-text', '.price-value', '.tb-rmb-num',
                '[class*="Price"]', '[class*="current-price"]', '.mod-price',
            ];
            for (const sel of selectors) {
                const el = $(sel);
                if (el) {
                    const num = extractNumber(el.innerText);
                    if (num !== null && num > 0 && num < 10000000) return String(num);
                }
            }
            return null;
        }
    };

    // ═════════════════════════════════════════════
    //  TITLE SANITIZER
    // ═════════════════════════════════════════════

    const JUNK_PATTERNS = [
        /退货[包保]运费/g,    /48小时发货/g,      /跨境无忧/g,
        /极速退款/g,          /晚发必赔/g,        /少发必赔/g,
        /破损包赔/g,          /材质保障/g,        /交期保障/g,
        /支持定制/g,          /一件代发/g,        /[七7]天无理由退货/g,
        /[包免]邮/g,         /运费[险]?/g,       /满\d减\d/g,
        /新人首单/g,          /限时折扣/g,        /[初首]单立减/g,
        /官方[直旗]营/g,
    ];

    function sanitizeTitle(title) {
        if (!title) return '';
        let cleaned = title;
        for (const pattern of JUNK_PATTERNS) {
            cleaned = cleaned.replace(pattern, '');
        }
        return cleaned.replace(/\s+/g, ' ').trim();
    }

    // ═════════════════════════════════════════════
    //  MAIN EXTRACTION LOGIC
    // ═════════════════════════════════════════════

    function extractAll() {
        const errors = [];
        const result = {
            source: 'smart-table-helper',
            name: '',
            imageUrl: '',
            price: '',
            shippingFee: null,
            qty: null,
            spu: '',           // SKC编码（用户手动填写）
            platformSkc: '',
            skus: null,
            supplierLink: '',
            captureScene: Platform.isCheckout() ? 'checkout' : 'detail',
            capturedAt: Date.now(),
            _errors: errors,
        };

        // ── Step 1: 结构化数据（优先） ──
        let structured = null;
        try {
            structured = StructuredData.all();
        } catch (e) {
            errors.push('结构化数据提取异常: ' + e.message);
        }

        // ── Step 2: ID & URL ──
        try {
            const idUrl = DOMExtractors.getIdAndUrl();
            result.supplierLink = idUrl.url || '';
        } catch (e) {
            errors.push('链接提取失败: ' + e.message);
        }

        // ── Step 3: 分场景处理 ──
        if (Platform.isCheckout()) {
            // ── 结算页 ──
            let checkoutFacts = null;
            try {
                checkoutFacts = DOMExtractors.getCheckoutData();
                result.price = checkoutFacts.price || '';
                result.shippingFee = checkoutFacts.shipping;
                result.qty = checkoutFacts.qty;
            } catch (e) {
                errors.push('结算数据提取失败: ' + e.message);
            }

            try {
                const title = DOMExtractors.getCheckoutTitle();
                result.name = sanitizeTitle(title)
                    || (structured?.name || '')
                    || '新采集商品';
            } catch (e) {
                result.name = structured?.name || '新采集商品';
                errors.push('标题提取失败: ' + e.message);
            }

            try {
                result.imageUrl = DOMExtractors.getImage()
                    || (structured?.image || '');
            } catch (e) {
                result.imageUrl = structured?.image || '';
                errors.push('图片提取失败: ' + e.message);
            }

            // 提取 SKU 明细
            try {
                result.skus = DOMExtractors.getCheckoutSkus();
                errors.push(...checkoutConsistencyWarnings(checkoutFacts, result.skus));
            } catch (e) {
                errors.push('SKU提取失败: ' + e.message);
            }

        } else {
            // ── 普通商品页 ──
            result.name = sanitizeTitle(
                structured?.name
                || DOMExtractors.getPageTitle()
                || document.title.replace(/\s*[-–—|].*$/, '').trim()
            );

            result.imageUrl = structured?.image
                || DOMExtractors.getImage()
                || '';

            const price = structured?.price
                || DOMExtractors.getPrice()
                || '';
            result.price = String(price);

            // 普通页运费：优先检查页面上的运费信息
            try {
                const allText = cleanText(document.body.innerText);
                if (allText.includes('包邮') || allText.includes('免运费')) {
                    result.shippingFee = 0;
                } else {
                    const sm = allText.match(/(?:运费|快递)[^\d]*(\d+(?:\.\d+)?)/);
                    if (sm) result.shippingFee = parseFloat(sm[1]);
                    else result.shippingFee = null;  // 不填假数据
                }
            } catch (_) {
                result.shippingFee = null;
            }
        }

        return result;
    }

    // ═════════════════════════════════════════════
    //  UI: BUTTON & TOAST SYSTEM
    // ═════════════════════════════════════════════

    // CSS 注入（hover等完全用CSS，不在HTML里写onmouseover）
    ExtensionBridge.addStyle(`
        .stg-btn {
            position: fixed;
            bottom: 40px;
            right: 40px;
            height: 42px;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(0,0,0,0.1);
            box-shadow: 0 8px 24px rgba(0,122,255,0.2);
            border-radius: 21px;
            padding: 0 16px;
            cursor: pointer;
            z-index: 9999999;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
            user-select: none;
            -webkit-user-select: none;
        }
        .stg-btn:hover {
            transform: scale(1.08);
            box-shadow: 0 12px 32px rgba(0,122,255,0.3);
            border-color: rgba(0,122,255,0.3);
        }
        .stg-btn:active {
            transform: scale(0.96);
            transition: all 0.08s ease-out;
        }
        .stg-btn.stg-success {
            background: rgba(52, 199, 89, 0.12);
            border-color: rgba(52, 199, 89, 0.4);
            box-shadow: 0 4px 16px rgba(52, 199, 89, 0.3);
        }
        .stg-btn.stg-error {
            background: rgba(255, 59, 48, 0.12);
            border-color: rgba(255, 59, 48, 0.4);
            box-shadow: 0 4px 16px rgba(255, 59, 48, 0.3);
        }
        .stg-btn.stg-error:hover {
            box-shadow: 0 12px 32px rgba(255, 59, 48, 0.35);
        }
        .stg-btn-text {
            color: #1D1D1F;
            font-weight: 700;
            font-size: 13px;
            letter-spacing: 1px;
            transition: color 0.2s;
        }
        .stg-btn.stg-success .stg-btn-text { color: #248A3D; }
        .stg-btn.stg-error .stg-btn-text   { color: #D70015; }

        .stg-toast {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 24px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
            z-index: 99999999;
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.12);
            pointer-events: none;
            animation: stg-toast-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                       stg-toast-out 0.3s ease-in 2.5s forwards;
            opacity: 0;
        }
        .stg-toast--error {
            background: rgba(255, 59, 48, 0.92);
            color: #fff;
        }
        .stg-toast--info {
            background: rgba(255, 255, 255, 0.92);
            color: #1D1D1F;
            border: 1px solid rgba(0,0,0,0.1);
        }
        @keyframes stg-toast-in {
            from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes stg-toast-out {
            from { opacity: 1; }
            to   { opacity: 0; }
        }
    `);

    const UI = {
        _btn: null,
        _iconSvg: null,
        _textSpan: null,
        _stateTimer: null,

        createButton() {
            if (document.getElementById('stg-btn-root')) return;
            const root = document.createElement('div');
            root.id = 'stg-btn-root';
            root.innerHTML = `
                <div class="stg-btn" id="stg-grab-btn" data-stg-version="${EXTRACTOR_VERSION}">
                    <svg id="stg-grab-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#007AFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                    </svg>
                    <span class="stg-btn-text" id="stg-grab-text">发送确认订单数据</span>
                </div>
            `;
            document.body.appendChild(root);

            this._btn = document.getElementById('stg-grab-btn');
            this._iconSvg = document.getElementById('stg-grab-icon');
            this._textSpan = document.getElementById('stg-grab-text');

            this._btn.addEventListener('click', () => this._handleClick());
        },

        _setState(state) {
            if (this._stateTimer) clearTimeout(this._stateTimer);
            const btn = this._btn;
            btn.classList.remove('stg-success', 'stg-error');

            if (state === 'sending') {
                this._textSpan.innerText = '发送中…';
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.75';
            } else if (state === 'success') {
                btn.style.pointerEvents = '';
                btn.style.opacity = '';
                btn.classList.add('stg-success');
                this._iconSvg.setAttribute('stroke', '#34C759');
                this._iconSvg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
                this._textSpan.innerText = '成功';
                this._stateTimer = setTimeout(() => this._resetState(), 3000);
            } else if (state === 'error') {
                btn.style.pointerEvents = '';
                btn.style.opacity = '';
                btn.classList.add('stg-error');
                this._iconSvg.setAttribute('stroke', '#FF3B30');
                this._iconSvg.innerHTML = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';
                this._textSpan.innerText = '重试';
                this._stateTimer = setTimeout(() => this._resetState(), 4000);
            }
        },

        _resetState() {
            if (this._stateTimer) clearTimeout(this._stateTimer);
            const btn = this._btn;
            btn.classList.remove('stg-success', 'stg-error');
            btn.style.pointerEvents = '';
            btn.style.opacity = '';
            this._iconSvg.setAttribute('stroke', '#007AFF');
            this._iconSvg.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>';
            this._textSpan.innerText = '发送确认订单数据';
        },

        showToast(msg, type) {
            const existing = document.querySelector('.stg-toast');
            if (existing) existing.remove();

            const toast = document.createElement('div');
            toast.className = `stg-toast stg-toast--${type || 'info'}`;
            toast.textContent = msg;
            document.body.appendChild(toast);

            setTimeout(() => toast.remove(), 3000);
        },

        async _handleClick() {
            let data;
            try {
                data = extractAll();
            } catch (e) {
                this._setState('error');
                this.showToast('提取失败: ' + e.message, 'error');
                console.error('[选品抓取助手] 致命错误:', e);
                return;
            }

            try {
                const envelope = toCaptureEnvelope(data);
                if (envelope.source !== '1688') {
                    const unsupported = new Error('unsupported_page');
                    unsupported.code = 'unsupported_page';
                    throw unsupported;
                }
                if (!envelope.product.name || envelope.product.name === '新采集商品') {
                    const incomplete = new Error('missing_name');
                    incomplete.code = 'missing_name';
                    throw incomplete;
                }
                this._setState('sending');
                const receipt = await sendToWorkbench(envelope);
                this._setState('success');
                if (receipt.code === 'duplicate') {
                    this.showToast('该次采集已发送，请到工作台确认', 'info');
                } else if (receipt.code === 'updated') {
                    this.showToast('已更新工作台中的待确认数据', 'info');
                } else if (envelope.warnings.length > 0) {
                    this.showToast(`已发送，${envelope.warnings.length} 项需要确认`, 'info');
                } else {
                    this.showToast('已发送到工作台待确认区', 'info');
                }
            } catch (error) {
                const fallback = { ...data };
                delete fallback._errors;
                copyFallback(fallback);
                this._setState('error');
                const messages = {
                    missing_secret: '请点击浏览器扩展图标配置连接密钥；旧版数据已复制',
                    workbench_offline: '工作台未启动，或尚未允许本地网络访问；旧版数据已复制',
                    network_error: '无法连接本机工作台；请点击扩展图标检查连接权限；数据已复制',
                    timeout: '连接本机工作台超时；请点击扩展图标重新检测；数据已复制',
                    unauthorized: '连接密钥已失效，请在扩展弹窗中重新配置；旧版数据已复制',
                    unsupported_page: '当前页面未识别为支持的商品页；数据已复制',
                    missing_name: '未提取到商品名称，请等待页面加载后重试',
                    validation_failed: '采集数据未通过工作台校验；旧版数据已复制',
                    unsupported_schema: '脚本与工作台版本不兼容；旧版数据已复制'
                };
                this.showToast(messages[error.code] || `发送失败：${error.message || '未知错误'}；数据已复制`, 'error');
                console.warn('[选品抓取助手] 发送失败:', error.code || error.message, error.details || '');
            }
        }
    };

    function shouldShowCaptureButton() {
        return Platform.is1688() && Platform.isCheckout();
    }

    if (globalThis.__SELECTION_WORKBENCH_TEST__) {
        globalThis.__SELECTION_WORKBENCH_TEST_API__ = {
            Platform,
            DOMExtractors,
            parsePriceRange,
            toCaptureEnvelope,
            createRequestId,
            extractAll,
            checkoutConsistencyWarnings,
            shouldShowCaptureButton
        };
    }

    // ═════════════════════════════════════════════
    //  LIFECYCLE: MutationObserver 替代 setInterval
    // ═════════════════════════════════════════════

    let injected = false;

    function tryInject() {
        if (!document.body) return;
        let existingRoot = document.getElementById('stg-btn-root');
        if (!shouldShowCaptureButton()) {
            if (existingRoot) existingRoot.remove();
            injected = false;
            return;
        }
        const existingVersion = existingRoot
            ?.querySelector('#stg-grab-btn')
            ?.getAttribute('data-stg-version');
        if (existingRoot && existingVersion !== EXTRACTOR_VERSION) {
            existingRoot.remove();
            existingRoot = null;
            injected = false;
        }
        if (injected || existingRoot) {
            injected = true;
            return;
        }
        injected = true;
        UI.createButton();
    }

    // 首次尝试注入
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInject);
    } else {
        tryInject();
    }

    // SPA 页面切换时重新注入 (性能远优于 setInterval)
    let observerTimer = null;
    const observer = new MutationObserver(() => {
        if (observerTimer) clearTimeout(observerTimer);
        observerTimer = setTimeout(tryInject, 160);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

})();
