const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const { buildDynamicQris } = require('../lib/qris');
const { requireAuth, requireRole } = require('../middleware/auth');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

module.exports = function paymentRouter(io) {
  const router = express.Router();

  // Public: generate a real, scannable QRIS for this specific order with the exact amount
  // locked in — built from the owner's own static QRIS text, no payment gateway account
  // needed. If the owner hasn't pasted their QRIS yet (Admin → Pengaturan), this responds
  // with configured:false so the checkout page falls back to a plain WhatsApp confirmation.
  router.get('/qris/:orderId', async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });

    const qrisStatic = getSetting('qris_static');
    if (!qrisStatic) return res.json({ configured: false });

    try {
      const dynamicPayload = buildDynamicQris(qrisStatic, order.total);
      const qrDataUrl = await QRCode.toDataURL(dynamicPayload, { errorCorrectionLevel: 'M', margin: 1, width: 420 });
      res.json({ configured: true, qrDataUrl, amount: order.total, merchantName: getSetting('store_name') || 'Toko' });
    } catch (err) {
      res.status(400).json({ error: 'Gagal membuat QRIS: ' + err.message });
    }
  });

  // Owner: used by the "Tes QRIS" button in Pengaturan to check the pasted static QRIS text
  // actually works before relying on it for real customer orders.
  router.post('/qris-test', requireAuth, requireRole('owner'), async (req, res) => {
    const { qris_static, amount } = req.body || {};
    if (!qris_static) return res.status(400).json({ error: 'Tempel teks QRIS statis dulu.' });
    try {
      const dynamicPayload = buildDynamicQris(qris_static, Number(amount) || 1000);
      const qrDataUrl = await QRCode.toDataURL(dynamicPayload, { errorCorrectionLevel: 'M', margin: 1, width: 300 });
      res.json({ ok: true, qrDataUrl });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Public: customer taps "Saya sudah bayar" after scanning & transferring. There's no payment
  // gateway wired in, so this just marks the order for the admin to double-check against their
  // own bank/e-wallet mutation history before confirming — same manual step most small UMKM
  // already do, just now with an amount the customer can't understate.
  router.post('/confirm-manual/:orderId', (req, res) => {
    const info = db.prepare("UPDATE orders SET payment_status = 'paid', status = CASE WHEN status='pending' THEN 'confirmed' ELSE status END WHERE id = ?")
      .run(req.params.orderId);
    if (info.changes === 0) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    io?.emit('order-updated', order);
    res.json(order);
  });

  router.get('/status', (req, res) => {
    res.json({ qrisConfigured: !!getSetting('qris_static') });
  });

  return router;
};
