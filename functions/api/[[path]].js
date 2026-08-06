
// Cloudflare Pages Function - API Handler with D1 Database & Crypto Web API
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
      }
    });
  }

  const db = env.DB;
  if (!db) {
    return jsonResponse({ error: "D1 Database binding 'DB' not found." }, 500);
  }

  // Auth Helper
  const authHeader = request.headers.get("Authorization");
  let currentUser = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    const userRow = await db.prepare(
      "SELECT users.* FROM tokens JOIN users ON tokens.user_id = users.id WHERE tokens.token = ?"
    ).bind(token).first();
    if (userRow) {
      currentUser = userRow;
    }
  }

  // Route: /api/auth/login
  if (path === "/api/auth/login" && request.method === "POST") {
    const body = await request.json();
    const user = await db.prepare("SELECT * FROM users WHERE username = ?").bind(body.username).first();
    if (!user) {
      return jsonResponse({ detail: "用户名或密码错误" }, 400);
    }
    const hashed = await hashPassword(body.password, user.salt);
    if (hashed !== user.password_hash) {
      return jsonResponse({ detail: "用户名或密码错误" }, 400);
    }
    const token = crypto.randomUUID();
    await db.prepare("INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)").bind(token, user.id, new Date().toISOString()).run();

    return jsonResponse({
      token: token,
      user: { id: user.id, username: user.username, name: user.name, role: user.role }
    });
  }

  // Require Auth for subsequent endpoints
  if (!currentUser && path.startsWith("/api/")) {
    return jsonResponse({ detail: "未登录或登录过": "Unauthorized" }, 401);
  }

  // Route: /api/auth/me
  if (path === "/api/auth/me" && request.method === "GET") {
    return jsonResponse({ id: currentUser.id, username: currentUser.username, name: currentUser.name, role: currentUser.role });
  }

  // Route: /api/customers
  if (path === "/api/customers") {
    if (request.method === "GET") {
      let query = currentUser.role === "admin" 
        ? "SELECT * FROM customers ORDER BY id DESC"
        : "SELECT * FROM customers WHERE created_by = ? OR sales_rep = ? ORDER BY id DESC";
      const stmt = currentUser.role === "admin" 
        ? db.prepare(query)
        : db.prepare(query).bind(currentUser.id, currentUser.name);
      const { results } = await stmt.all();
      return jsonResponse(results || []);
    }
    if (request.method === "POST") {
      const b = await request.json();
      await db.prepare(`
        INSERT INTO customers (company, country, contact, contact_info, level, channel, date, stage, preferred_styles, preferences, target_price, target_market, moq, sales_rep, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        b.company || "", b.country || "", b.contact || "", b.contact_info || "",
        b.level || "普通客户", b.channel || "其他", b.date || "", b.stage || "初次接触",
        b.preferred_styles || "", b.preferences || "", b.target_price || "",
        b.target_market || "", b.moq || "", b.sales_rep || currentUser.name, b.notes || "", currentUser.id
      ).run();
      return jsonResponse({ message: "添加成功" });
    }
  }

  if (path.startsWith("/api/customers/") && request.method === "DELETE") {
    const id = path.split("/").pop();
    await db.prepare("DELETE FROM customers WHERE id = ?").bind(id).run();
    return jsonResponse({ message: "已删除" });
  }

  // Route: /api/followups
  if (path === "/api/followups") {
    if (request.method === "GET") {
      const { results } = await db.prepare("SELECT * FROM followups ORDER BY id DESC").all();
      return jsonResponse(results || []);
    }
    if (request.method === "POST") {
      const b = await request.json();
      await db.prepare(`
        INSERT INTO followups (company, date, channel, notes, interest, next_date, action, status, sales_rep, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        b.company || "", b.date || "", b.channel || "WhatsApp", b.notes || "",
        b.interest || "中", b.next_date || "", b.action || "", b.status || "进行中",
        b.sales_rep || currentUser.name, currentUser.id
      ).run();
      return jsonResponse({ message: "跟进记录已保存" });
    }
  }

  if (path.startsWith("/api/followups/") && request.method === "DELETE") {
    const id = path.split("/").pop();
    await db.prepare("DELETE FROM followups WHERE id = ?").bind(id).run();
    return jsonResponse({ message: "已删除" });
  }

  // Route: /api/quotes
  if (path === "/api/quotes") {
    if (request.method === "GET") {
      const { results } = await db.prepare("SELECT * FROM quotes ORDER BY id DESC").all();
      return jsonResponse(results || []);
    }
    if (request.method === "POST") {
      const b = await request.json();
      await db.prepare(`
        INSERT INTO quotes (company, date, sku, price, qty, express_no, status, feedback, sales_rep, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        b.company || "", b.date || "", b.sku || "", b.price || 0, b.qty || 0,
        b.express_no || "", b.status || "已发送报价", b.feedback || "",
        b.sales_rep || currentUser.name, currentUser.id
      ).run();
      return jsonResponse({ message: "报价记录已保存" });
    }
  }

  if (path.startsWith("/api/quotes/") && request.method === "DELETE") {
    const id = path.split("/").pop();
    await db.prepare("DELETE FROM quotes WHERE id = ?").bind(id).run();
    return jsonResponse({ message: "已删除" });
  }

  // Route: /api/products
  if (path === "/api/products") {
    if (request.method === "GET") {
      const { results } = await db.prepare("SELECT * FROM products ORDER BY id DESC").all();
      return jsonResponse(results || []);
    }
    if (request.method === "POST") {
      const b = await request.json();
      await db.prepare(`
        INSERT INTO products (sku, name, category, upper_material, sole_material, price, moq, target_market, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        b.sku || "", b.name || "", b.category || "", b.upper_material || "",
        b.sole_material || "", b.price || 0, b.moq || 1000, b.target_market || "", b.tags || ""
      ).run();
      return jsonResponse({ message: "鞋款已被保存" });
    }
  }

  if (path.startsWith("/api/products/") && request.method === "DELETE") {
    const id = path.split("/").pop();
    await db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
    return jsonResponse({ message: "已删除" });
  }

  return jsonResponse({ error: "Not Found" }, 404);
}
