require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

// Logging
app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));

// CORS
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

// Global rate limiter: 200 req/min per IP
app.use(rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }
}));

// Stricter rate limiter for public order creation
const orderLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak pesanan. Coba lagi sebentar.' }
});

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/regions', require('./routes/regions'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders')(io));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/payment', require('./routes/payment')(io));
app.use('/api/contact', require('./routes/contact'));

// Rate-limited order creation
app.use('/api/orders', orderLimiter);

app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, db: true, time: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, db: false, time: new Date().toISOString() });
  }
});

io.on('connection', (socket) => {
  socket.on('join-admin', () => socket.join('admin-room'));
});

app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Terjadi kesalahan server.' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🍃 NokAyune backend jalan di http://localhost:${PORT}`);
});
