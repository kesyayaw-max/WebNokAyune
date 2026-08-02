const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Public: hero stats for homepage (no auth needed)
router.get('/public', (req, res) => {
  const totalOrders = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  const topMenu = db.prepare('SELECT name, emoji, sold FROM menu ORDER BY sold DESC LIMIT 3').all();
  res.json({ totalOrders, topMenu });
});

// Admin: full stats
router.get('/', requireAuth, (req, res) => {
  const { region } = req.query;
  const regionCond = region && region !== 'all' ? 'AND region_id = ?' : '';
  const regionParams = region && region !== 'all' ? [region] : [];

  const total = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE 1=1 ${regionCond}`).get(...regionParams).c;
  const revenue = db.prepare(`SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE (status != 'pending' OR payment_status = 'paid') ${regionCond}`).get(...regionParams).s;
  const pending = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE status = 'pending' ${regionCond}`).get(...regionParams).c;
  const activeItems = db.prepare("SELECT COUNT(*) AS c FROM menu WHERE status = 'available'").get().c;
  const lowStock = db.prepare("SELECT COUNT(*) AS c FROM menu WHERE stock IS NOT NULL AND stock > 0 AND stock <= 5").get().c;
  const topMenu = db.prepare('SELECT name, emoji, sold FROM menu ORDER BY sold DESC LIMIT 5').all();
  const regions = db.prepare('SELECT * FROM regions ORDER BY name ASC').all();

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = db.prepare(`SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE date(created_at) = ? ${regionCond}`).get(key, ...regionParams);
    days.push({ date: key, revenue: row.s });
  }

  res.json({ total, revenue, pending, activeItems, lowStock, topMenu, last7Days: days, regions });
});

// Admin: export orders to CSV
router.get('/export', requireAuth, (req, res) => {
  const { region } = req.query;
  const regionCond = region && region !== 'all' ? 'WHERE region_id = ?' : '';
  const params = region && region !== 'all' ? [region] : [];

  const orders = db.prepare(`SELECT orders.*, regions.name AS region_name FROM orders LEFT JOIN regions ON regions.id = orders.region_id ${regionCond} ORDER BY created_at DESC`).all(...params);
  const itemsStmt = db.prepare('SELECT name, qty, price FROM order_items WHERE order_id = ?');

  // Build CSV
  const header = 'Order ID,Nama,WhatsApp,Alamat,Waktu Kirim,Catatan,Total,Status,Pembayaran,Wilayah,Items\n';
  const rows = orders.map(o => {
    const items = itemsStmt.all(o.id);
    const itemsStr = items.map(it => `${it.name} x${it.qty}`).join('; ');
    return [
      o.id,
      `"${(o.name || '').replace(/"/g, '""')}"`,
      o.phone,
      `"${(o.address || '').replace(/"/g, '""')}"`,
      o.deliver_time,
      `"${(o.notes || '').replace(/"/g, '""')}"`,
      o.total,
      statusLabel(o.status),
      o.payment_status === 'paid' ? 'Lunas' : 'Belum',
      o.region_name || '-',
      `"${itemsStr.replace(/"/g, '""')}"`,
    ].join(',');
  }).join('\n');

  const csv = '\uFEFF' + header + rows; // BOM for Excel UTF-8
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=nokayune-orders-${new Date().toISOString().slice(0, 10)}.csv`);
  res.send(csv);
});

function statusLabel(s) {
  return { pending: 'Menunggu', confirmed: 'Dikonfirmasi', cooking: 'Dimasak', delivered: 'Dikirim', done: 'Selesai', cancelled: 'Dibatalkan' }[s] || s;
}

module.exports = router;
