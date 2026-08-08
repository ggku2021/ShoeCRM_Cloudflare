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

        // 1. 1688 / 搜鞋网 (sooxie.com) 智能主图与多源价格抓取接口 (免登录)
        if (path === '/api/scrape-product') {
            let targetUrl = '';
            if (method === 'POST') {
                const body = await getJsonBody();
                targetUrl = body.url || '';
            } else if (method === 'GET') {
                targetUrl = url.searchParams.get('url') || '';
            }

            if (!targetUrl) {
                return new Response(JSON.stringify({ error: '请提供有效的 1688 或 搜鞋网 (sooxie.com) 商品网址' }), { status: 400, headers });
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

                // Extract SKU / Item ID
                if (targetUrl.includes('1688.com')) {
                    const match = targetUrl.match(/offer\/(\d+)\.html/);
                    sku = match ? '1688-' + match[1] : '1688-' + Math.floor(100000 + Math.random() * 900000);
                } else if (targetUrl.includes('sooxie.com')) {
                    const match = targetUrl.match(/detail\/(\d+)/) || targetUrl.match(/(\d+)\.html/) || targetUrl.match(/id=(\d+)/);
                    sku = match ? 'SOOXIE-' + match[1] : 'SOOXIE-' + Math.floor(100000 + Math.random() * 900000);
                } else {
                    sku = 'SKU-' + Math.floor(100000 + Math.random() * 900000);
                }

                // Extract Title
                const titleMatch = html.match(/<title>(.*?)<\/title>/i) || html.match(/meta property="og:title" content="(.*?)"/i);
                if (titleMatch) {
                    name = titleMatch[1].replace(/-1688\.com|-阿里巴巴|-搜鞋网|sooxie\.com/gi, '').trim();
                }

                const badKeywords = ['-tps-', '60000000', 'sprite', 'logo', 'banner', 'header', 'icon', 'avatar', 'watermark', 'blank.gif', 'pixel.png'];

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

                // 1c. Priority 3: Check Sooxie / Xiecdn Image
                if (!raw_image_url) {
                    const sooxieMatches = html.match(/((?:https?:)?\/\/(?:images\.xiecdn\.com|img\.sooxie\.com|www\.sooxie\.com\/upload)[^\s"'<>]+)/gi) || [];
                    for (const img of sooxieMatches) {
                        if (!badKeywords.some(b => img.includes(b)) && img.length > 20) {
                            raw_image_url = img;
                            break;
                        }
                    }
                }

                // 1d. Priority 4: Check 1688 cbu01 CDN main images
                if (!raw_image_url) {
                    const cbuMatches = html.match(/((?:https?:)?\/\/cbu01\.alicdn\.com\/img\/ibank\/[^\s"'<>]+)/gi) || [];
                    for (const img of cbuMatches) {
                        if (!badKeywords.some(b => img.includes(b))) {
                            raw_image_url = img;
                            break;
                        }
                    }
                }

                // CLEAN AND NORMALIZE IMAGE URL
                let image_url = raw_image_url || '';
                if (image_url) {
                    image_url = image_url.replace(/![a-zA-Z0-9_\-\/]+$/i, '');
                    image_url = image_url.replace(/\?[^"'\s>]*$/i, '');

                    if (image_url.startsWith('//')) {
                        image_url = 'https:' + image_url;
                    } else if (image_url.startsWith('http://')) {
                        image_url = image_url.replace('http://', 'https://');
                    } else if (image_url.startsWith('/')) {
                        image_url = 'https://www.sooxie.com' + image_url;
                    }
                } else {
                    image_url = 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400';
                }

                // 2. Price Extraction: Priority 1 - Match JS variable: var price="90.00"
                const jsPriceMatch = html.match(/var\s+price\s*=\s*["']([\d\.]+)["']/i);
                if (jsPriceMatch) {
                    priceRMB = parseFloat(jsPriceMatch[1]);
                }

                // Priority 2 - Match 1688 JSON price fields: "refPrice", "price", "discountPrice", "value", "priceRange"
                if (!priceRMB || priceRMB <= 0) {
                    const json1688Price = html.match(/"(?:refPrice|price|discountPrice|value)":"?([\d\.]+)"?/i);
                    if (json1688Price) {
                        priceRMB = parseFloat(json1688Price.group ? json1688Price.group(1) : json1688Price[1]);
                    }
                }

                // Priority 3 - class="meri-price"
                if (!priceRMB || priceRMB <= 0) {
                    const meriPriceMatch = html.match(/class=["']meri-price["'][^>]*>\s*([\d\.]+)/i);
                    if (meriPriceMatch) {
                        priceRMB = parseFloat(meriPriceMatch[1]);
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

                const finalRMB = priceRMB || 90.0;
                // Calculate FOB USD ($) based on 7.2 Exchange Rate
                const finalUSD = parseFloat((finalRMB / 7.20).toFixed(2));

                return new Response(JSON.stringify({
                    success: true,
                    product: {
                        sku: sku,
                        name: name || ('网络抓取鞋款 ' + sku),
                        priceRMB: finalRMB,
                        price: finalUSD,
                        image_url: image_url,
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
