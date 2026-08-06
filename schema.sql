-- Cloudflare D1 Database Schema v2 (With Image & PI Support)

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'sales',
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    country TEXT,
    contact TEXT,
    contact_info TEXT,
    level TEXT,
    channel TEXT,
    date TEXT,
    stage TEXT,
    preferred_styles TEXT,
    preferences TEXT,
    target_price TEXT,
    target_market TEXT,
    moq TEXT,
    sales_rep TEXT,
    notes TEXT,
    created_by INTEGER
);

CREATE TABLE IF NOT EXISTS followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    company TEXT,
    date TEXT,
    channel TEXT,
    notes TEXT,
    interest TEXT,
    next_date TEXT,
    action TEXT,
    status TEXT,
    sales_rep TEXT,
    created_by INTEGER
);

CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    company TEXT,
    date TEXT,
    sku TEXT,
    price REAL,
    qty INTEGER,
    express_no TEXT,
    status TEXT,
    feedback TEXT,
    sales_rep TEXT,
    created_by INTEGER
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    upper_material TEXT,
    sole_material TEXT,
    price REAL,
    moq INTEGER,
    target_market TEXT,
    tags TEXT,
    image_url TEXT
);

-- Seed Initial Admin (password: admin123) and Sales (password: 123456)
INSERT OR REPLACE INTO users (id, username, password_hash, salt, name, role, created_at)
VALUES 
(1, 'admin', 'd13b11fa64c639f47bd1c8d9c8dce08125ea5e2b539c2ed3e0b977825b474825', '12345678901234567890123456789012', '管理员', 'admin', '2026-08-06T00:00:00'),
(2, 'sales1', '6f279d4544b889818fedb64d7e2309dd3c79ceeacd313ee944cc87df4e4afb19', '12345678901234567890123456789012', '张经理', 'sales', '2026-08-06T00:00:00');

-- Seed Sample Data
INSERT OR IGNORE INTO customers (id, company, country, contact, contact_info, level, channel, date, stage, preferred_styles, preferences, target_price, target_market, moq, sales_rep, notes, created_by)
VALUES (1, 'Global Footwear Ltd', '美国', 'John Smith', 'john@globalfootwear.com', 'VIP', '展会(广交会/华交会)', '2025-10-15', '预定/复购', '跑鞋, 飞织', '网布透气、轻量化EVA发泡大底', '$15 - $22', 'US 7-12', '3,000双/季', '张经理', '对品质要求高，需通过BSCI验厂', 2);

INSERT OR IGNORE INTO followups (id, company, date, channel, notes, interest, next_date, action, status, sales_rep, created_by)
VALUES (1, 'Global Footwear Ltd', '2026-07-15', 'WhatsApp', '沟通2027春夏新品开发，客户对飞织网面网球鞋表示浓厚兴趣', '高', '2026-08-05', '安排快递寄出最新飞织鞋面色卡和样品', '进行中', '张经理', 2);

INSERT OR IGNORE INTO quotes (id, company, date, sku, price, qty, express_no, status, feedback, sales_rep, created_by)
VALUES (1, 'Global Footwear Ltd', '2026-07-18', 'SKU-RN901', 16.50, 3000, 'DHL: 849201928', '样品已签收', '满意度高，评估大货下单时间', '张经理', 2);

INSERT OR IGNORE INTO products (id, sku, name, category, upper_material, sole_material, price, moq, target_market, tags, image_url)
VALUES 
(1, 'SKU-RN901', '超轻飞织高弹跑步鞋', '跑鞋', '透气飞织网布', 'MD+橡胶贴片', 16.50, 1000, '北美 / 欧洲', '透气轻盈, 缓震护膝, 跑鞋', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400'),
(2, 'SKU-CS204', '复古低帮帆布滑板鞋', '休闲鞋', '12安高密度帆布', '耐磨防滑橡胶底', 12.00, 1500, '南美 / 东南亚', '经典耐看, 高耐磨防滑, 帆布', 'https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=400'),
(3, 'SKU-SL502', '头层牛皮多功能拖鞋', '拖鞋', '头层牛皮', '防滑聚氨酯底', 22.80, 500, '中东 / 北非', '真皮质感, 高档舒适, 拖鞋', 'https://images.unsplash.com/photo-1603808033192-082d6919d3e1?w=400');
