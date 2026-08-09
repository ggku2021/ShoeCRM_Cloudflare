// Cloudflare Pages Function - ShoeCRM Pro API Router
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (method === 'OPTIONS') {
        return new Response(null, { headers });
    }

    try {
        // Helper to parse JSON body safely
        async function getJsonBody() {
            if (method !== 'POST' && method !== 'PUT') return {};
            try {
                return await request.json();
            } catch (e) {
                try {
                    const text = await request.text();
                    return JSON.parse(text);
                } catch (e2) {
                    return {};
                }
            }
        }

        // 0. Diagnostic Debug Endpoint (PUBLIC / 免登录直接访问)
        if (path === '/api/debug/db') {
            if (!env.DB) {
                return new Response(JSON.stringify({
                    status: 'error',
                    message: 'Cloudflare Pages 未绑定 D1 数据库 (env.DB 为 undefined)。请在 Cloudflare Pages 后台 Settings -> Functions -> D1 database bindings 绑定变量名为 DB 的数据库。'
                }), { status: 500, headers });
            }

            try {
                const countRes = await env.DB.prepare('SELECT count(*) as total FROM products').first();
                const tableInfo = await env.DB.prepare('PRAGMA table_info(products)').all();
                const sampleProducts = await env.DB.prepare('SELECT * FROM products ORDER BY id DESC LIMIT 5').all();

                return new Response(JSON.stringify({
                    status: 'ok',
                    message: 'D1 数据库绑定与查询完全正常！',
                    total_products: countRes ? countRes.total : 0,
                    columns: tableInfo ? tableInfo.results : [],
                    latest_products: sampleProducts ? sampleProducts.results : []
                }), { headers });
            } catch (dbErr) {
                return new Response(JSON.stringify({
                    status: 'db_error',
                    message: 'D1 数据库查询失败: ' + dbErr.message,
                    sql_fix: '请在 Cloudflare D1 控制台运行: CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT, name TEXT, category TEXT, upper_material TEXT, sole_material TEXT, price REAL, moq INTEGER, target_market TEXT, tags TEXT, image_url TEXT);'
                }), { status: 500, headers });
            }
        }

        // 1. 1688 / 搜鞋网 / yupoo 智能主图与多源价格抓取接口 (免登录)
        if (path === '/api/scrape-product') {
            let targetUrl = '';
            if (method === 'POST') {
                const body = await getJsonBody();
                targetUrl = body.url || '';
            } else if (method === 'GET') {
                targetUrl = url.searchParams.get('url') || '';
            }

            if (!targetUrl) {
                return new Response(JSON.stringify({ error: '请提供有效的 1688 / 搜鞋网 / yupoo 商品网址' }), { status: 400, headers });
            }

            try {
                const fetchRes = await fetch(targetUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'zh-CN,zh;q=0.9'
                    }
                });

                const html = await fetchRes.text();

                let name = '';
                let raw_image_url = '';
                let priceRMB = 0;
                let sku = '';

                // Extract SKU / 货号: Priority from page content, no platform prefix
                // Priority 1: sooxie "货号"/"款号" field
                if (!sku) {
                    const artnoM = html.match(/(?:货号|款号|商品编号|商品货号|产品编号|编号|article\s*no|item\s*no|style\s*no)[\s，：:]*<\/?\w+[^>]*>?\s*([A-Za-z0-9\-_.\/]+)/i);
                    if (artnoM) { const v = artnoM[1].trim(); if (v.length >= 3 && v.length <= 30 && !/^(?:jpg|png|gif|jpeg|webp|html|http)/i.test(v)) sku = v; }
                }
                if (!sku) {
                    const tdM = html.match(/<t[dh][^>]*>[\s]*(?:货号|款号|编号)[\s]*<\/t[dh]>\s*<t[dh][^>]*>\s*([^<\s]{3,30})\s*<\/t[dh]>/i);
                    if (tdM) sku = tdM[1].replace(/<[^>]+>/g, '').trim();
                }
                if (!sku) {
                    const kvM = html.match(/(?:货号|款号|编号|article|style)\s*[：:]\s*([A-Za-z0-9\-_.\/]{3,30})/i);
                    if (kvM) sku = kvM[1].trim();
                }
                // Priority 2: 1688 attributes
                if (!sku) {
                    // 1688 data-offer-id (most reliable)
                    const offerId = html.match(/data-(?:offer|item)-?id=["'](\d+)["']/i);
                    if (offerId) sku = offerId[1];
                }
                if (!sku) {
                    // 1688 table attributes: rows containing "货号" or "产品货号"
                    const attrRow = html.match(/<tr[^>]*>\s*<t[dh][^>]*>\s*(?:货\s*号|产品货号|货品编号)\s*<\/t[dh]>\s*<t[dh][^>]*>\s*([^<\s]{3,30})\s*<\/t[dh]>/i);
                    if (attrRow) sku = attrRow[1].replace(/<[^>]+>/g, '').trim();
                }
                if (!sku) {
                    // Any data attribute with art/item/style number
                    const dM = html.match(/data-(?:art|article|item|style|product)-?no=["']([^"']+)["']/i) ||
                               html.match(/"货号"\s*:\s*"([^"]+)"/i) ||
                               html.match(/货\s*号\s*[：:]\s*([^\s<,，]{3,30})/i);
                    if (dM) sku = dM[1].trim();
                }
                // Priority 3: yupoo - extract SKU from image filename
                if (!sku && targetUrl.includes('yupoo.com')) {
                    // Find all image URLs in the album page
                    const yupooImgs = html.match(/((?:https?:)?\/\/photo\.yupoo\.com\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp))/gi) || [];
                    if (yupooImgs.length > 0) {
                        // Use the first image URL, derive SKU from filename
                        const imgUrl = yupooImgs[0];
                        const fnMatch = imgUrl.match(/\/([^\/]+)\.(?:jpg|jpeg|png|webp)$/i);
                        if (fnMatch) sku = fnMatch[1];
                        if (!sku) { // fallback to album ID in URL
                            const albumMatch = targetUrl.match(/albums\/(\d+)/);
                            if (albumMatch) sku = albumMatch[1];
                        }
                    }
                }
                // Priority 4: Fallback URL ID (no prefix)
                if (!sku) {
                    if (targetUrl.includes('1688.com')) { const m = targetUrl.match(/offer\/(\d+)\.html/); if (m) sku = m[1]; }
                    else if (targetUrl.includes('sooxie.com')) { const m = targetUrl.match(/detail\/(\d+)/) || targetUrl.match(/(\d+)\.html/) || targetUrl.match(/id=(\d+)/); if (m) sku = m[1]; }
                    else if (targetUrl.includes('yupoo.com')) {
                        const albumM = targetUrl.match(/albums\/(\d+)/);
                        if (albumM) sku = albumM[1];
                    }
                }
                if (!sku) { sku = String(Math.floor(100000 + Math.random() * 900000)); }

                // Extract size range (尺码: 35-45, size: 36-44, etc.)
                let sizeRange = '';
                const sizeMatch = html.match(/(?:尺码|鞋码|尺\s*码|码数|size|码段)[\s：:]*<\/?\w+[^>]*>?\s*(\d{2})\s*[-~–—]\s*(\d{2})/i) ||
                                  html.match(/<t[dh][^>]*>[\s]*(?:尺码|鞋码|码数|size)[\s]*<\/t[dh]>\s*<t[dh][^>]*>[\s]*(\d{2})\s*[-~–—]\s*(\d{2})/i) ||
                                  html.match(/(\d{2})\s*[-~–—]\s*(\d{2})\s*(?:码|size|尺码)/i);
                if (sizeMatch) {
                    sizeRange = sizeMatch[1] + '-' + sizeMatch[2];
                }

                // Extract Title - keep for backward compat but not primary display
                const titleMatch = html.match(/<title>(.*?)<\/title>/i) || html.match(/meta property="og:title" content="(.*?)"/i);
                if (titleMatch) {
                    name = titleMatch[1].replace(/-1688\.com|-阿里巴巴|-搜鞋网|sooxie\.com/gi, '').trim();
                }

                const badKeywords = ['-tps-', '60000000', 'sprite', 'logo', 'banner', 'header', 'icon', 'avatar', 'watermark', 'blank.gif', 'pixel.png'];

                                // 1a. Priority 0: JSON-LD structured data (best source for both platforms)
                let jsonLdData = null;
                const jsonLdMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
                if (jsonLdMatch) {
                    try { jsonLdData = JSON.parse(jsonLdMatch[1]); } catch(e) {}
                }
                if (jsonLdData) {
                // Extract SKU from JSON-LD structured data
                if (!sku && jsonLdData.sku) { sku = String(jsonLdData.sku).trim(); }
                if (!sku && jsonLdData.productID) { sku = String(jsonLdData.productID).trim(); }

                    if (!raw_image_url && jsonLdData.image) {
                        raw_image_url = Array.isArray(jsonLdData.image) ? jsonLdData.image[0] : jsonLdData.image;
                    }
                    if ((!priceRMB || priceRMB <= 0) && jsonLdData.offers) {
                        const offer = Array.isArray(jsonLdData.offers) ? jsonLdData.offers[0] : jsonLdData.offers;
                        if (offer && offer.price) priceRMB = parseFloat(offer.price);
                    }
                    if (!name && jsonLdData.name) name = jsonLdData.name;
                }

                // 1a. Priority 1: og:image
                const ogImgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"'\s>]+)["']/i);
                if (ogImgMatch) {
                    raw_image_url = ogImgMatch[1];
                }

                // 1b. Priority 2: Match Sooxie main image with id="lnk_thumb" or id="photoBig"
                if (!raw_image_url) {
                    const thumbMatch = html.match(/<img[^>]+id=["']lnk_thumb["'][^>]+src=["']([^"'\s>]+)["']/i) || 
                                       html.match(/<img[^>]+src=["']([^"'\s>]+)["'][^>]+id=["']lnk_thumb["']/i) ||
                                       html.match(/id=["']photoBig["'][^>]*>\s*<img[^>]+src=["']([^"'\s>]+)["']/i);
                    if (thumbMatch) {
                        raw_image_url = thumbMatch[1];
                    }
                }

                // 1c. Priority 3: Check Sooxie / Xiecdn Image (enhanced patterns)
                if (!raw_image_url) {
                    // Try data-src / data-original for lazy-loaded images first
                    const lazyImg = html.match(/<img[^>]+(?:data-src|data-original|data-lazy-src)=["']([^"'\s>]+)["']/i);
                    if (lazyImg) {
                        const lazyUrl = lazyImg[1];
                        if (lazyUrl.includes('xiecdn') || lazyUrl.includes('sooxie') || lazyUrl.includes('alicdn') || lazyUrl.includes('/upload/')) {
                            raw_image_url = lazyUrl;
                        }
                    }
                }
                if (!raw_image_url) {
                    // Match Sooxie main product image: large/big/zoom image, avoid thumbnails
                    const bigImg = html.match(/<img[^>]+(?:class=["'][^"']*(?:big|zoom|large|main|pic|photo)[^"']*["'])[^>]+src=["']([^"'\s>]+)["']/i) ||
                                   html.match(/<img[^>]+src=["']([^"'\s>]+)["'][^>]+(?:class=["'][^"']*(?:big|zoom|large|main|pic|photo)[^"']*["'])/i) ||
                                   html.match(/<img[^>]+src=["']([^"'\s>]+\.(?:jpg|jpeg|png|webp))["'][^>]*>/i);
                    if (bigImg) {
                        const bigUrl = bigImg[1];
                        if (!badKeywords.some(b => bigUrl.includes(b)) && 
                            !bigUrl.includes('thumb') && !bigUrl.includes('icon') && !bigUrl.includes('60x60') && !bigUrl.includes('100x100')) {
                            raw_image_url = bigUrl;
                        }
                    }
                }
                if (!raw_image_url) {
                    const sooxieMatches = html.match(/((?:https?:)?\/\/(?:images\.xiecdn\.com|img\.sooxie\.com|www\.sooxie\.com\/upload|sooxie\.com\/)[^\s"'<>]+)/gi) || [];
                    for (const img of sooxieMatches) {
                        const url = img.replace(/![a-zA-Z0-9_\-\/]+$/i, '').replace(/\?[^"'\s>]*$/i, '');
                        if (!badKeywords.some(b => url.includes(b)) && url.length > 20 &&
                            !url.includes('thumb') && !url.includes('60x60') && !url.includes('100x100') && !url.includes('100x100')) {
                            raw_image_url = img;
                            break;
                        }
                    }
                }

                // 1c2. Priority for xiecdn images with !bac suffix (processed main image)
                if (raw_image_url && raw_image_url.includes('xiecdn') && !raw_image_url.includes('!bac')) {
                    const bacMatches = html.match(/((?:https?:)?\/\/images\.xiecdn\.com\/[^\s"'<>]+!bac)/gi) || [];
                    if (bacMatches.length > 0) {
                        raw_image_url = bacMatches[0]; // Prefer !bac processed image
                    }
                }

                // 1e. Priority 5: yupoo album images
                if (!raw_image_url && targetUrl.includes('yupoo.com')) {
                    // Yupoo photo.yupoo.com or pic.yupoo.com images
                    const yp = html.match(/((?:https?:)?\/\/(?:photo|pic)\.yupoo\.com\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\![\w]+)?)/gi) || [];
                    if (yp.length > 0) {
                        raw_image_url = yp[0]; // First image as main
                    }
                    // Fallback: any image in the page with yupoo in URL
                    if (!raw_image_url) {
                        const anyImg = html.match(/((?:https?:)?\/\/[^\s"'<>]*yupoo[^\s"'<>]*\.(?:jpg|jpeg|png|webp)[^\s"'<>]*)/gi) || [];
                        if (anyImg.length > 0) raw_image_url = anyImg[0];
                    }
                }

                // 1d. Priority 4: Check 1688 alicdn images (modern CDNs)
                if (!raw_image_url) {
                    // Priority: alicdn 800x800 main images
                    const alicdn800 = html.match(/((?:https?:)?\/\/(?:cbu01|cbu02|img)\.alicdn\.com\/(?:img\/ibank|imgextra|bao\/uploaded)\/[^\s"'<>]+?800x800[^\s"'<>]*)/gi) || [];
                    for (const img of alicdn800) {
                        if (!badKeywords.some(b => img.includes(b))) { raw_image_url = img; break; }
                    }
                }
                if (!raw_image_url) {
                    // Any alicdn image (cbu01, img.alicdn.com, imgextra)
                    const alicdnImgs = html.match(/((?:https?:)?\/\/(?:cbu01|cbu02|img)\.alicdn\.com\/(?:img\/ibank|imgextra|bao\/uploaded)\/[^\s"'<>]+)/gi) || [];
                    for (const img of alicdnImgs) {
                        const url = img.replace(/![\da-zA-Z_\-\/]+$/i, '');
                        if (!badKeywords.some(b => url.includes(b)) && url.length > 30 &&
                            !url.includes('60x60') && !url.includes('100x100') && !url.includes('150x150')) {
                            raw_image_url = img;
                            break;
                        }
                    }
                }

                // CLEAN AND NORMALIZE IMAGE URL
                let image_url = raw_image_url || '';
                if (image_url) {
                    image_url = image_url.replace(/!\d+x?\d*(?:_?[a-z]*\d*x?\d*)?$/i, ''); // Strip size suffixes like !200x200, keep !bac processing tags
                    image_url = image_url.replace(/\?[^"'\s>]*$/i, '');

                    if (image_url.startsWith('//')) {
                        image_url = 'https:' + image_url;
                    } else if (image_url.startsWith('http://')) {
                        image_url = image_url.replace('http://', 'https://');
                    } else if (image_url.startsWith('/')) {
                        image_url = 'https://www.sooxie.com' + image_url;
                    }
                } else {
                    image_url = 'https://images.xiecdn.com/jinchen/texqjl2b6rdgrswajxh9fyqlmdrwdmko.jpg';
                }

                // 2. Price Extraction: Priority 1 - Match JS variable: var price="90.00"
                const jsPriceMatch = html.match(/var\s+price\s*=\s*["']([\d\.]+)["']/i);
                if (jsPriceMatch) {
                    priceRMB = parseFloat(jsPriceMatch[1]);
                }

                // Priority 2 - Match 1688 JSON price fields and data attributes
                if (!priceRMB || priceRMB <= 0) {
                    // 1688 data attributes: data-range-price, data-price
                    const dataPrice = html.match(/data-(?:range-)?price=["']([\d\.]+)/i);
                    if (dataPrice) {
                        priceRMB = parseFloat(dataPrice[1]);
                    }
                }
                if (!priceRMB || priceRMB <= 0) {
                    // 1688 __PRELOADED_STATE__ - most complete data source (before iDetailData)
                    const preloadMatch = html.match(/(?:__PRELOADED_STATE__|window\.__INIT_DATA__)\s*=\s*(\{[^]+\})\s*[;\n]|<script[^>]*>\s*window\.__PRELOADED_STATE__\s*=\s*(\{[^]+?\})\s*<\//i);
                    if (preloadMatch) {
                        try {
                            const pdata = JSON.parse(preloadMatch[1] || preloadMatch[2]);
                            const offer = pdata?.offer || pdata?.detail?.offer || pdata?.globalData?.offerModel || {};
                            const p = offer?.price || offer?.beginAmount || offer?.refPrice || offer?.origPrice;
                            if (p && !isNaN(parseFloat(p))) priceRMB = parseFloat(p);
                            if (!raw_image_url) {
                                const imgs = offer?.images || pdata?.detail?.images || offer?.imageList || [];
                                if (Array.isArray(imgs) && imgs.length > 0) {
                                    raw_image_url = typeof imgs[0] === 'string' ? imgs[0] : (imgs[0].url || imgs[0].src || imgs[0]);
                                }
                            }
                            if (!sku) {
                                const oid = offer?.offerId || offer?.offer_id || pdata?.detail?.offerId || pdata?.offerId;
                                if (oid) sku = String(oid);
                            }
                        } catch(e) {}
                    }
                }
                if (!priceRMB || priceRMB <= 0) {
                    // 1688 iDetailData/__od_data JSON block
                    const idetailMatch = html.match(/(?:iDetailData|__od_data|window\.__data__)\s*[:=]\s*(\{[^]+\})\s*[;\n]/i);
                    if (idetailMatch) {
                        try {
                            const data = JSON.parse(idetailMatch[1]);
                            const skuInfo = data.sku || data.skuInfo || data.skuMap || {};
                            const firstSku = Object.values(skuInfo)[0] || {};
                            if (firstSku.price) priceRMB = parseFloat(firstSku.price);
                        } catch(e) {}
                    }
                }
                if (!priceRMB || priceRMB <= 0) {
                    // 1688 meta/JSON nested price fields
                    const json1688Price = html.match(/"(?:refPrice|price|discountPrice|value|offerPrice|originPrice)":"?([\d\.]+)"?/i);
                    if (json1688Price) {
                        priceRMB = parseFloat(json1688Price[1]);
                    }
                }
                if (!priceRMB || priceRMB <= 0) {
                    // 1688 "offerPriceRange" pattern in JS
                    const offerRange = html.match(/["']price(?:Range)?["']\s*:\s*["']?([\d\.]+)\s*[-~]\s*([\d\.]+)["']?/i);
                    if (offerRange) {
                        priceRMB = parseFloat(offerRange[1]); // Take lower price
                    }
                }
                if (!priceRMB || priceRMB <= 0) {
                    // 1688 beginAmount / priceRange in JSON
                    const beginAmt = html.match(/"beginAmount"\s*:\s*"?([\d\.]+)"?/i);
                    if (beginAmt) priceRMB = parseFloat(beginAmt[1]);
                }
                if (!priceRMB || priceRMB <= 0) {
                    // 1688 offerPrice in script data
                    const offerPr = html.match(/"offerPrice"\s*:\s*"?([\d\.]+)"?/i) || html.match(/"origPrice"\s*:\s*"?([\d\.]+)"?/i);
                    if (offerPr) priceRMB = parseFloat(offerPr[1]);
                }
                if (!priceRMB || priceRMB <= 0) {
                    // Generic JSON price extraction with better context
                    const genPrice = html.match(/"price"\s*:\s*([\d\.]+)/i);
                    if (genPrice) {
                        priceRMB = parseFloat(genPrice[1]);
                    }
                }

                // Priority 3 - Sooxie specific price patterns
                if (!priceRMB || priceRMB <= 0) {
                    // Sooxie price in various formats
                    const sooxiePrice = html.match(/class=["'](?:meri-price|price-num|price-value|product-price|sale-price|now-price)["'][^>]*>\s*[¥￥]?\s*([\d\.]+)/i) ||
                                        html.match(/<span[^>]*>\s*[¥￥]\s*([\d\.]+)\s*<\/span>/i) ||
                                        html.match(/class=["']price["'][^>]*>\s*[¥￥]?\s*([\d\.]+)/i);
                    if (sooxiePrice) {
                        priceRMB = parseFloat(sooxiePrice[1]);
                    }
                }
                if (!priceRMB || priceRMB <= 0) {
                    // Try to find any number near ¥ or 元 or RMB
                    const rmbContext = html.match(/[¥￥元]\s*([\d\.]+)\s*[元]?/i);
                    if (rmbContext) {
                        priceRMB = parseFloat(rmbContext[1]);
                    }
                }

                // Priority 4 - class="price-num" or class="price"
                if (!priceRMB || priceRMB <= 0) {
                    const tagPriceMatch = html.match(/<(?:em|span|b|strong|div)[^>]*class=["'][^"'\s>]*(?:price|cost|num|value)[^"'\s>]*["'][^>]*>(?:[￥¥]\s*)?([\d\.]+)</i);
                    if (tagPriceMatch) {
                        priceRMB = parseFloat(tagPriceMatch[1]);
                    }
                }

                // Priority 5 - Match P 90 元 in title
                if (!priceRMB || priceRMB <= 0) {
                    const pPriceMatch = html.match(/P\s*(\d+(?:\.\d+)?)\s*元/i);
                    if (pPriceMatch) {
                        priceRMB = parseFloat(pPriceMatch[1]);
                    }
                }

                // Priority 6 - Match ￥ 90.00
                if (!priceRMB || priceRMB <= 0) {
                    const rmbMatch = html.match(/[￥¥]\s*([\d\.]+)/);
                    if (rmbMatch) {
                        priceRMB = parseFloat(rmbMatch[1]);
                    }
                }

                const finalRMB = priceRMB || 90.0;
                // Calculate FOB USD ($) based on 7.2 Exchange Rate: e.g. 90 RMB / 7.2 = $12.50
                const finalUSD = parseFloat((finalRMB / 7.20).toFixed(2));

                return new Response(JSON.stringify({
                    success: true,
                    product: {
                        sku: sku,
                        name: name || ('网络抓取鞋款 ' + sku),
                        priceRMB: finalRMB,
                        price: finalUSD,
                        image_url: image_url,
                        size_range: sizeRange || '',
                        category: name.includes('拖鞋') ? '凉拖鞋' : (name.includes('帆布') ? '休闲鞋' : '跑鞋'),
                        upper_material: name.includes('飞织') ? '透气飞织' : (name.includes('皮') ? '头层牛皮/PU' : '网布'),
                        sole_material: 'MD+橡胶底',
                        moq: 1000,
                        target_market: '通用外贸',
                        tags: '一键抓取, 热销推荐'
                    }
                }), { headers });

            } catch (e) {
                return new Response(JSON.stringify({
                    error: '解析网页超时: ' + e.message,
                    fallback: true
                }), { status: 200, headers });
            }
        }

        // 2. 公开选款商品接口 (免 Auth Token)
        if (path === '/api/public/products' && method === 'GET') {
            if (!env.DB) {
                return new Response(JSON.stringify([]), { headers });
            }
            try {
                const { results } = await env.DB.prepare(
                    'SELECT id, sku, name, category, price, image_url, upper_material, sole_material, moq, target_market, tags FROM products ORDER BY id DESC'
                ).all();
                return new Response(JSON.stringify(results || []), { headers });
            } catch (e) {
                try {
                    const { results } = await env.DB.prepare(
                        'SELECT id, sku, name, category, price, upper_material, sole_material, moq, target_market, tags FROM products ORDER BY id DESC'
                    ).all();
                    return new Response(JSON.stringify(results || []), { headers });
                } catch(err) {
                    return new Response(JSON.stringify([]), { headers });
                }
            }
        }

        // 3. 买家自主选款 PI 报价单提交接口 (免 Auth Token)
        if (path === '/api/public/quotes' && method === 'POST') {
            const b = await getJsonBody();
            if (env.DB) {
                try {
                    const res = await env.DB.prepare(
                        `INSERT INTO quotes (company, date, sku, price, qty, express_no, status, feedback, sales_rep) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).bind(
                        b.company || '买家自主选款',
                        b.date || new Date().toISOString().split('T')[0],
                        b.sku || '',
                        Number(b.price) || 0,
                        Number(b.qty) || 1000,
                        b.express_no || '买家在线提交',
                        b.status || '买家已提交选款单',
                        b.feedback || '买家在线提交选款PI',
                        b.sales_rep || '自主选款买家'
                    ).run();
                    return new Response(JSON.stringify({ success: true, id: res.meta.last_row_id }), { headers });
                } catch (e) {
                    return new Response(JSON.stringify({ success: true, id: Date.now() }), { headers });
                }
            }
            return new Response(JSON.stringify({ success: true, id: Date.now() }), { headers });
        }

        // 4. Auth Login Route
        if (path === '/api/auth/login' && method === 'POST') {
            const body = await getJsonBody();
            const { username, password } = body;
            if ((username === 'admin' || username === 'sales1') && (password === 'admin123' || password === '123456')) {
                return new Response(JSON.stringify({
                    token: 'mock-jwt-token-' + Date.now(),
                    user: { username, name: username === 'admin' ? '张经理 (主管)' : '李业务 (销售)', role: username === 'admin' ? 'admin' : 'sales' }
                }), { headers });
            }
            return new Response(JSON.stringify({ detail: '账号或密码错误 (默认账号: admin / 密码: admin123)' }), { status: 400, headers });
        }

        // Authentication Check for all other protected APIs
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ detail: '未提供有效的登录凭证，请先登录' }), { status: 401, headers });
        }

        if (!env.DB) {
            return new Response(JSON.stringify({ error: '未绑定 Cloudflare D1 数据库 (env.DB)' }), { status: 500, headers });
        }

        // 5. Customers Endpoint
        if (path === '/api/customers') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM customers ORDER BY id DESC').all();
                return new Response(JSON.stringify(results || []), { headers });
            }
            if (method === 'POST') {
                const b = await getJsonBody();
                const res = await env.DB.prepare(
                    `INSERT INTO customers (company, country, contact, contact_info, level, channel, date, stage, preferred_styles, preferences, target_price, target_market, moq, sales_rep, notes) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    b.company || '', b.country || '', b.contact || '', b.contact_info || '',
                    b.level || 'VIP', b.channel || '展会', b.date || new Date().toISOString().split('T')[0],
                    b.stage || '初次接触', b.preferred_styles || '', b.preferences || '',
                    b.target_price || '', b.target_market || '', b.moq || '', b.sales_rep || '销售员', b.notes || ''
                ).run();
                return new Response(JSON.stringify({ success: true, id: res.meta.last_row_id }), { headers });
            }
        }

        if (path.startsWith('/api/customers/')) {
            const id = path.split('/')[3];
            if (method === 'DELETE') {
                await env.DB.prepare('DELETE FROM customers WHERE id = ?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        // 6. Followups Endpoint
        if (path === '/api/followups') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM followups ORDER BY id DESC').all();
                return new Response(JSON.stringify(results || []), { headers });
            }
            if (method === 'POST') {
                const b = await getJsonBody();
                const res = await env.DB.prepare(
                    `INSERT INTO followups (company, date, channel, notes, interest, next_date, action, status, sales_rep) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    b.company || '', b.date || new Date().toISOString().split('T')[0],
                    b.channel || 'WhatsApp', b.notes || '', b.interest || '中',
                    b.next_date || '', b.action || '', b.status || '进行中', b.sales_rep || '销售员', b.notes || ''
                ).run();
                return new Response(JSON.stringify({ success: true, id: res.meta.last_row_id }), { headers });
            }
        }

        if (path.startsWith('/api/followups/')) {
            const id = path.split('/')[3];
            if (method === 'DELETE') {
                await env.DB.prepare('DELETE FROM followups WHERE id = ?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        // 7. Quotes Endpoint
        if (path === '/api/quotes') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM quotes ORDER BY id DESC').all();
                return new Response(JSON.stringify(results || []), { headers });
            }
            if (method === 'POST') {
                const b = await getJsonBody();
                const res = await env.DB.prepare(
                    `INSERT INTO quotes (company, date, sku, price, qty, express_no, status, feedback, sales_rep) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    b.company || '', b.date || new Date().toISOString().split('T')[0],
                    b.sku || '', Number(b.price) || 0, Number(b.qty) || 1000,
                    b.express_no || '', b.status || '已发送报价', b.feedback || '', b.sales_rep || '销售员'
                ).run();
                return new Response(JSON.stringify({ success: true, id: res.meta.last_row_id }), { headers });
            }
        }

        if (path.startsWith('/api/quotes/')) {
            const id = path.split('/')[3];
            if (method === 'DELETE') {
                await env.DB.prepare('DELETE FROM quotes WHERE id = ?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        // 8. Products Endpoint
        if (path === '/api/products') {
            if (method === 'GET') {
                try {
                    const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY id DESC').all();
                    return new Response(JSON.stringify(results || []), { headers });
                } catch (e) {
                    const { results } = await env.DB.prepare('SELECT id, sku, name, category, upper_material, sole_material, price, moq, target_market, tags FROM products ORDER BY id DESC').all();
                    return new Response(JSON.stringify(results || []), { headers });
                }
            }
            if (method === 'POST') {
                const b = await getJsonBody();

                try { await env.DB.prepare('ALTER TABLE products ADD COLUMN image_url TEXT').run(); } catch(colErr) {}

                const numId = b.id ? Number(b.id) : 0;
                const isUpdate = numId > 0 && numId < 10000000000;

                try {
                    if (isUpdate) {
                        await env.DB.prepare(
                            `UPDATE products SET sku=?, name=?, category=?, upper_material=?, sole_material=?, price=?, moq=?, target_market=?, tags=?, image_url=? WHERE id=? OR sku=?`
                        ).bind(
                            b.sku || '', b.name || '', b.category || '跑鞋',
                            b.upper_material || '', b.sole_material || '', Number(b.price) || 0,
                            Number(b.moq) || 1000, b.target_market || '', b.tags || '',
                            b.image_url || '', numId, b.sku || ''
                        ).run();
                        return new Response(JSON.stringify({ success: true, id: numId }), { headers });
                    } else {
                        const res = await env.DB.prepare(
                            `INSERT INTO products (sku, name, category, upper_material, sole_material, price, moq, target_market, tags, image_url) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                        ).bind(
                            b.sku || '', b.name || '', b.category || '跑鞋',
                            b.upper_material || '', b.sole_material || '', Number(b.price) || 0,
                            Number(b.moq) || 1000, b.target_market || '', b.tags || '',
                            b.image_url || ''
                        ).run();
                        const lastId = res && res.meta && res.meta.last_row_id ? res.meta.last_row_id : Date.now();
                        return new Response(JSON.stringify({ success: true, id: lastId }), { headers });
                    }
                } catch (d1Err) {
                    try {
                        if (isUpdate) {
                            await env.DB.prepare(
                                `UPDATE products SET sku=?, name=?, category=?, upper_material=?, sole_material=?, price=?, moq=?, target_market=?, tags=? WHERE id=? OR sku=?`
                            ).bind(
                                b.sku || '', b.name || '', b.category || '跑鞋',
                                b.upper_material || '', b.sole_material || '', Number(b.price) || 0,
                                Number(b.moq) || 1000, b.target_market || '', b.tags || '', numId, b.sku || ''
                            ).run();
                            return new Response(JSON.stringify({ success: true, id: numId }), { headers });
                        } else {
                            const res = await env.DB.prepare(
                                `INSERT INTO products (sku, name, category, upper_material, sole_material, price, moq, target_market, tags) 
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                            ).bind(
                                b.sku || '', b.name || '', b.category || '跑鞋',
                                b.upper_material || '', b.sole_material || '', Number(b.price) || 0,
                                Number(b.moq) || 1000, b.target_market || '', b.tags || ''
                            ).run();
                            return new Response(JSON.stringify({ success: true, id: res.meta ? res.meta.last_row_id : Date.now() }), { headers });
                        }
                    } catch (fatalErr) {
                        return new Response(JSON.stringify({ error: '数据库写入失败: ' + fatalErr.message }), { status: 500, headers });
                    }
                }
            }
        }

        if (path.startsWith('/api/products/')) {
            const param = path.split('/')[3];
            if (method === 'DELETE') {
                const numId = Number(param);
                if (numId > 0) {
                    await env.DB.prepare('DELETE FROM products WHERE id = ? OR sku = ?').bind(numId, param).run();
                } else {
                    await env.DB.prepare('DELETE FROM products WHERE sku = ?').bind(param).run();
                }
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        return new Response(JSON.stringify({ error: 'Endpoint Not Found' }), { status: 404, headers });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers });
    }
}
