const express = require('express');
const db = require('../db');

const router = express.Router();

// Public: get latest approved reviews for homepage
router.get('/public', (req, res) => {
  const reviews = db.prepare('SELECT name, rating, comment, created_at FROM reviews ORDER BY created_at DESC LIMIT 10').all();
  const avg = db.prepare('SELECT ROUND(AVG(rating),1) AS avg FROM reviews').get();
  res.json({ reviews, avgRating: avg?.avg || 0, totalReviews: reviews.length });
});

// Customer: submit review (by order ID + phone match)
router.post('/', (req, res) => {
  const { order_id, phone, rating, comment } = req.body || {};
  if (!order_id || !phone || !rating) {
    return res.status(400).json({ error: 'Order ID, nomor HP, dan rating wajib diisi.' });
  }
  const r = Number(rating);
  if (r < 1 || r > 5) return res.status(400).json({ error: 'Rating harus 1-5.' });

  // Verify the order belongs to this phone and is done
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND phone = ? AND status = 'done'").get(order_id, phone);
  if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan atau belum selesai.' });

  // Check if already reviewed
  const existing = db.prepare('SELECT id FROM reviews WHERE order_id = ?').get(order_id);
  if (existing) return res.status(409).json({ error: 'Pesanan ini sudah direview.' });

  try {
    db.prepare('INSERT INTO reviews (order_id, name, rating, comment) VALUES (?,?,?,?)')
      .run(order_id, order.name, r, (comment || '').slice(0, 500));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Gagal menyimpan review.' });
  }
});

module.exports = router;
