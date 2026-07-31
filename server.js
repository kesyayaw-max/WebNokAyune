require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders')(io));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/payment', require('./routes/payment')(io));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

io.on('connection', (socket) => {
  socket.on('join-admin', () => socket.join('admin-room'));
});

app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🍃 NokAyune backend jalan di http://localhost:${PORT}`);
});
