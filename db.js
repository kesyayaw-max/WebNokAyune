const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'nokayune.db'));
db.pragma('journal_mode = WAL');

// ===== SCHEMA =====
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','kasir')),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  wa_number TEXT,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cat TEXT NOT NULL,
  price INTEGER NOT NULL,
  emoji TEXT DEFAULT '🍽️',
  image TEXT,
  desc TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','soldout')),
  sold INTEGER NOT NULL DEFAULT 0,
  stock INTEGER,
  region_id INTEGER REFERENCES regions(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  deliver_time TEXT NOT NULL,
  notes TEXT,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cooking','delivered','done','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid')),
  payment_method TEXT DEFAULT 'qris_manual',
  region_id INTEGER REFERENCES regions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_id INTEGER,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// ===== MIGRATIONS: add new columns for databases created before this feature existed =====
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('menu', 'stock', 'stock INTEGER');
ensureColumn('menu', 'region_id', 'region_id INTEGER');
ensureColumn('orders', 'region_id', 'region_id INTEGER');

// ===== SEED: regions (only if empty) — UMKM bisa menambah wilayah lain lewat dashboard admin =====
const regionCount = db.prepare('SELECT COUNT(*) AS c FROM regions').get().c;
if (regionCount === 0) {
  const insertRegion = db.prepare('INSERT INTO regions (name, wa_number, address, active) VALUES (?,?,?,1)');
  insertRegion.run('Purwokerto', '6281234567890', 'Purwokerto, Jawa Tengah');
  insertRegion.run('Jember', '6281234567891', 'Jember, Jawa Timur');
  console.log('✔ Wilayah default dibuat: Purwokerto, Jember — tambah wilayah lain lewat Admin > Pengaturan.');
}

// ===== SEED: default admin (change password after first login!) =====
const adminCount = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
if (adminCount === 0) {
  const insert = db.prepare('INSERT INTO admins (username, password_hash, role, name) VALUES (?,?,?,?)');
  insert.run('admin', bcrypt.hashSync('nokayune123', 10), 'owner', 'Bu Ayune');
  insert.run('kasir', bcrypt.hashSync('kasir123', 10), 'kasir', 'Kasir Toko');
  console.log('✔ Akun admin default dibuat: admin/nokayune123 (owner), kasir/kasir123 (kasir) — SEGERA GANTI PASSWORD.');
}

// ===== SEED: menu (only if empty) =====
const menuCount = db.prepare('SELECT COUNT(*) AS c FROM menu').get().c;
if (menuCount === 0) {
  const insert = db.prepare(`INSERT INTO menu (name, cat, price, emoji, desc, status, sold) VALUES (?,?,?,?,?,?,?)`);
  const seed = [
    ["Nasi Box Spesial", "nasi-box", 25000, "🍱", "Nasi putih, ayam goreng crispy, tempe orek, sayur urap, sambal, kerupuk", "available", 87],
    ["Nasi Box Premium", "nasi-box", 35000, "🍛", "Nasi putih, rendang sapi, perkedel kentang, sayur lodeh, sambel goreng, kerupuk", "available", 54],
    ["Nasi Box Vegetarian", "nasi-box", 22000, "🥗", "Nasi putih, tahu bacem, tempe mendoan, gado-gado, sayur bening, emping", "available", 32],
    ["Nasi Uduk Komplit", "nasi-box", 28000, "🍚", "Nasi uduk gurih, ayam suwir, bihun goreng, telur dadar, bawang goreng", "available", 41],
    ["Ayam Goreng Kremes", "lauk", 18000, "🍗", "Ayam goreng dengan kremes renyah, bumbu kuning meresap sampai tulang", "available", 120],
    ["Rendang Sapi", "lauk", 28000, "🥩", "Rendang sapi empuk dimasak 3 jam dengan rempah pilihan khas Minang", "available", 76],
    ["Ikan Tongkol Bumbu Bali", "lauk", 20000, "🐟", "Ikan tongkol segar dengan bumbu bali merah yang kaya rasa", "available", 45],
    ["Tempe Mendoan", "lauk", 8000, "🫓", "Tempe tipis digoreng setengah matang dengan tepung berbumbu khas Banyumas", "available", 98],
    ["Lemper Isi Ayam", "snack", 5000, "🫛", "Lemper beras ketan isi ayam suwir bumbu gurih, dibungkus daun pisang", "available", 63],
    ["Risoles Mayo", "snack", 6000, "🥚", "Risoles isi sayuran dan telur dengan saus mayo creamy", "available", 48],
    ["Klepon", "snack", 4000, "🟢", "Klepon tradisional isi gula merah, dibalut kelapa parut segar", "available", 72],
    ["Getuk Lindri", "snack", 5000, "🟣", "Getuk lindri singkong manis berbagai warna, khas Jawa Tengah", "available", 35],
    ["Teh Manis Dingin", "minuman", 5000, "🍵", "Teh manis segar, cocok menemani makan siang", "available", 110],
    ["Es Jeruk Peras", "minuman", 8000, "🍊", "Jeruk peras segar tanpa pengawet, manis asam menyegarkan", "available", 88],
    ["Wedang Jahe", "minuman", 7000, "☕", "Jahe merah hangat dengan gula aren dan sereh, menghangatkan badan", "available", 42],
  ];
  const insertMany = db.transaction((rows) => { for (const r of rows) insert.run(...r); });
  insertMany(seed);
}

// ===== SEED: settings defaults =====
const defaults = {
  store_name: 'NokAyune',
  owner_wa: '6281234567890',
  address: 'Purwokerto, Jawa Tengah',
  open_hours: '07.00 – 20.00 WIB',
  min_order: '10',
  qris_static: '',
};
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO NOTHING');
for (const [k, v] of Object.entries(defaults)) {
  if (!getSetting.get(k)) setSetting.run(k, v);
}

module.exports = db;
