require('dotenv').config();

// Ensure required env vars for production
if (!process.env.JWT_SECRET) {
  console.error('❌ ERROR: JWT_SECRET environment variable is required.');
  console.error('   cp .env.example .env && nano .env  # lalu isi JWT_SECRET');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const db = require('./db');

// Ensure required directories exist
['uploads', 'backups'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

const app = express();
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN },
  // Railway proxy support
  allowEIO3: true,
  pingTimeout: 60000,
});

// ─── Logging ───
app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));

// ─── CORS ───
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

// ─── Trust proxy (Railway, Render, etc.) ───
app.set('trust proxy', 1);

// ─── Rate limiting ───
app.use(rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }
}));

const orderLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak pesanan. Coba lagi sebentar.' }
});

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// ─── API Routes ───
app.use('/api/regions', require('./routes/regions'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', orderLimiter);
app.use('/api/orders', require('./routes/orders')(io));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/payment', require('./routes/payment')(io));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/reviews', require('./routes/reviews'));

// ─── Health check ───
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, db: true, uptime: process.uptime(), time: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, db: false, time: new Date().toISOString() });
  }
});

// ─── Socket.IO ───
io.on('connection', (socket) => {
  socket.on('join-admin', () => socket.join('admin-room'));
});

// ─── SPA fallback ───
app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global error handler ───
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.stack || err.message || err);
  res.status(500).json({ error: 'Terjadi kesalahan server.' });
});

// ─── Auto-backup database every 6 hours ───
function backupDatabase() {
  const src = path.join(__dirname, 'nokayune.db');
  if (!fs.existsSync(src)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(__dirname, 'backups', `nokayune-${stamp}.db`);
  try {
    // Use SQLite backup API for consistent backup
    db.backup(dest).then(() => {
      console.log(`📦 Database di-backup ke backups/`);
      // Keep only last 14 backups
      const files = fs.readdirSync(path.join(__dirname, 'backups'))
        .filter(f => f.startsWith('nokayune-') && f.endsWith('.db'))
        .sort();
      while (files.length > 14) {
        fs.unlinkSync(path.join(__dirname, 'backups', files.shift()));
      }
    }).catch(e => console.error('Backup gagal:', e.message));
  } catch (e) {
    // Fallback: simple file copy
    try {
      fs.copyFileSync(src, dest);
      console.log(`📦 Database di-backup (fallback) ke backups/`);
    } catch (e2) {
      console.error('Backup fallback gagal:', e2.message);
    }
  }
}

// Run backup every 6 hours
setInterval(backupDatabase, 6 * 60 * 60 * 1000);
// Also backup on startup (after 30s so DB is initialized)
setTimeout(backupDatabase, 30_000);

// ─── Graceful shutdown ───
function gracefulShutdown(signal) {
  console.log(`\n🛑 ${signal} diterima — menutup server dengan rapi...`);
  server.close(() => {
    console.log('✔ Server HTTP ditutup.');
    try {
      db.close();
      console.log('✔ Database ditutup.');
    } catch (e) {
      console.error('Error closing DB:', e.message);
    }
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => { console.error('⚠️ Force exit setelah timeout.'); process.exit(1); }, 10_000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err);
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
});

// ─── Start ───
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🍃 NokAyune v2 jalan di http://0.0.0.0:${PORT}`);
  console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   DB: SQLite (WAL) | Backup: setiap 6 jam`);
});
