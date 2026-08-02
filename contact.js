const express = require('express');
const db = require('../db');

const router = express.Router();

// Public: submit a contact message (saved to DB + optionally forward to admin)
router.post('/', (req, res) => {
  const { name, phone, message } = req.body || {};
  if (!name || !phone || !message) {
    return res.status(400).json({ error: 'Nama, nomor WhatsApp, dan pesan wajib diisi.' });
  }
  if (phone && !/^[0-9+\- ()]{7,18}$/.test(phone)) {
    return res.status(400).json({ error: 'Format nomor WhatsApp tidak valid.' });
  }

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

module.exports = router;
