-- Cloudflare D1 Database Schema for ShoeCRM

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
    tags TEXT
);

-- Seed Initial Admin (password: admin123) and Sales (password: 123456)
-- Hash = SHA256("admin123" + "12345678901234567890123456789012")
INSERT OR IGNORE INTO users (id, username, password_hash, salt, name, role, created_at)
VALUES (1, 'admin', '80c3547844a4d6428c946e382d603a113ec182ce0a6fbcefe8f1d826c7104b2b', '12345678901234567890123456789012', '管理员', 'admin', '2026-08-06T00:00:00');

INSERT OR IGNORE INTO users (id, username, password_hash, salt, name, role, created_at)
VALUES (2, 'sales1', '1f50a4176fb44e59048e9a2636a0734a74950e1ef3dd6bb18da062f68903c737', '12345678901234567890123456789012', '张经理', 'sales', '2026-08-06T00:00:00');

-- Seed Sample Data
INSERT OR IGNORE INTO customers (id, company, country, contact, contact_info, level, channel, date, stage, preferred_styles, preferences, target_price, target_market, moq, sales_rep, notes, created_by)
VALUES (1, 'Global Footwear Ltd', '美国', 'John Smith', 'john@globalfootwear.com', 'VIP', '展会(广交会/华交会)', '2025-10-15', '预定/复购', '网面跑鞋、喷泡鞋', '网布透气、轻量化EVA发泡大底', '$15 - $22', 'US 7-12', '3,000双/季', '张经理', '对品质要求高，需通过BSCI验厂', 2);

INSERT OR IGNORE INTO followups (id, company, date, channel, notes, interest, next_date, action, status, sales_rep, created_by)
VALUES (1, 'Global Footwear Ltd', '2026-07-15', 'WhatsApp', '沟通2027春夏新品开发，客户对飞织网面网球鞋表示浓厚兴趣', '高', '2026-08-10', '安排快递寄出最新飞织鞋面色卡和样品', '进行中', '张经理', 2);

INSERT OR IGNORE INTO quotes (id, company, date, sku, price, qty, express_no, status, feedback, sales_rep, created_by)
VALUES (1, 'Global Footwear Ltd', '2026-07-18', 'SKU-RN901', 16.50, 3000, 'DHL: 849201928', '样品已签收', '满意度高，评估大货下单时间', '张经理', 2);

INSERT OR IGNORE INTO products (id, sku, name, category, upper_material, sole_material, price, moq, target_market, tags)
VALUES (1, 'SKU-RN901', '超轻飞织高弹跑步鞋', '专业跑鞋', '透气飞织网布', 'MD+橡胶贴片', 16.50, 1000, '北美 / 欧洲', '透气轻盈、缓震护膝');
