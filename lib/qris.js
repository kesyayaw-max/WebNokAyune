// ===== QRIS statis → dinamis (nominal terkunci) =====
//
// QRIS Indonesia pakai format EMV QR Code (TLV: Tag-Length-Value). QRIS "statis" yang biasa
// dicetak di meja/warung TIDAK menyimpan nominal — jadi pembeli mengetik sendiri nominalnya,
// dan itu celah yang gampang disalahgunakan (ngetik lebih kecil dari harga asli).
//
// Trik yang dipakai banyak UMKM (tanpa perlu payment gateway berbayar): ambil teks mentah dari
// QRIS statis milik sendiri, sisipkan nominal ke Tag 54 (Transaction Amount), ubah Tag 01
// (Point of Initiation Method) dari "11" (statis) ke "12" (dinamis), lalu hitung ulang CRC16
// di Tag 63. Hasilnya: QR yang sama persis rekeningnya, tapi nominal sudah terkunci — dompet
// digital/mobile banking pembeli akan menampilkan nominal itu dan (tergantung aplikasi) tidak
// bisa diubah manual lagi.
//
// Referensi format: spesifikasi EMV QRCPS (dipakai QRIS Indonesia, standar Bank Indonesia).

function parseQris(payload) {
  const fields = {};
  let i = 0;
  while (i < payload.length - 1) {
    const tag = payload.substr(i, 2);
    const len = parseInt(payload.substr(i + 2, 2), 10);
    if (!Number.isFinite(len)) break;
    const value = payload.substr(i + 4, len);
    fields[tag] = value;
    i += 4 + len;
  }
  return fields;
}

function tlv(tag, value) {
  const len = String(value.length).padStart(2, '0');
  return `${tag}${len}${value}`;
}

// CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — sesuai spesifikasi EMV QR
function crc16(str) {
  let crc = 0xffff;
  for (let pos = 0; pos < str.length; pos++) {
    crc ^= str.charCodeAt(pos) << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Sisipkan nominal ke QRIS statis dan hasilkan payload dinamis yang sudah terkunci nominalnya.
 * @param {string} staticPayload teks mentah hasil scan QRIS statis (diawali "000201...")
 * @param {number} amount nominal dalam Rupiah (bilangan bulat)
 * @returns {string} payload QRIS dinamis siap di-generate jadi gambar QR
 */
function buildDynamicQris(staticPayload, amount) {
  const clean = String(staticPayload || '').replace(/[\r\n\t]+/g, '').trim();
  if (!clean || clean.length < 20) throw new Error('Teks QRIS tidak valid atau kosong.');

  const fields = parseQris(clean);
  if (!fields['00'] || !fields['58']) {
    throw new Error('Format QRIS tidak dikenali. Pastikan teks yang ditempel adalah hasil scan QRIS statis asli (diawali "000201...").');
  }

  fields['01'] = '12'; // 11 = statis, 12 = dinamis (nominal sudah ditentukan)
  fields['54'] = String(Math.max(0, Math.round(Number(amount) || 0)));
  delete fields['63']; // CRC lama sudah tidak berlaku, dihitung ulang di bawah

  const orderedTags = Object.keys(fields).sort((a, b) => a.localeCompare(b));
  let body = '';
  for (const t of orderedTags) body += tlv(t, fields[t]);
  body += '6304'; // tag + panjang CRC, nilainya menyusul
  const crc = crc16(body);
  return body + crc;
}

module.exports = { parseQris, buildDynamicQris, crc16 };
