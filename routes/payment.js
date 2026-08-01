const express = require('express');
const db = require('../db');

module.exports = function paymentRouter(io) {
  const router = express.Router();

  const midtransConfigured = !!process.env.MIDTRANS_SERVER_KEY;
  let snap = null;
  if (midtransConfigured) {
    const midtransClient = require('midtrans-client');
    snap = new midtransClient.Snap({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
    });
  }

  // Create a payment session for an existing order.
  // If Midtrans keys are set in .env, this returns a real Snap token (real QRIS/e-wallet/VA payment).
  // If not configured, it returns { simulated: true } so the frontend falls back to the static demo QR.
  router.post('/create-transaction/:orderId', async (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });

    if (!midtransConfigured) {
      return res.json({ simulated: true, order });
    }

    try {
      const transaction = await snap.createTransaction({
        transaction_details: { order_id: order.id + '-' + Date.now(), gross_amount: order.total },
        customer_details: { first_name: order.name, phone: order.phone },
        enabled_payments: ['gopay', 'shopeepay', 'other_qris', 'bank_transfer'],
      });
      res.json({ simulated: false, token: transaction.token, redirect_url: transaction.redirect_url });
    } catch (err) {
      res.status(502).json({ error: 'Gagal membuat transaksi pembayaran. Coba lagi atau hubungi via WhatsApp.', detail: err.message });
    }
  });

  // Manual confirmation for the simulated flow (customer taps "Saya sudah bayar")
  router.post('/confirm-manual/:orderId', (req, res) => {
    const info = db.prepare("UPDATE orders SET payment_status = 'paid', status = CASE WHEN status='pending' THEN 'confirmed' ELSE status END WHERE id = ?")
      .run(req.params.orderId);
    if (info.changes === 0) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    io?.emit('order-updated', order);
    res.json(order);
  });

  // Midtrans server-to-server notification webhook.
  // Requires a public HTTPS URL registered in the Midtrans dashboard — only reachable once this
  // backend is deployed somewhere public (see README).
  router.post('/notification', express.json(), async (req, res) => {
    if (!midtransConfigured) return res.status(400).json({ error: 'Midtrans belum dikonfigurasi.' });
    try {
      const statusResponse = await snap.transaction.notification(req.body);
      const rawOrderId = statusResponse.order_id.split('-')[0];
      const txStatus = statusResponse.transaction_status;
      const fraudStatus = statusResponse.fraud_status;

      let paymentStatus = null;
      if (txStatus === 'capture' && fraudStatus === 'accept') paymentStatus = 'paid';
      else if (txStatus === 'settlement') paymentStatus = 'paid';
      else if (['cancel', 'deny', 'expire'].includes(txStatus)) paymentStatus = 'unpaid';

      if (paymentStatus) {
        db.prepare("UPDATE orders SET payment_status = ?, status = CASE WHEN status='pending' AND ?='paid' THEN 'confirmed' ELSE status END WHERE id = ?")
          .run(paymentStatus, paymentStatus, rawOrderId);
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(rawOrderId);
        if (order) io?.emit('order-updated', order);
      }
      res.status(200).send('OK');
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/status', (req, res) => {
    res.json({ midtransConfigured });
  });

  return router;
};
