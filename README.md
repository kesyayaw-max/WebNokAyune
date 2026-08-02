# 🍃 NokAyune — Backend + Website Catering UMKM

Website catering modern untuk UMKM. Full-stack Node.js/Express + SQLite + vanilla JS frontend.
Pesan online, bayar QRIS (tanpa payment gateway berbayar), multi-wilayah, real-time notifikasi.

## ✨ Fitur Utama

### Untuk Pelanggan
- 🛒 **Keranjang belanja** — pilih menu, atur jumlah, checkout
- 📍 **Multi-wilayah** — pilih area pengiriman, menu bisa beda per wilayah
- 💳 **QRIS dinamis** — nominal otomatis terkunci sesuai total, tidak bisa dicurangi
- 🔍 **Lacak pesanan** — cek status pakai nomor order + WhatsApp
- 🌙 **Dark mode** — tampilan terang & gelap otomatis
- 📱 **Progressive Web App** — bisa di-install seperti aplikasi di HP
- 🎯 **Step indicator checkout** — progress bar 4 langkah (Keranjang → Data → Bayar → Selesai)
- 🔥 **Rekomendasi menu** — upsell menu terlaris di halaman checkout
- 📤 **Share & copy order** — bagikan detail pesanan via WhatsApp atau salin ke clipboard
- ❓ **FAQ accordion** — pertanyaan umum dijawab langsung di halaman

### Untuk Admin
- 👥 **Role-based access** — Owner (akses penuh) & Kasir (pesanan saja)
- 📋 **Manajemen pesanan** — update status, batalkan pesanan (stok kembali otomatis)
- 🍱 **Manajemen menu** — CRUD menu + upload foto + preview + stok + wilayah
- 📊 **Statistik** — grafik pendapatan 7 hari, menu terlaris, stok menipis
- 📥 **Export CSV** — download laporan pesanan (bisa dibuka Excel)
- 🔔 **Real-time notifikasi** — bunyi + browser notification saat pesanan baru (Socket.IO)
- ⚙️ **Pengaturan toko** — nama, WhatsApp, alamat, jam buka, minimum order
- 📍 **Kelola wilayah** — tambah/edit/nonaktifkan wilayah dengan WhatsApp sendiri
- 💳 **QRIS setup** — tempel teks QRIS statis, langsung tes pratinjau

## 🚀 Deploy ke Railway

### Cara deploy (tanpa Docker)
1. Fork/clone repo ini ke GitHub
2. Di Railway: **New Project → Deploy from GitHub repo**
3. Railway auto-detect Node.js dari `package.json`
4. Tambahkan environment variable:
   ```
   JWT_SECRET=<string acak panjang, minimal 32 karakter>
   ```
5. Deploy! Railway akan jalankan `npm install && npm start`
6. Buka domain Railway yang diberikan (mis. `nokayune.up.railway.app`)

### Cara deploy (dengan Docker)
1. Pastikan `Dockerfile` dan `docker-compose.yml` sudah ada
2. Di Railway: pilih **Deploy from Dockerfile**
3. Set env variable `JWT_SECRET`
4. Deploy

### Setelah deploy — langkah wajib
1. Buka `https://domainkamu.railway.app` → klik **Admin** di footer
2. Login: `admin` / `nokayune123`
3. **Ganti password** di Pengaturan → Ganti Password
4. Atur **QRIS** di Pengaturan → Pembayaran QRIS
5. Atur **nomor WhatsApp** di Pengaturan → Informasi Toko
6. Tambah/edit **wilayah** di Pengaturan → Kelola Wilayah

## 💻 Development (lokal)

```bash
git clone <repo-url>
cd nokayune-backend
npm install
cp .env.example .env
# Edit .env, isi JWT_SECRET dengan string acak
npm run dev
```

Buka `http://localhost:3000`

## 📁 Struktur Proyek

```
nokayune-backend/
├── server.js           # Entry point — Express + Socket.IO + backup + graceful shutdown
├── db.js               # SQLite schema + seed data + migrations
├── package.json        # Dependencies
├── Dockerfile          # Docker image
├── docker-compose.yml  # Docker compose
├── railway.json        # Railway config
├── .nvmrc              # Node 20
├── .env.example        # Template environment
├── .gitignore
├── middleware/
│   └── auth.js         # JWT + role check + brute-force protection
├── routes/
│   ├── admin.js        # Login, staf, settings, ganti password
│   ├── contact.js      # Form kontak → WhatsApp
│   ├── menu.js         # CRUD menu + upload foto
│   ├── orders.js       # Buat pesanan, lacak, update status, cancel, validasi HP
│   ├── payment.js      # QRIS dinamis, konfirmasi manual
│   ├── regions.js      # CRUD wilayah
│   └── stats.js        # Dashboard stats + export CSV
├── lib/
│   └── qris.js         # Parsing QRIS statis → dinamis (EMV TLV + CRC16)
├── public/             # Frontend SPA
│   ├── index.html      # Semua halaman (home, menu, cart, checkout, dll.)
│   ├── style.css       # Desain premium (light/dark mode, animasi, responsive)
│   ├── app.js          # State management, API calls, real-time, UX
│   ├── manifest.json   # PWA manifest
│   └── assets/         # Logo, favicon, OG image
├── uploads/            # Foto menu (dibuat otomatis)
├── backups/            # Auto-backup database setiap 6 jam
└── nokayune.db         # SQLite database (dibuat otomatis)
```

## 🔒 Keamanan

- JWT auth dengan expiry 12 jam
- Password di-hash pakai bcrypt (10 rounds)
- Rate limiting: 200 req/menit global, 10/menit untuk order
- Brute-force protection: 5x gagal login → lock 60 detik
- Validasi nomor HP Indonesia (format 08xx)
- Validasi server-side untuk harga dan stok — tidak percaya input client
- CORS configurable via env
- Graceful shutdown + auto-backup database

## 📝 Catatan

- **QRIS manual**: Karena bukan payment gateway resmi (Midtrans dll), admin tetap perlu cek mutasi rekening sebelum konfirmasi pembayaran. Tapi nominal sudah terkunci di QR — pelanggan tidak bisa mengetik nominal lebih kecil.
- **Backup**: Database otomatis di-backup ke folder `backups/` setiap 6 jam. Maksimal 14 backup disimpan.
- **Production**: Pastikan `JWT_SECRET` diisi string acak panjang, `CORS_ORIGIN` di-set ke domain production, dan ganti password admin default segera.

---

© 2025 NokAyune — Dibuat dengan 🍃 untuk UMKM Indonesia.
