const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

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

  // Revenue for the last 7 days (for a simple chart)
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

module.exports = router;
