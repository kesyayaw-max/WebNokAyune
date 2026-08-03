const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Public: submit a contact message — now actually saved to the database (it used to just
// build a WhatsApp link and throw the message away, even though it told the customer
// "pesan sudah tercatat").
router.post('/', (req, res) => {
  const { name, phone, message } = req.body || {};
  if (!name || !phone || !message) {
    return res.status(400).json({ error: 'Nama, nomor WhatsApp, dan pesan wajib diisi.' });
  }
  if (phone && !/^[0-9+\- ()]{7,18}$/.test(phone)) {
    return res.status(400).json({ error: 'Format nomor WhatsApp tidak valid.' });
  }

  db.prepare('INSERT INTO contact_messages (name, phone, message) VALUES (?,?,?)')
    .run(String(name).slice(0, 200), String(phone).slice(0, 30), String(message).slice(0, 2000));

  // Get owner WhatsApp for the message
  const ownerWa = db.prepare("SELECT value FROM settings WHERE key = 'owner_wa'").get();
  const waNumber = (ownerWa?.value || '6281234567890').replace(/\D/g, '');

  // Build WhatsApp URL for the admin to easily reply
  const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(`Halo, saya ${name}. ${message}`)}`;

  res.json({
    ok: true,
    waUrl,
    message: 'Pesan Anda sudah tercatat. Klik tombol untuk lanjut ke WhatsApp.',
  });
});

// Admin: list contact messages, newest first
router.get('/', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100').all());
});

// Admin: mark a message as read
router.patch('/:id/read', requireAuth, (req, res) => {
  const info = db.prepare('UPDATE contact_messages SET read = 1 WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Pesan tidak ditemukan.' });
  res.json({ ok: true });
});

module.exports = router;
