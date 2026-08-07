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
        // 1. 公开选款商品接口 (免 Auth Token)
        if (path === '/api/public/products' && method === 'GET') {
            const { results } = await env.DB.prepare(
                'SELECT id, sku, name, category, price, image_url, upper_material, sole_material, moq, target_market, tags FROM products ORDER BY id DESC'
            ).all();
            return new Response(JSON.stringify(results || []), { headers });
        }

        // 2. Auth Login Route
        if (path === '/api/auth/login' && method === 'POST') {
            const body = await request.json();
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

        // 3. Customers Endpoint
        if (path === '/api/customers') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM customers ORDER BY id DESC').all();
                return new Response(JSON.stringify(results || []), { headers });
            }
            if (method === 'POST') {
                const b = await request.json();
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

        // 4. Followups Endpoint
        if (path === '/api/followups') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM followups ORDER BY id DESC').all();
                return new Response(JSON.stringify(results || []), { headers });
            }
            if (method === 'POST') {
                const b = await request.json();
                const res = await env.DB.prepare(
                    `INSERT INTO followups (company, date, channel, notes, interest, next_date, action, status, sales_rep) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    b.company || '', b.date || new Date().toISOString().split('T')[0],
                    b.channel || 'WhatsApp', b.notes || '', b.interest || '中',
                    b.next_date || '', b.action || '', b.status || '进行中', b.sales_rep || '销售员'
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

        // 5. Quotes Endpoint
        if (path === '/api/quotes') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM quotes ORDER BY id DESC').all();
                return new Response(JSON.stringify(results || []), { headers });
            }
            if (method === 'POST') {
                const b = await request.json();
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

        // 6. Products Endpoint
        if (path === '/api/products') {
            if (method === 'GET') {
                const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY id DESC').all();
                return new Response(JSON.stringify(results || []), { headers });
            }
            if (method === 'POST') {
                const b = await request.json();
                if (b.id) {
                    await env.DB.prepare(
                        `UPDATE products SET sku=?, name=?, category=?, upper_material=?, sole_material=?, price=?, moq=?, target_market=?, tags=?, image_url=? WHERE id=?`
                    ).bind(
                        b.sku || '', b.name || '', b.category || '跑鞋',
                        b.upper_material || '', b.sole_material || '', Number(b.price) || 0,
                        Number(b.moq) || 1000, b.target_market || '', b.tags || '',
                        b.image_url || '', b.id
                    ).run();
                    return new Response(JSON.stringify({ success: true, id: b.id }), { headers });
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
                    return new Response(JSON.stringify({ success: true, id: res.meta.last_row_id }), { headers });
                }
            }
        }

        if (path.startsWith('/api/products/')) {
            const id = path.split('/')[3];
            if (method === 'DELETE') {
                await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
        }

        return new Response(JSON.stringify({ error: 'Endpoint Not Found' }), { status: 404, headers });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers });
    }
}
