const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Public: list active regions (customer picks one before browsing the menu)
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM regions WHERE active = 1 ORDER BY name ASC').all());
});

// Admin (owner): list every region, including inactive ones, for management
router.get('/all', requireAuth, requireRole('owner'), (req, res) => {
  res.json(db.prepare('SELECT * FROM regions ORDER BY name ASC').all());
});

// Admin (owner): add a new region — this is how the UMKM expands to a new area
router.post('/', requireAuth, requireRole('owner'), (req, res) => {
  const { name, wa_number, address } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama wilayah wajib diisi.' });
  try {
    const info = db.prepare('INSERT INTO regions (name, wa_number, address, active) VALUES (?,?,?,1)')
      .run(name.trim(), wa_number || '', address || '');
    res.json(db.prepare('SELECT * FROM regions WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'Wilayah dengan nama itu sudah ada.' });
  }
});

// Admin (owner): edit a region's details or toggle it active/nonaktif
router.put('/:id', requireAuth, requireRole('owner'), (req, res) => {
  const existing = db.prepare('SELECT * FROM regions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Wilayah tidak ditemukan.' });
  const { name, wa_number, address, active } = req.body || {};
  try {
    db.prepare('UPDATE regions SET name=?, wa_number=?, address=?, active=? WHERE id=?').run(
      (name ?? existing.name).trim(),
      wa_number ?? existing.wa_number,
      address ?? existing.address,
      active === undefined ? existing.active : (active ? 1 : 0),
      req.params.id
    );
    res.json(db.prepare('SELECT * FROM regions WHERE id = ?').get(req.params.id));
  } catch (e) {
    res.status(400).json({ error: 'Wilayah dengan nama itu sudah ada.' });
  }
});

// Admin (owner): delete a region — blocked if menu items or orders still reference it,
// so data doesn't silently orphan; deactivate instead if it's just retired for now.
router.delete('/:id', requireAuth, requireRole('owner'), (req, res) => {
  const menuCount = db.prepare('SELECT COUNT(*) AS c FROM menu WHERE region_id = ?').get(req.params.id).c;
  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE region_id = ?').get(req.params.id).c;
  if (menuCount > 0 || orderCount > 0) {
    return res.status(400).json({ error: `Wilayah masih dipakai oleh ${menuCount} menu dan ${orderCount} pesanan. Nonaktifkan saja daripada dihapus.` });
  }
  const info = db.prepare('DELETE FROM regions WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Wilayah tidak ditemukan.' });
  res.json({ ok: true });
});

module.exports = router;
