const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

module.exports = function ordersRouter(io) {
  const router = express.Router();

  // Public: create order. Prices are looked up server-side — never trust client-sent prices.
  router.post('/', (req, res) => {
    const { name, phone, address, time, notes, items } = req.body || {};
    if (!name || !phone || !address || !time || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Data pesanan tidak lengkap.' });
    }

    const lineItems = [];
    let total = 0;
    for (const it of items) {
      const menuItem = db.prepare('SELECT * FROM menu WHERE id = ?').get(it.id);
      if (!menuItem || menuItem.status === 'soldout') {
        return res.status(400).json({ error: `Menu "${it.name || it.id}" tidak tersedia lagi.` });
      }
      const qty = Math.max(1, Number(it.qty) || 1);
      lineItems.push({ menu_id: menuItem.id, name: menuItem.name, price: menuItem.price, qty });
      total += menuItem.price * qty;
    }

    const orderId = 'NA' + Date.now().toString().slice(-6);
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO orders (id, name, phone, address, deliver_time, notes, total, status, payment_status)
                  VALUES (?,?,?,?,?,?,?, 'pending', 'unpaid')`)
        .run(orderId, name, phone, address, time, notes || '', total);
      const insertItem = db.prepare('INSERT INTO order_items (order_id, menu_id, name, price, qty) VALUES (?,?,?,?,?)');
      const bumpSold = db.prepare('UPDATE menu SET sold = sold + ? WHERE id = ?');
      for (const li of lineItems) {
        insertItem.run(orderId, li.menu_id, li.name, li.price, li.qty);
        bumpSold.run(li.qty, li.menu_id);
      }
    });
    tx();

    const order = { id: orderId, name, phone, address, deliver_time: time, notes, total, status: 'pending', items: lineItems };
    io?.emit('new-order', order);
    res.json(order);
  });

  // Public: customer tracks their own order by id + phone (no other data leaked)
  router.get('/track', (req, res) => {
    const { id, phone } = req.query;
    if (!id || !phone) return res.status(400).json({ error: 'Masukkan nomor pesanan dan nomor WhatsApp.' });
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND phone = ?').get(id, phone);
    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan. Periksa kembali nomor pesanan & WhatsApp.' });
    const items = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?').all(order.id);
    res.json({ ...order, items });
  });

  // Admin: paginated list with optional status filter
  router.get('/', requireAuth, (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const offset = (page - 1) * limit;
    const status = req.query.status;

    let where = '1=1';
    const params = [];
    if (status && status !== 'all') { where = 'status = ?'; params.push(status); }

    const total = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE ${where}`).get(...params).c;
    const rows = db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const itemsStmt = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?');
    const withItems = rows.map(o => ({ ...o, items: itemsStmt.all(o.id) }));

    res.json({ orders: withItems, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  });

  // Admin: update status (owner or kasir)
  router.patch('/:id/status', requireAuth, (req, res) => {
    const { status } = req.body || {};
    const valid = ['pending', 'confirmed', 'cooking', 'delivered', 'done'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
    const info = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    io?.emit('order-updated', order);
    res.json(order);
  });

  return router;
};
