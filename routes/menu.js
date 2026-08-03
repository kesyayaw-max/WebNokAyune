const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const uploadDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `menu_${Date.now()}${ext}`);
  },
});
const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp'];
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.includes(ext)) return cb(new Error('Format foto harus jpg, jpeg, png, atau webp.'));
    cb(null, true);
  },
});

// Public: list menu. ?region=<id> shows items assigned to that region plus
// items with no region set (treated as "tersedia di semua wilayah").
router.get('/', (req, res) => {
  const { cat, status, region } = req.query;
  let sql = 'SELECT * FROM menu WHERE 1=1';
  const params = [];
  if (cat && cat !== 'all') { sql += ' AND cat = ?'; params.push(cat); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (region) { sql += ' AND (region_id = ? OR region_id IS NULL)'; params.push(region); }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...params));
});

// Stok bersifat opsional: kosongkan artinya stok tak terbatas (status diatur manual).
// Kalau diisi angka, status ikut mengikuti stok — otomatis "habis" saat stok 0.
function parseStock(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : null;
}
function deriveStatus(stock, manualStatus) {
  if (stock === null) return manualStatus || 'available';
  return stock <= 0 ? 'soldout' : 'available';
}
function parseRegionId(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Admin (owner): create menu item with optional photo
router.post('/', requireAuth, requireRole('owner'), upload.single('photo'), (req, res) => {
  const { name, cat, price, emoji, desc, status, stock, region_id } = req.body;
  if (!name || !cat || !price) return res.status(400).json({ error: 'Nama, kategori, dan harga wajib diisi.' });
  const image = req.file ? `/uploads/${req.file.filename}` : null;
  const stockVal = parseStock(stock);
  const info = db.prepare(`INSERT INTO menu (name, cat, price, emoji, image, desc, status, sold, stock, region_id) VALUES (?,?,?,?,?,?,?,0,?,?)`)
    .run(name, cat, Number(price), emoji || '🍽️', image, desc || '', deriveStatus(stockVal, status), stockVal, parseRegionId(region_id));
  res.json(db.prepare('SELECT * FROM menu WHERE id = ?').get(info.lastInsertRowid));
});

// Admin (owner): update menu item, optionally replace photo
router.put('/:id', requireAuth, requireRole('owner'), upload.single('photo'), (req, res) => {
  const existing = db.prepare('SELECT * FROM menu WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Menu tidak ditemukan.' });
  const { name, cat, price, emoji, desc, status, stock, region_id } = req.body;
  let image = existing.image;
  if (req.file) {
    if (existing.image) {
      const oldPath = path.join(uploadDir, path.basename(existing.image));
      fs.unlink(oldPath, () => {});
    }
    image = `/uploads/${req.file.filename}`;
  }
  const stockVal = stock === undefined ? existing.stock : parseStock(stock);
  const regionVal = region_id === undefined ? existing.region_id : parseRegionId(region_id);
  db.prepare(`UPDATE menu SET name=?, cat=?, price=?, emoji=?, image=?, desc=?, status=?, stock=?, region_id=? WHERE id=?`)
    .run(name ?? existing.name, cat ?? existing.cat, price ? Number(price) : existing.price,
         emoji ?? existing.emoji, image, desc ?? existing.desc, deriveStatus(stockVal, status ?? existing.status),
         stockVal, regionVal, req.params.id);
  res.json(db.prepare('SELECT * FROM menu WHERE id = ?').get(req.params.id));
});

// Admin (owner): delete
router.delete('/:id', requireAuth, requireRole('owner'), (req, res) => {
  const existing = db.prepare('SELECT * FROM menu WHERE id = ?').get(req.params.id);
  if (existing?.image) fs.unlink(path.join(uploadDir, path.basename(existing.image)), () => {});
  db.prepare('DELETE FROM menu WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
