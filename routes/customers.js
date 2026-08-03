const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const CUSTOMER_JWT_SECRET = process.env.JWT_SECRET + '-customer';

const router = express.Router();

// Register: phone + name + 4-digit PIN
router.post('/register', (req, res) => {
  const { name, phone, pin } = req.body || {};
  if (!name || !phone || !pin) return res.status(400).json({ error: 'Nama, nomor HP, dan PIN wajib diisi.' });
  if (!/^(\+62|62|0)8[1-9][0-9]{6,12}$/.test(phone.replace(/[\s\-()]/g, ''))) {
    return res.status(400).json({ error: 'Format nomor HP tidak valid. Gunakan 08xxxxxxxxxx.' });
  }
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN harus 4 digit angka.' });

  const cleanPhone = phone.replace(/[\s\-()]/g, '');
  try {
    db.prepare('INSERT INTO customers (name, phone, pin_hash) VALUES (?,?,?)').run(name, cleanPhone, bcrypt.hashSync(pin, 8));
    const customer = db.prepare('SELECT id, name, phone FROM customers WHERE phone = ?').get(cleanPhone);
    const token = jwt.sign({ id: customer.id, name: customer.name, phone: customer.phone }, CUSTOMER_JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, customer: { id: customer.id, name: customer.name, phone: customer.phone } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Nomor HP sudah terdaftar. Silakan login.' });
    res.status(500).json({ error: 'Gagal mendaftar.' });
  }
});

// Login: phone + PIN
router.post('/login', (req, res) => {
  const { phone, pin } = req.body || {};
  if (!phone || !pin) return res.status(400).json({ error: 'Nomor HP dan PIN wajib diisi.' });

  const cleanPhone = phone.replace(/[\s\-()]/g, '');
  const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(cleanPhone);
  if (!customer || !bcrypt.compareSync(pin, customer.pin_hash)) {
    return res.status(401).json({ error: 'Nomor HP atau PIN salah.' });
  }

  const token = jwt.sign({ id: customer.id, name: customer.name, phone: customer.phone }, CUSTOMER_JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, customer: { id: customer.id, name: customer.name, phone: customer.phone } });
});

// Get my profile
router.get('/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Belum login.' });
  try {
    const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET);
    res.json({ id: decoded.id, name: decoded.name, phone: decoded.phone });
  } catch {
    res.status(401).json({ error: 'Sesi tidak valid.' });
  }
});

// Get my orders
router.get('/orders', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Belum login.' });
  try {
    const decoded = jwt.verify(token, CUSTOMER_JWT_SECRET);
    const orders = db.prepare(`SELECT orders.*, regions.name AS region_name FROM orders
      LEFT JOIN regions ON regions.id = orders.region_id
      WHERE orders.phone = ? ORDER BY created_at DESC LIMIT 50`).all(decoded.phone);
    const itemsStmt = db.prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?');
    res.json(orders.map(o => ({ ...o, items: itemsStmt.all(o.id) })));
  } catch {
    res.status(401).json({ error: 'Sesi tidak valid.' });
  }
});

// Owner: list customers (needed so admin can find someone to reset a PIN for)
router.get('/', requireAuth, requireRole('owner'), (req, res) => {
  res.json(db.prepare('SELECT id, name, phone, created_at FROM customers ORDER BY created_at DESC').all());
});

// Owner: reset a customer's PIN — this is the "lupa PIN" recovery path. There's no
// email/SMS-OTP infra here, so the flow is: customer contacts the shop via WhatsApp,
// owner verifies it's really them, then resets the PIN and relays the new one back.
router.post('/:id/reset-pin', requireAuth, requireRole('owner'), (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Pelanggan tidak ditemukan.' });
  const newPin = String(Math.floor(1000 + Math.random() * 9000));
  db.prepare('UPDATE customers SET pin_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPin, 8), customer.id);
  res.json({ ok: true, newPin, phone: customer.phone, name: customer.name });
});

module.exports = router;
