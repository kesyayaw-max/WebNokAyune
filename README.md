# NokAyune — Backend + Website

Backend Node.js/Express + SQLite untuk website catering NokAyune. Menggantikan versi
sebelumnya yang datanya cuma tersimpan di `localStorage` browser.

## Yang sudah jadi beneran di versi ini

- **Database asli (SQLite)** — menu, pesanan, dan akun admin tersimpan di server (file
  `nokayune.db`), bukan di browser. Bisa diakses dari HP/laptop mana pun setelah di-deploy.
- **Login admin aman** — password di-hash (bcrypt), sesi pakai JWT, ada rate-limit setelah
  5x gagal login.
- **Dua peran admin**: `owner` (akses penuh) dan `kasir` (cuma tab Pesanan — update status,
  tidak bisa ubah menu/pengaturan).
- **Upload foto menu asli** lewat dashboard admin (bukan cuma emoji lagi).
- **Lacak pesanan** — pelanggan bisa cek status pesanannya sendiri dengan nomor order + WhatsApp.
- **Pagination** di daftar pesanan admin.
- **Grafik pendapatan 7 hari** + menu terlaris di tab Statistik (pakai Chart.js).
- **Notifikasi real-time** — saat ada pesanan baru masuk, dashboard admin yang sedang terbuka
  langsung dapat bunyi + notifikasi browser + toast, tanpa perlu refresh (pakai Socket.IO).
- **Pembayaran**: kalau kamu belum punya akun Midtrans, sistem otomatis pakai QRIS simulasi
  (mode demo, sama seperti sebelumnya). Kalau sudah isi kunci Midtrans di `.env`, sistem
  otomatis pakai pembayaran sungguhan (QRIS/e-wallet/VA asli).

## Menjalankan di komputer sendiri (development)

```bash
cd nokayune-backend
npm install
cp .env.example .env
# buka .env, isi JWT_SECRET dengan string acak (wajib)
npm start
```

Buka `http://localhost:3000` di browser. Website & dashboard admin ada di alamat yang sama.

**Akun admin default** (WAJIB diganti setelah login pertama, lewat tab Pengaturan → Ganti Password):
- Owner: `admin` / `nokayune123`
- Kasir: `kasir` / `kasir123`

## Struktur folder

```
nokayune-backend/
  server.js         ← entry point
  db.js              ← skema database + data awal (menu & akun admin)
  middleware/auth.js ← cek JWT & peran admin
  routes/            ← menu, orders, admin, stats, payment
  public/            ← website (index.html, style.css, app.js) — di-serve langsung oleh server
  uploads/           ← foto menu yang di-upload admin (dibuat otomatis)
  nokayune.db        ← file database (dibuat otomatis saat pertama jalan)
```

## Supaya bisa dipakai pelanggan sungguhan (production)

Beberapa hal ini **tidak bisa aku setel dari sini** karena butuh akun/kredensial milik kamu:

### 1. Hosting (wajib)
Server ini perlu jalan terus-menerus di suatu tempat dengan alamat publik. Pilihan yang
ramah untuk pemula & gratis/murah untuk mulai: **Railway**, **Render**, atau VPS murah
(misalnya lewat provider lokal). Semua bisa jalankan aplikasi Node.js seperti ini — tinggal
upload folder ini (kecuali `node_modules` dan `.env`), lalu jalankan `npm install && npm start`.
Setelah itu kamu dapat alamat seperti `https://nokayune.up.railway.app`.

### 2. Payment gateway sungguhan (opsional, tapi disarankan)
1. Daftar akun di [midtrans.com](https://midtrans.com) (ada mode sandbox gratis untuk uji coba).
2. Ambil **Server Key** dan **Client Key** dari dashboard (Settings → Access Keys).
3. Isi ke file `.env`:
   ```
   MIDTRANS_SERVER_KEY=isi-server-key-kamu
   MIDTRANS_CLIENT_KEY=isi-client-key-kamu
   MIDTRANS_IS_PRODUCTION=false   # ganti "true" kalau sudah siap terima uang sungguhan
   ```
4. Di dashboard Midtrans, daftarkan URL notifikasi pembayaran:
   `https://alamat-website-kamu.com/api/payment/notification`
   (baru bisa didaftarkan setelah website sudah live/publik).

Tanpa langkah ini, website tetap jalan normal dengan QRIS simulasi seperti sebelumnya — cuma
belum bisa verifikasi pembayaran otomatis.

### 3. Domain sendiri (opsional)
Supaya alamatnya `nokayune.com` bukan `xxx.railway.app`, beli domain (mis. lewat Niagahoster/
Rumahweb) lalu arahkan (DNS) ke hosting kamu. Panduannya beda-beda tergantung provider hosting
yang dipilih — bilang saja platform yang kamu pakai nanti dan aku bantu langkah-langkahnya.

## Catatan keamanan

- Ganti `JWT_SECRET` di `.env` sebelum deploy — jangan pakai nilai contoh.
- Ganti password akun `admin` dan `kasir` bawaan segera setelah login pertama.
- File `.env` **jangan pernah** diunggah ke tempat publik (GitHub publik, dsb.) — sudah
  dimasukkan ke `.gitignore`.
- `uploads/` dan `nokayune.db` berisi data asli toko — pastikan hosting yang dipilih
  melakukan backup rutin.
