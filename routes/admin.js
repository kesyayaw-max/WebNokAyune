const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, requireRole, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// Basic brute-force slow-down: track failed attempts per username in memory
const failedAttempts = new Map();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi.' });

  const key = String(username).toLowerCase();
  const fail = failedAttempts.get(key) || { count: 0, until: 0 };
  if (fail.until > Date.now()) {
    const wait = Math.ceil((fail.until - Date.now()) / 1000);
    return res.status(429).json({ error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${wait} detik.` });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    fail.count++;
    if (fail.count >= 5) fail.until = Date.now() + 60_000; // lock 60s after 5 fails
    failedAttempts.set(key, fail);
    return res.status(401).json({ error: 'Username atau password salah.' });
  }
  failedAttempts.delete(key);

  const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role, name: admin.name }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, admin: { username: admin.username, role: admin.role, name: admin.name } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ admin: req.admin });
});

// Change own password
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password baru minimal 6 karakter.' });
  }
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(currentPassword, admin.password_hash)) {
    return res.status(401).json({ error: 'Password saat ini salah.' });
  }
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), admin.id);
  res.json({ ok: true });
});

// Owner-only: manage staff accounts
router.get('/staff', requireAuth, requireRole('owner'), (req, res) => {
  res.json(db.prepare('SELECT id, username, role, name FROM admins').all());
});

router.post('/staff', requireAuth, requireRole('owner'), (req, res) => {
  const { username, password, role, name } = req.body || {};
  if (!username || !password || !name || !['owner', 'kasir'].includes(role)) {
    return res.status(400).json({ error: 'Data staf tidak lengkap.' });
  }
  try {
    db.prepare('INSERT INTO admins (username, password_hash, role, name) VALUES (?,?,?,?)')
      .run(username, bcrypt.hashSync(password, 10), role, name);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'Username sudah dipakai.' });
  }
});

router.delete('/staff/:id', requireAuth, requireRole('owner'), (req, res) => {
  if (Number(req.params.id) === req.admin.id) return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri.' });
  db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Settings
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/settings', requireAuth, requireRole('owner'), (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction((obj) => { for (const [k, v] of Object.entries(obj)) upsert.run(k, String(v)); });
  tx(req.body || {});
  res.json({ ok: true });
});

module.exports = router;
