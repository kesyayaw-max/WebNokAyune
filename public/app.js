// ================== CONFIG & STATE ==================
const API = ''; // same origin
let menuData = [];        // public menu cache (available items shown to customers)
let adminMenuData = [];   // admin menu cache (includes sold-out items)
let cart = [];
let currentOrder = {};    // last created order (from API), used across checkout->payment->success
let editingMenuId = null;
let storeSettings = {};
let ordersPage = 1;
let ordersFilter = 'all';
let ordersRegionFilter = 'all';
let socket = null;
let regions = [];             // active regions (public, for customers)
let adminRegions = [];        // all regions incl. inactive (owner only)
let currentRegionId = null;   // wilayah currently selected by the customer
let loadingTimer = null;      // debounce loading overlay

// ================== THEME (dark mode) ==================
(function initTheme() {
  const saved = localStorage.getItem('nokayune_theme');
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('nokayune_theme', next);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

// ================== LOADING OVERLAY ==================
function showLoading(msg) {
  const ov = document.getElementById('loadingOverlay');
  const txt = document.getElementById('loadingText');
  if (ov) ov.style.display = 'flex';
  if (txt) txt.textContent = msg || 'Memproses...';
  clearTimeout(loadingTimer);
}
function hideLoading() {
  loadingTimer = setTimeout(() => {
    const ov = document.getElementById('loadingOverlay');
    if (ov) ov.style.display = 'none';
  }, 200);
}

// ================== TOAST ==================
const toastIcons = { error: '⚠️', info: 'ℹ️', success: '✅' };
function showToast(message, type) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' toast-' + type : '');
  const icon = toastIcons[type] || '';
  toast.innerHTML = `${icon ? `<span class="toast-icon">${icon}</span>` : ''}${message}`;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s ease forwards';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// ================== API HELPER ==================
function authHeaders() {
  const token = localStorage.getItem('nokayune_admin_token');
  return token ? { Authorization: 'Bearer ' + token } : {};
}
async function apiFetch(url, opts = {}) {
  const res = await fetch(API + url, {
    ...opts,
    headers: { ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...authHeaders(), ...(opts.headers || {}) },
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    if (res.status === 401 && localStorage.getItem('nokayune_admin_token')) {
      adminLogout(true);
    }
    throw new Error(data.error || 'Terjadi kesalahan. Coba lagi.');
  }
  return data;
}

// ================== CUSTOM CONFIRM MODAL ==================
let _confirmResolve = null;
function showConfirm(title, message) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMsg').textContent = message;
    document.getElementById('confirmModal').style.display = 'flex';
    document.getElementById('confirmModalOk').focus();
  });
}
function closeConfirmModal(result) {
  document.getElementById('confirmModal').style.display = 'none';
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}
document.getElementById('confirmModalOk').addEventListener('click', () => closeConfirmModal(true));
document.getElementById('confirmModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeConfirmModal(false); });

// ================== HERO STATS (from API) ==================
async function loadHeroStats() {
  try {
    const stats = await apiFetch('/api/stats/public');
    const heroTotal = document.getElementById('heroTotalOrders');
    if (heroTotal) heroTotal.textContent = stats.totalOrders + '+';
    const topName = document.getElementById('heroTopMenu');
    if (topName && stats.topMenu[0]) topName.textContent = stats.topMenu[0].name;
  } catch { /* non-fatal, fallback to hardcoded */ }
}

// ================== IMAGE UPLOAD PREVIEW ==================
function initUploadPreview(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input || !preview) return;
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) { preview.classList.remove('show'); return; }
    if (file.size > 3 * 1024 * 1024) { showToast('Foto terlalu besar (maks 3MB).', 'error'); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `<img src="${e.target.result}" alt="Preview"/><div class="preview-info">${file.name} (${(file.size/1024).toFixed(1)} KB)</div>`;
      preview.classList.add('show');
    };
    reader.readAsDataURL(file);
  });
}

// ================== MENU RECOMMENDATIONS ==================
function loadRecommendations() {
  const tray = document.getElementById('recTray');
  if (!tray) return;
  const top = menuData.filter(m => m.status === 'available').sort((a, b) => b.sold - a.sold).slice(0, 4);
  if (!top.length) { tray.innerHTML = ''; return; }
  const cartIds = cart.map(c => c.id);
  const recs = top.filter(m => !cartIds.includes(m.id));
  if (!recs.length) { tray.innerHTML = ''; return; }
  tray.innerHTML = `<h4>🔥 Pelanggan juga suka</h4><div class="rec-items">${recs.map(m => `
    <div class="rec-card" onclick="addToCart(${m.id})">
      <div class="rec-emoji">${m.emoji || '🍽️'}</div>
      <div class="rec-name">${m.name}</div>
      <div class="rec-price">${fmtRp(m.price)}</div>
    </div>`).join('')}</div>`;
}

// ================== SHARE ==================
function shareToWA() {
  const order = window._successOrder || currentOrder;
  if (!order) return;
  const text = encodeURIComponent(`🍃 Pesan catering di NokAyune! 🍃\n\nMenu: ${(order.items||[]).map(i=>i.name).join(', ')}\nTotal: ${fmtRp(order.total)}\n\nPesan sekarang juga!`);
  window.open(`https://wa.me/?text=${text}`, '_blank');
}
function copyOrderText() {
  const order = window._successOrder || currentOrder;
  if (!order) return;
  const text = `Pesanan NokAyune #${order.id}\nNama: ${order.name}\nTotal: ${fmtRp(order.total)}\nStatus: ${statusLabel(order.status)}`;
  navigator.clipboard.writeText(text).then(() => showToast('Detail pesanan disalin!')).catch(() => showToast('Gagal menyalin.', 'error'));
}

// ================== LAZY LOAD IMAGES ==================
function initLazyImages() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.onload = () => img.classList.add('loaded');
        }
        img.classList.add('loaded');
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '100px' });
  document.querySelectorAll('img[loading="lazy"]').forEach(img => observer.observe(img));
}

// ================== PREMIUM: SCROLL PROGRESS BAR ==================
window.addEventListener('scroll', () => {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  bar.style.width = docHeight > 0 ? `${(scrollTop / docHeight) * 100}%` : '0%';
}, { passive: true });

// ================== PREMIUM: BUTTON RIPPLE EFFECT ==================
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-primary, .btn-outline, .btn-ghost, .order-btn, .filter-btn, .add-btn');
  if (!btn) return;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

// ================== PREMIUM: CARD 3D TILT ==================
function initTilt() {
  document.querySelectorAll('.menu-card').forEach(card => {
    card.classList.add('tilt-active');
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -6;
      const rotateY = ((x - centerX) / centerX) * 6;
      card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(800px) rotateX(0) rotateY(0) translateY(0)';
    });
  });
}

// ================== PREMIUM: ANIMATED COUNTER ==================
function animateCounter(el, target, duration) {
  if (!el) return;
  const start = 0;
  const startTime = performance.now();
  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    const current = Math.round(start + (target - start) * eased);
    el.textContent = current >= 1000 ? (current / 1000).toFixed(1) + 'rb+' : current + '+';
    if (progress < 1) requestAnimationFrame(update);
    else el.textContent = target >= 1000 ? Math.round(target/1000) + 'rb+' : target + '+';
  }
  requestAnimationFrame(update);
}

// ================== PREMIUM: PARALLAX HERO ==================
function initParallax() {
  const hero = document.querySelector('.hero');
  const blobs = document.querySelectorAll('.hero-blob');
  if (!hero) return;
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    if (scrollY > window.innerHeight) return;
    blobs.forEach((blob, i) => {
      const speed = (i + 1) * 0.04;
      blob.style.transform = `translateY(${scrollY * speed}px)`;
    });
  }, { passive: true });
}

// ================== PREMIUM: STAGGERED MENU ANIMATION ==================
function staggerCards(containerSelector) {
  const grid = document.querySelector(containerSelector);
  if (!grid) return;
  const cards = grid.querySelectorAll('.menu-card:not(.stagger-in)');
  cards.forEach((card, i) => {
    card.classList.add('stagger-in');
    card.style.animationDelay = `${i * 0.06}s`;
  });
}

// ================== PREMIUM: FLOATING WA UPDATER ==================
function updateFloatWA() {
  const btn = document.getElementById('floatWA');
  if (!btn) return;
  const region = regions.find(r => r.id === currentRegionId);
  const waNumber = (region?.wa_number || storeSettings.owner_wa || '6281234567890').replace(/\D/g, '');
  btn.href = `https://wa.me/${waNumber}?text=${encodeURIComponent('Halo NokAyune! Saya mau tanya soal catering...')}`;
  // Hide on admin pages
  const isAdminPage = document.getElementById('page-admin')?.classList.contains('active') ||
                      document.getElementById('page-admin-login')?.classList.contains('active');
  btn.style.display = isAdminPage ? 'none' : '';
}

// ================== PREMIUM: PROMO BANNER ==================
function initPromoBanner() {
  const banner = document.getElementById('promoBanner');
  if (!banner) return;
  const promoText = storeSettings.promo_text;
  const promoLink = storeSettings.promo_link;
  if (promoText && !localStorage.getItem('nokayune_promo_dismissed')) {
    document.getElementById('promoBannerText').textContent = promoText;
    banner.style.display = '';
    banner.dataset.link = promoLink || '';
  }
}
function dismissPromo() {
  document.getElementById('promoBanner').style.display = 'none';
  localStorage.setItem('nokayune_promo_dismissed', '1');
}
function handlePromoClick() {
  const link = document.getElementById('promoBanner').dataset.link;
  if (link) window.open(link, '_blank');
}

// ================== PREMIUM: COUNTDOWN TIMER ==================
let countdownInterval = null;
function startCountdown(minutes) {
  const el = document.getElementById('countdownTime');
  if (!el) return;
  clearInterval(countdownInterval);
  let seconds = minutes * 60;
  function tick() {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (seconds <= 0) { clearInterval(countdownInterval); el.textContent = 'Segera!'; return; }
    seconds--;
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

// ================== MENU SEARCH ==================
function searchMenu(query) {
  const filter = getActiveMenuFilter();
  const q = (query || '').toLowerCase().trim();
  const items = filter === 'all' ? menuData : menuData.filter(m => m.cat === filter);
  const filtered = q ? items.filter(m => m.name.toLowerCase().includes(q) || (m.desc || '').toLowerCase().includes(q)) : items;
  const grid = document.getElementById('fullMenuGrid');
  if (!grid) return;
  grid.innerHTML = filtered.length ? filtered.map(m => menuCard(m)).join('') : `<div class="empty-state" style="grid-column:1/-1;">
    <div class="empty-icon">🔍</div><h3>Tidak ditemukan</h3><p>Tidak ada menu yang cocok dengan "${q}".</p></div>`;
  if (filtered.length) { requestAnimationFrame(() => { staggerCards('#fullMenuGrid'); initTilt(); }); }
}

// ================== QUICK NOTES ==================
function addQuickNote(text) {
  const ta = document.getElementById('co-notes');
  if (!ta) return;
  const current = ta.value.trim();
  ta.value = current ? current + '; ' + text : text;
  // Highlight selected
  document.querySelectorAll('.quick-note').forEach(n => {
    n.classList.toggle('selected', n.textContent.includes(text));
    setTimeout(() => n.classList.remove('selected'), 600);
  });
}

// ================== SAVED ADDRESSES ==================
function loadSavedAddresses() {
  const el = document.getElementById('savedAddresses');
  if (!el) return;
  try {
    const addrs = JSON.parse(localStorage.getItem('nokayune_addresses') || '[]');
    if (!addrs.length) { el.innerHTML = ''; return; }
    el.innerHTML = addrs.map((a, i) => `
      <div class="saved-addr" onclick="fillAddress('${a.name.replace(/'/g, "\\'")}','${a.address.replace(/'/g, "\\'")}')">
        <span>📍 ${a.name} — ${a.address.slice(0,60)}${a.address.length>60?'...':''}</span>
        <span class="addr-delete" onclick="event.stopPropagation();deleteAddress(${i})">✕</span>
      </div>`).join('');
  } catch { el.innerHTML = ''; }
}
function fillAddress(name, address) {
  document.getElementById('co-name').value = name;
  document.getElementById('co-address').value = address;
  showToast('Alamat diisi dari riwayat');
}
function autoSaveAddress() {
  const name = document.getElementById('co-name')?.value.trim();
  const addr = document.getElementById('co-address')?.value.trim();
  if (!name || !addr) return;
  try {
    let addrs = JSON.parse(localStorage.getItem('nokayune_addresses') || '[]');
    // Don't duplicate
    const exists = addrs.find(a => a.name === name && a.address === addr);
    if (!exists) {
      addrs.unshift({ name, address: addr });
      if (addrs.length > 5) addrs.pop();
      localStorage.setItem('nokayune_addresses', JSON.stringify(addrs));
    }
  } catch {}
}
function deleteAddress(i) {
  try {
    let addrs = JSON.parse(localStorage.getItem('nokayune_addresses') || '[]');
    addrs.splice(i, 1);
    localStorage.setItem('nokayune_addresses', JSON.stringify(addrs));
    loadSavedAddresses();
  } catch {}
}

// ================== PAYMENT PROOF UPLOAD ==================
let paymentProofData = null;
function handleProofUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { showToast('File terlalu besar (maks 3MB).', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    paymentProofData = e.target.result;
    const el = document.getElementById('proofUpload');
    const placeholder = document.getElementById('proofPlaceholder');
    if (el) el.classList.add('has-file');
    if (placeholder) placeholder.innerHTML = `<img src="${e.target.result}" alt="Bukti bayar" style="max-height:200px;border-radius:12px;"/><p style="margin-top:8px;font-weight:600;color:var(--leaf);">✓ Bukti bayar siap</p>`;
  };
  reader.readAsDataURL(file);
}

// ================== PRINT INVOICE ==================
function printInvoice() {
  window.print();
}

// ================== SOCIAL LINKS ==================
function updateSocialLinks() {
  const ig = document.getElementById('socialIg');
  const tt = document.getElementById('socialTt');
  const fb = document.getElementById('socialFb');
  if (ig) ig.href = storeSettings.social_ig || '#';
  if (tt) tt.href = storeSettings.social_tt || '#';
  if (fb) fb.href = storeSettings.social_fb || '#';
}

// ================== KITCHEN DISPLAY ==================
function showKitchen() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-kitchen').classList.add('active');
  updateKitchenClock();
  renderKitchen();
  // Auto-refresh every 30 seconds
  window._kitchenInterval = setInterval(renderKitchen, 30000);
}
function updateKitchenClock() {
  const el = document.getElementById('kitchenClock');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  setTimeout(updateKitchenClock, 1000);
}
async function renderKitchen() {
  const grid = document.getElementById('kitchenGrid');
  if (!grid) return;
  try {
    const res = await apiFetch('/api/orders?status=confirmed&limit=50');
    const active = (res.orders || []).filter(o => ['confirmed', 'cooking'].includes(o.status));
    // Also get cooking orders
    const cooking = await apiFetch('/api/orders?status=cooking&limit=50');
    const all = [...active, ...(cooking.orders || [])];
    // Deduplicate
    const seen = new Set();
    const orders = all.filter(o => { const dup = seen.has(o.id); seen.add(o.id); return !dup; });

    if (!orders.length) {
      grid.innerHTML = `<div class="kitchen-empty"><div class="empty-icon">🍳</div><h3 style="color:#A79E8C;">Dapur sedang sepi</h3><p style="color:#8A8272;">Pesanan baru akan muncul di sini.</p></div>`;
    } else {
      grid.innerHTML = orders.map(o => `
        <div class="kitchen-card">
          <div class="kit-order-id">#${o.id} · ${new Date(o.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</div>
          <div class="kit-customer">${o.name}</div>
          <div class="kit-address">📍 ${o.address}</div>
          <div class="kit-items">${o.items.map(it => `<div class="kit-item"><span>${it.name} ×${it.qty}</span><span>${fmtRp(it.price*it.qty)}</span></div>`).join('')}</div>
          <div class="kit-total">💰 ${fmtRp(o.total)}</div>
          <div class="kit-actions">
            ${o.status === 'confirmed' ? `<button class="kitchen-btn start" onclick="kitchenUpdate('${o.id}','cooking')">🔥 Mulai Masak</button>` : ''}
            ${o.status === 'cooking' ? `<button class="kitchen-btn done" onclick="kitchenUpdate('${o.id}','delivered')">📦 Siap Kirim</button>` : ''}
          </div>
        </div>`).join('');
    }
    document.getElementById('kitchenRefresh').textContent = '✅ Diperbarui: ' + new Date().toLocaleTimeString('id-ID');
  } catch (e) {
    grid.innerHTML = `<div class="kitchen-empty"><p style="color:var(--clay);">${e.message}</p></div>`;
  }
}
async function kitchenUpdate(id, status) {
  try {
    await apiFetch(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    renderKitchen();
  } catch (e) { showToast(e.message, 'error'); }
}

// ================== CUSTOMER ACCOUNT ==================
function isCustomerLoggedIn() { return !!localStorage.getItem('nokayune_customer_token'); }
function getCustomerInfo() { try { return JSON.parse(localStorage.getItem('nokayune_customer_info') || '{}'); } catch { return {}; } }

function updateCustomerUI() {
  const loggedIn = isCustomerLoggedIn();
  const cust = getCustomerInfo();
  const btn = document.getElementById('custBtn');
  const navOrders = document.getElementById('navMyOrders');
  if (btn) {
    const icon = btn.querySelector('.cust-nav-icon');
    const label = btn.querySelector('.cust-nav-label');
    if (icon) icon.textContent = loggedIn ? '👋' : '👤';
    if (label) label.textContent = loggedIn ? (cust.name?.split(' ')[0] || 'Profil') : 'Akun';
    btn.classList.toggle('logged-in', loggedIn);
    btn.title = loggedIn ? `Halo, ${cust.name || ''}` : 'Akun Saya';
  }
  if (navOrders) navOrders.style.display = loggedIn ? '' : 'none';
}

async function customerLogin() {
  const name = document.getElementById('cust-name').value.trim();
  const phone = document.getElementById('cust-phone').value.trim();
  const pin = document.getElementById('cust-pin').value;
  const errEl = document.getElementById('custError');
  errEl.textContent = '';

  if (!name || !phone || !pin) { errEl.textContent = 'Lengkapi semua data.'; return; }
  if (pin.length !== 4) { errEl.textContent = 'PIN harus 4 digit.'; return; }

  try {
    // Try login first, if fail try register
    let res;
    try {
      res = await apiFetch('/api/customers/login', { method: 'POST', body: JSON.stringify({ phone, pin }) });
    } catch {
      res = await apiFetch('/api/customers/register', { method: 'POST', body: JSON.stringify({ name, phone, pin }) });
    }
    localStorage.setItem('nokayune_customer_token', res.token);
    localStorage.setItem('nokayune_customer_info', JSON.stringify(res.customer));
    updateCustomerUI();
    showToast(`Halo, ${res.customer.name}! 👋`);
    showPage('myorders');
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function customerLogout() {
  localStorage.removeItem('nokayune_customer_token');
  localStorage.removeItem('nokayune_customer_info');
  updateCustomerUI();
  showPage('home');
  showToast('Berhasil keluar dari akun.');
}

async function loadMyOrders() {
  const token = localStorage.getItem('nokayune_customer_token');
  if (!token) { showPage('customer-login'); return; }
  const el = document.getElementById('myOrdersList');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:32px;"><div class="spinner"></div><p style="color:var(--gray);margin-top:12px;">Memuat pesanan...</p></div>';
  try {
    const orders = await apiFetch('/api/customers/orders', { headers: { Authorization: 'Bearer ' + token } });
    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><h3>Belum ada pesanan</h3><p>Pesanan pertama kamu akan muncul di sini setelah checkout.</p><button class="btn-primary" onclick="showPage('menu')">Lihat Menu</button></div>`;
      return;
    }
    el.innerHTML = orders.map(o => {
      const itemsText = o.items.map(it => `${it.name} ×${it.qty}`).join(', ');
      return `<div class="my-order-card">
        <div class="my-order-header">
          <span class="order-status status-${o.status}">${statusLabel(o.status)}</span>
          <span class="my-order-total">${fmtRp(o.total)}</span>
        </div>
        <div class="my-order-items">🍽️ ${itemsText}${o.region_name ? ` · 📍 ${o.region_name}` : ''}</div>
        <div class="my-order-date">#${o.id} · ${new Date(o.created_at).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})}</div>
        ${o.status === 'done' ? `<div class="review-form">
          <h4>⭐ Beri Rating untuk pesanan ini</h4>
          <div class="star-rating" id="stars-${o.id}">${renderStars(0, false)}</div>
          <input type="hidden" id="rev-rating-${o.id}" value="0"/>
          <textarea id="rev-comment-${o.id}" placeholder="Tulis komentar... (opsional)"></textarea>
          <button class="btn-primary" onclick="submitReview('${o.id}','${o.phone}')">Kirim Review</button>
        </div>` : ''}
      </div>`;
    }).join('');
    // Init star inputs for done orders
    orders.forEach(o => { if (o.status === 'done') initStarInput(`stars-${o.id}`, `rev-rating-${o.id}`); });
    el.innerHTML += `<div style="text-align:center;margin-top:24px;"><button class="btn-ghost" onclick="customerLogout()" style="width:auto;padding:12px 28px;">🚪 Keluar</button></div>`;
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Sesi habis</h3><p>Silakan login ulang.</p><button class="btn-primary" onclick="showPage('customer-login')">Login</button></div>`;
    localStorage.removeItem('nokayune_customer_token');
    updateCustomerUI();
  }
}

// ================== HERO BANNER ==================
function initHeroBanner() {
  const banner = document.getElementById('heroBanner');
  if (!banner) return;
  const img = storeSettings.banner_image;
  const link = storeSettings.banner_link;
  if (img) {
    document.getElementById('heroBannerImg').src = img;
    document.getElementById('heroBannerLink').href = link || '#';
    banner.style.display = '';
  }
}

// ================== CUTOFF TIME DISPLAY ==================
function updateCutoffNotice() {
  const cutoff = storeSettings.cutoff_time || '20:00';
  const el = document.getElementById('cutoffTimeText');
  if (el) el.textContent = cutoff;
  const notice = document.getElementById('cutoffNotice');
  if (notice) {
    const now = new Date();
    const [h, m] = cutoff.split(':').map(Number);
    const cutoffDt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
    notice.style.display = now >= cutoffDt ? '' : 'none';
  }
}

// ================== STAR RATING COMPONENT ==================
function renderStars(rating, readonly) {
  return Array.from({ length: 5 }, (_, i) => `<span class="star ${i < rating ? 'filled' : ''}" data-value="${i + 1}">★</span>`).join('');
}
function initStarInput(containerId, hiddenInputId) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(hiddenInputId);
  if (!container || !input) return;
  container.innerHTML = renderStars(0, false);
  container.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', () => {
      const val = Number(star.dataset.value);
      input.value = val;
      container.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('filled', i < val));
    });
    star.addEventListener('mouseenter', () => {
      const val = Number(star.dataset.value);
      container.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('filled', i < val));
    });
  });
  container.addEventListener('mouseleave', () => {
    const val = Number(input.value) || 0;
    container.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('filled', i < val));
  });
}

// ================== REAL REVIEWS ==================
async function loadRealReviews() {
  try {
    const data = await apiFetch('/api/reviews/public');
    const grid = document.getElementById('testiGrid');
    if (!grid || !data.reviews.length) return;
    grid.innerHTML = data.reviews.map((r, i) => `
      <div class="testi-card ${i === 0 ? 'featured-testi' : ''}">
        <div class="testi-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
        <p>"${r.comment || 'Makanannya enak!'}"</p>
        <div class="testi-author"><span class="testi-avatar">${(r.name || 'P')[0].toUpperCase()}</span><div><strong>${r.name || 'Pelanggan'}</strong><small>${new Date(r.created_at).toLocaleDateString('id-ID', {month:'long',year:'numeric'})}</small></div></div>
      </div>`).join('');
    // Update rating in hero
    if (data.avgRating > 0) {
      const ratingEl = document.querySelector('.hero-stats .stat:nth-child(3) .stat-icon');
      if (ratingEl) ratingEl.textContent = '⭐ ' + data.avgRating;
    }
  } catch { /* keep hardcoded */ }
}
async function submitReview(orderId, phone) {
  const rating = Number(document.getElementById(`rev-rating-${orderId}`).value);
  const comment = document.getElementById(`rev-comment-${orderId}`).value.trim();
  if (!rating) { showToast('Pilih rating bintang dulu.', 'error'); return; }
  try {
    await apiFetch('/api/reviews', { method: 'POST', body: JSON.stringify({ order_id: orderId, phone, rating, comment }) });
    showToast('Review terkirim! Terima kasih ❤️');
    if (document.getElementById('page-myorders')?.classList.contains('active')) loadMyOrders();
    loadRealReviews();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ================== REGIONS (wilayah) ==================
// The UMKM can operate in several areas (e.g. Purwokerto, Jember) with their own
// menu/stock/WhatsApp number. The customer picks one; it's remembered in localStorage.
async function loadRegions() {
  try {
    regions = await apiFetch('/api/regions');
  } catch (e) {
    regions = [];
  }
  const saved = Number(localStorage.getItem('nokayune_region')) || null;
  const stillValid = saved && regions.some(r => r.id === saved);
  currentRegionId = stillValid ? saved : (regions[0]?.id || null);
  if (currentRegionId) localStorage.setItem('nokayune_region', currentRegionId);

  const sel = document.getElementById('regionSelect');
  if (sel) {
    sel.innerHTML = regions.map(r => `<option value="${r.id}">${r.name}</option>`).join('') || '<option>Belum ada wilayah</option>';
    if (currentRegionId) sel.value = currentRegionId;
  }
  applyRegionUI();
}

function applyRegionUI() {
  const region = regions.find(r => r.id === currentRegionId);
  const waNumber = (region?.wa_number || storeSettings.owner_wa || '6281234567890').replace(/\D/g, '');
  const address = region?.address || storeSettings.address || 'Purwokerto, Jawa Tengah';
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const setHref = (id, href, text) => { const el = document.getElementById(id); if (el) { el.href = href; el.textContent = text; } };
  setText('ctaAreaText', region?.name || 'kami');
  setText('footerAddress', address);
  setText('contactAddress', address);
  setText('contactAreaText', region?.name || 'kami');
  setHref('footerWaLink', `https://wa.me/${waNumber}`, formatPhoneDisplay(waNumber));
  setHref('contactWaLink', `https://wa.me/${waNumber}`, formatPhoneDisplay(waNumber));
  const note = document.getElementById('menuRegionNote');
  if (note) note.innerHTML = region ? `📍 Menampilkan menu untuk wilayah <strong>${region.name}</strong>. Mau area lain? Ganti lewat menu 📍 di navbar.` : '';
}

function formatPhoneDisplay(digits) {
  if (!digits) return '-';
  return '0' + digits.replace(/^62/, '').replace(/(\d{3})(?=\d)/g, '$1-').replace(/-$/, '');
}

function changeRegion(id) {
  const newId = Number(id);
  if (newId === currentRegionId) return;
  currentRegionId = newId;
  localStorage.setItem('nokayune_region', newId);
  applyRegionUI();
  const hadCartItems = cart.length > 0;
  cart = [];
  updateCartCount();
  if (hadCartItems) showToast('Wilayah diganti — keranjang dikosongkan karena menu tiap wilayah bisa berbeda.', 'info');
  else showToast(`Wilayah diganti ke ${regions.find(r => r.id === newId)?.name || ''}`);
  loadMenu();
  if (document.getElementById('page-cart')?.classList.contains('active')) renderCart();
}

// ================== PAGE NAVIGATION ==================
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('page-' + name);
  if (pg) { pg.classList.add('active'); window.scrollTo(0, 0); }
  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === name));
  document.getElementById('navLinks').classList.remove('open');
  if (name === 'menu') renderFullMenu('all');
  if (name === 'cart') renderCart();
  if (name === 'checkout') renderCheckout();
  if (name === 'admin') { if (!isAdminLoggedIn()) { showPage('admin-login'); return; } renderAdminDashboard(); }
  if (name === 'kitchen') { showKitchen(); return; }
  if (name === 'myorders') { if (!isCustomerLoggedIn()) { showPage('customer-login'); return; } loadMyOrders(); return; }
  updateCartCount();
  updateFloatWA();
}
function toggleMenu() {
  const drawer = document.getElementById('mobileNavDrawer');
  const overlay = document.getElementById('mobileNavOverlay');
  const hamburger = document.getElementById('hamburger');
  const isOpen = drawer.classList.contains('show');
  if (isOpen) { closeMobileMenu(); }
  else {
    drawer.classList.add('show');
    overlay.classList.add('show');
    hamburger.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}
function closeMobileMenu() {
  const drawer = document.getElementById('mobileNavDrawer');
  const overlay = document.getElementById('mobileNavOverlay');
  const hamburger = document.getElementById('hamburger');
  drawer?.classList.remove('show');
  overlay?.classList.remove('show');
  hamburger?.classList.remove('open');
  document.body.style.overflow = '';
}
function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  closeMobileMenu();
}

// ================== MENU (public) ==================
function skeletonCards(n) {
  return Array.from({ length: n }).map(() => `
    <div class="skeleton-card">
      <div class="sk-img skeleton-shimmer"></div>
      <div class="sk-body">
        <div class="sk-line med skeleton-shimmer"></div>
        <div class="sk-line short skeleton-shimmer"></div>
        <div class="sk-line long skeleton-shimmer" style="height:36px;"></div>
      </div>
    </div>`).join('');
}

async function loadMenu() {
  try {
    const regionQ = currentRegionId ? `&region=${currentRegionId}` : '';
    menuData = await apiFetch(`/api/menu?status=available${regionQ}`);
  } catch (e) {
    showToast('Gagal memuat menu. Periksa koneksi ke server.', 'error');
    menuData = [];
  }
  renderFeatured();
  if (document.getElementById('page-menu')?.classList.contains('active')) renderFullMenu(getActiveMenuFilter());
}

function getActiveMenuFilter() {
  const active = document.querySelector('.filter-btn.active');
  return active ? (active.dataset.cat || 'all') : 'all';
}

function renderFeatured() {
  const grid = document.getElementById('featuredGrid');
  if (!grid) return;
  const featured = menuData.slice(0, 6);
  grid.innerHTML = featured.length ? featured.map(m => menuCard(m)).join('') : skeletonCards(3);
  if (featured.length) requestAnimationFrame(() => { staggerCards('#featuredGrid'); initTilt(); });
}

function renderFullMenu(filter) {
  const grid = document.getElementById('fullMenuGrid');
  if (!grid) return;
  const items = filter === 'all' ? menuData : menuData.filter(m => m.cat === filter);
  grid.innerHTML = items.length ? items.map(m => menuCard(m)).join('') : `<div class="empty-state" style="grid-column:1/-1;">
    <div class="empty-icon">🍽️</div>
    <h3>Belum ada menu di kategori ini</h3>
    <p>Coba pilih kategori lain, atau lihat semua menu yang tersedia.</p>
  </div>`;
  if (items.length) {
    requestAnimationFrame(() => { staggerCards('#fullMenuGrid'); initTilt(); });
  }
}

function menuCard(m) {
  const catLabel = { 'nasi-box': 'Nasi Box', 'lauk': 'Lauk Pauk', 'snack': 'Snack & Kue', 'minuman': 'Minuman' };
  const imgInner = m.image ? `<img src="${m.image}" alt="${m.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;"/>` : `${m.emoji || '🍽️'}`;
  const soldOut = m.status === 'soldout';
  const trackingStock = m.stock !== null && m.stock !== undefined;
  const lowStock = trackingStock && !soldOut && m.stock <= 5;
  let stockBadge = '';
  if (soldOut) stockBadge = '<span class="menu-card-badge soldout">Habis</span>';
  else if (lowStock) stockBadge = `<span class="menu-card-badge low-stock">Stok tinggal ${m.stock}</span>`;
  else if (m.sold >= 80) stockBadge = '<span class="menu-card-badge best-seller">🔥 Best Seller</span>';
  else if (m.sold >= 40) stockBadge = '<span class="menu-card-badge best-seller">⭐ Populer</span>';
  const stockNote = trackingStock && !soldOut ? `<p class="stock-note">📦 Stok tersisa: <strong>${m.stock}</strong></p>` : '';
  return `<div class="menu-card">
    <div class="menu-card-img">${imgInner}${stockBadge}</div>
    <div class="menu-card-body">
      <div class="menu-card-cat">${catLabel[m.cat] || m.cat}</div>
      <h3>${m.name}</h3>
      <p>${m.desc || ''}</p>
      ${stockNote}
      <div class="menu-card-footer">
        <span class="menu-price">${fmtRp(m.price)}</span>
        <button class="add-btn" onclick="addToCart(${m.id})" ${soldOut ? 'disabled' : ''} aria-label="Tambah ${m.name} ke keranjang">+</button>
      </div>
    </div>
  </div>`;
}

function filterMenu(filter, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) { btn.classList.add('active'); btn.dataset.cat = filter; }
  renderFullMenu(filter);
}

// ================== CART ==================
function addToCart(id) {
  const item = menuData.find(m => m.id === id);
  if (!item || item.status === 'soldout') return;
  const existing = cart.find(c => c.id === id);
  const nextQty = (existing?.qty || 0) + 1;
  if (item.stock !== null && item.stock !== undefined && nextQty > item.stock) {
    showToast(`Stok "${item.name}" tinggal ${item.stock}, sudah maksimal di keranjang.`, 'error');
    return;
  }
  if (existing) existing.qty++;
  else cart.push({ ...item, qty: 1 });
  updateCartCount();
  // Cart bump animation
  const cartBtn = document.querySelector('.cart-btn');
  if (cartBtn) { cartBtn.classList.remove('cart-bump'); void cartBtn.offsetWidth; cartBtn.classList.add('cart-bump'); }
  // Flash the add button
  const addBtns = document.querySelectorAll('.add-btn');
  addBtns.forEach(b => { if (b.onclick && b.onclick.toString().includes(id)) { b.classList.add('added'); setTimeout(() => b.classList.remove('added'), 600); } });
  showToast(`${item.name} ditambahkan ke keranjang`);
}

function updateCartCount() {
  const total = cart.reduce((s, c) => s + c.qty, 0);
  const countEl = document.getElementById('cartCount');
  if (countEl) countEl.textContent = total;
  const bar = document.getElementById('mobileCartBar');
  const totalEl = document.getElementById('mcTotal');
  if (bar && totalEl) {
    const amount = cart.reduce((s, c) => s + c.price * c.qty, 0);
    totalEl.textContent = fmtRp(amount);
    const currentPage = document.querySelector('.page.active')?.id;
    const hideOn = ['page-cart', 'page-checkout', 'page-payment', 'page-success', 'page-admin', 'page-admin-login'];
    bar.classList.toggle('show', total > 0 && !hideOn.includes(currentPage));
  }
}

function renderCart() {
  const el = document.getElementById('cartItems');
  const sumEl = document.getElementById('summaryRows');
  const totalEl = document.getElementById('cartTotal');
  if (!el) return;
  if (!cart.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🛒</div>
      <h3>Keranjang masih kosong</h3>
      <p>Belum ada menu yang dipilih. Yuk jelajahi menu andalan NokAyune dulu.</p>
      <button class="btn-primary" onclick="showPage('menu')">Lihat Menu</button>
    </div>`;
    sumEl.innerHTML = '';
    totalEl.textContent = 'Rp 0';
    return;
  }
  el.innerHTML = cart.map(c => `
    <div class="cart-item">
      <div class="cart-item-img">${c.image ? `<img src="${c.image}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"/>` : c.emoji}</div>
      <div class="cart-item-info">
        <h4>${c.name}</h4>
        <p>${fmtRp(c.price)} / porsi</p>
      </div>
      <div class="cart-item-actions">
        <button class="qty-btn" onclick="changeQty(${c.id}, -1)" aria-label="Kurangi">−</button>
        <span class="qty-num">${c.qty}</span>
        <button class="qty-btn" onclick="changeQty(${c.id}, 1)" aria-label="Tambah">+</button>
      </div>
      <span class="cart-item-price">${fmtRp(c.price * c.qty)}</span>
      <button class="remove-btn" onclick="removeItem(${c.id})" aria-label="Hapus ${c.name}">🗑</button>
    </div>`).join('');
  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  sumEl.innerHTML = cart.map(c => `<div class="summary-row"><span>${c.name} ×${c.qty}</span><span>${fmtRp(c.price * c.qty)}</span></div>`).join('');
  totalEl.textContent = fmtRp(subtotal);
}

function changeQty(id, delta) {
  const idx = cart.findIndex(c => c.id === id);
  if (idx < 0) return;
  const item = cart[idx];
  if (delta > 0 && item.stock !== null && item.stock !== undefined && item.qty + delta > item.stock) {
    showToast(`Stok "${item.name}" tinggal ${item.stock}.`, 'error');
    return;
  }
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) cart.splice(idx, 1);
  updateCartCount();
  renderCart();
}
function removeItem(id) {
  cart = cart.filter(c => c.id !== id);
  updateCartCount();
  renderCart();
}

// ================== CHECKOUT ==================
function renderCheckout() {
  const el = document.getElementById('checkoutItems');
  const totalEl = document.getElementById('checkoutTotal');
  if (!el) return;
  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  el.innerHTML = cart.map(c => `<div class="checkout-item"><span>${c.emoji || '🍽️'} ${c.name} ×${c.qty}</span><span>${fmtRp(c.price * c.qty)}</span></div>`).join('');
  if (totalEl) totalEl.textContent = fmtRp(subtotal);
  const dtInput = document.getElementById('co-time');
  if (dtInput) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 60);
    dtInput.min = now.toISOString().slice(0, 16);
  }
  loadRecommendations();
  loadSavedAddresses();
  updateCutoffNotice();
}

function validateField(inputId, groupId, isValid) {
  const input = document.getElementById(inputId);
  const group = document.getElementById(groupId);
  if (!input || !group) return;
  input.classList.toggle('field-error', !isValid);
  group.classList.toggle('has-error', !isValid);
}

async function goToPayment() {
  const name = document.getElementById('co-name').value.trim();
  const phone = document.getElementById('co-phone').value.trim();
  const address = document.getElementById('co-address').value.trim();
  const time = document.getElementById('co-time').value;
  const notes = document.getElementById('co-notes').value.trim();

  validateField('co-name', 'fg-co-name', !!name);
  validateField('co-phone', 'fg-co-phone', !!phone);
  validateField('co-address', 'fg-co-address', !!address);
  validateField('co-time', 'fg-co-time', !!time);

  if (!name || !phone || !address || !time) {
    showToast('Mohon lengkapi data bertanda *', 'error');
    document.querySelector('.form-group.has-error input, .form-group.has-error textarea')?.focus();
    return;
  }
  if (!cart.length) { showToast('Keranjang kosong.', 'error'); showPage('menu'); return; }
  if (!currentRegionId) { showToast('Pilih wilayah pengiriman dulu di navbar (ikon 📍).', 'error'); return; }

  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
  try {
    const order = await apiFetch('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ name, phone, address, time, notes, region_id: currentRegionId, items: cart.map(c => ({ id: c.id, qty: c.qty })) }),
    });
    currentOrder = order;
    document.getElementById('payAmount').textContent = fmtRp(order.total);
    showPage('payment');
    initiatePayment(order.id);
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Pilih Metode Bayar →'; }
  }
}

// ================== PAYMENT ==================
async function initiatePayment(orderId) {
  const codeBox = document.getElementById('qrisCodeBox');
  const merchantNameEl = document.getElementById('qrisMerchantName');
  const subsEl = document.getElementById('qrisSub');
  const payNote = document.getElementById('payNote');
  const logosEl = document.getElementById('qrisLogos');
  const guideEl = document.getElementById('payGuide');
  const lockedBadge = document.querySelector('.locked-badge');

  try {
    const res = await apiFetch('/api/payment/qris/' + orderId);
    if (res.configured) {
      // Branded QR wrapper
      if (codeBox) codeBox.innerHTML = `<div class="qr-branded"><img src="${res.qrDataUrl}" alt="QRIS pembayaran" style="width:220px;height:220px;display:block;"/></div>`;
      if (merchantNameEl) merchantNameEl.textContent = res.merchantName || 'NokAyune';
      if (subsEl) subsEl.textContent = `Scan pakai GoPay, OVO, Dana, ShopeePay, atau mobile banking apa saja`;
      if (lockedBadge) lockedBadge.style.display = '';
      if (guideEl) guideEl.style.display = '';
      if (logosEl) logosEl.style.display = '';
      if (payNote) payNote.textContent = 'Setelah transfer, upload bukti bayar lalu klik konfirmasi. Tim kami akan cek & verifikasi pembayaran Anda dalam 15-30 menit.';
    } else {
      // QRIS not set — nicer fallback
      if (codeBox) codeBox.innerHTML = '';
      if (lockedBadge) lockedBadge.style.display = 'none';
      if (guideEl) guideEl.style.display = 'none';
      if (logosEl) logosEl.style.display = 'none';
      if (subsEl) subsEl.textContent = '';
      const wrap = document.getElementById('qrisWrap');
      if (wrap) wrap.innerHTML = `<div class="qris-fallback">
        <div class="fallback-icon">💬</div>
        <h3>Pembayaran via WhatsApp</h3>
        <p>QRIS belum diatur, tapi jangan khawatir! Klik tombol di bawah — Anda akan diarahkan ke WhatsApp untuk atur pembayaran langsung dengan tim kami.</p>
        <div class="bank-list"><span class="bank-chip">🏦 Transfer Bank</span><span class="bank-chip">📱 GoPay / OVO / Dana</span><span class="bank-chip">💬 Konfirmasi WA</span></div>
      </div>`;
      if (payNote) payNote.textContent = 'Klik tombol konfirmasi untuk lanjut ke WhatsApp — tim kami akan bantu atur pembayaran.';
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function confirmPayment() {
  try {
    const order = await apiFetch('/api/payment/confirm-manual/' + currentOrder.id, { method: 'POST' });
    const full = { ...currentOrder, ...order };
    renderSuccess(full);
    showPage('success');
    cart = [];
    updateCartCount();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderSuccess(order) {
  const el = document.getElementById('successOrder');
  if (!el) return;
  const delivTime = new Date(order.deliver_time || order.time).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
  el.innerHTML = `
    <p>🆔 <strong>No. Order:</strong> ${order.id}</p>
    <p>👤 <strong>Pemesan:</strong> ${order.name}</p>
    <p>📍 <strong>Alamat:</strong> ${order.address}</p>
    <p>⏰ <strong>Pengiriman:</strong> ${delivTime}</p>
    <p>💰 <strong>Total Bayar:</strong> ${fmtRp(order.total)}</p>`;
  window._successOrder = order;
  startCountdown(15);
  updateFloatWA();
}

function openWA() {
  const order = window._successOrder || currentOrder;
  if (!order) return;
  const items = (order.items || []).map(it => `  • ${it.name} ×${it.qty} = ${fmtRp(it.price * it.qty)}`).join('\n');
  const delivTime = new Date(order.deliver_time || order.time).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
  const msg = encodeURIComponent(
    `🍃 *Pesanan NokAyune*\n` +
    `No. Order: *${order.id}*\n\n` +
    `👤 Nama: ${order.name}\n` +
    `📱 WA: ${order.phone}\n` +
    `📍 Alamat: ${order.address}\n` +
    `⏰ Waktu: ${delivTime}\n` +
    (order.notes ? `📝 Catatan: ${order.notes}\n` : '') +
    `\n📋 *Rincian Pesanan:*\n${items}\n\n` +
    `💰 *Total: ${fmtRp(order.total)}*\n\n` +
    `✅ Pembayaran sudah dilakukan.\n` +
    `📸 _[Lampirkan screenshot bukti bayar di sini]_`
  );
  const region = regions.find(r => r.id === (order.region_id || currentRegionId));
  const waNumber = (region?.wa_number || storeSettings.owner_wa || '6281234567890').replace(/\D/g, '');
  window.open(`https://wa.me/${waNumber}?text=${msg}`, '_blank');
}

function resetOrder() {
  currentOrder = {};
  showPage('home');
}

function sendContactWA() {
  const region = regions.find(r => r.id === currentRegionId);
  const waNumber = (region?.wa_number || storeSettings.owner_wa || '6281234567890').replace(/\D/g, '');
  window.open(`https://wa.me/${waNumber}`, '_blank');
}

async function submitContactForm() {
  const nameInput = document.querySelector('#page-contact input[placeholder="Nama Anda"]');
  const phoneInput = document.querySelector('#page-contact input[placeholder="08xxxxxxxxxx"]');
  const msgInput = document.querySelector('#page-contact textarea');
  const name = nameInput?.value.trim();
  const phone = phoneInput?.value.trim();
  const message = msgInput?.value.trim();

  if (!name || !phone || !message) { showToast('Lengkapi nama, nomor WhatsApp, dan pesan Anda.', 'error'); return; }
  const btn = document.querySelector('#page-contact .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }
  try {
    const res = await apiFetch('/api/contact', { method: 'POST', body: JSON.stringify({ name, phone, message }) });
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (msgInput) msgInput.value = '';
    showToast('Pesan terkirim! Membuka WhatsApp...');
    if (res.waUrl) window.open(res.waUrl, '_blank');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Kirim via WhatsApp'; }
  }
}

// ================== TRACK ORDER ==================
async function trackOrder() {
  const id = document.getElementById('tr-id').value.trim();
  const phone = document.getElementById('tr-phone').value.trim();
  const resultEl = document.getElementById('trackResult');
  if (!id || !phone) { showToast('Isi nomor pesanan dan WhatsApp.', 'error'); return; }
  resultEl.innerHTML = '<div class="track-loading"><div class="spinner"></div><p>Mencari pesanan...</p></div>';
  try {
    const order = await apiFetch(`/api/orders/track?id=${encodeURIComponent(id)}&phone=${encodeURIComponent(phone)}`);
    const statusLabels = { pending: 'Menunggu Konfirmasi', confirmed: 'Dikonfirmasi', cooking: 'Sedang Dimasak', delivered: 'Dalam Pengiriman', done: 'Selesai' };
    const items = order.items.map(it => `<div class="checkout-item"><span>${it.name} ×${it.qty}</span><span>${fmtRp(it.price * it.qty)}</span></div>`).join('');
    resultEl.innerHTML = `<div class="success-order">
      <p>🆔 <strong>No. Order:</strong> ${order.id}</p>
      <p>📦 <strong>Status:</strong> <span class="order-status status-${order.status}">${statusLabels[order.status] || order.status}</span></p>
      <p>💳 <strong>Pembayaran:</strong> ${order.payment_status === 'paid' ? 'Sudah dibayar' : 'Belum dibayar'}</p>
      ${order.region_name ? `<p>📍 <strong>Wilayah:</strong> ${order.region_name}</p>` : ''}
      <p>⏰ <strong>Pengiriman:</strong> ${new Date(order.deliver_time).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })}</p>
      <div style="margin-top:12px;">${items}</div>
      <div class="summary-total" style="margin-top:12px;"><span>Total</span><span>${fmtRp(order.total)}</span></div>
    </div>`;
  } catch (e) {
    resultEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><h3>Tidak ditemukan</h3><p>${e.message}</p></div>`;
  }
}

// ================== ADMIN AUTH ==================
function isAdminLoggedIn() { return !!localStorage.getItem('nokayune_admin_token'); }

async function adminLogin() {
  const username = document.getElementById('adminUser').value.trim();
  const password = document.getElementById('adminPass').value;
  const errEl = document.getElementById('adminError');
  errEl.textContent = '';
  try {
    const res = await apiFetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    localStorage.setItem('nokayune_admin_token', res.token);
    localStorage.setItem('nokayune_admin_info', JSON.stringify(res.admin));
    connectSocket();
    showPage('admin');
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function adminLogout(silent) {
  localStorage.removeItem('nokayune_admin_token');
  localStorage.removeItem('nokayune_admin_info');
  if (socket) { socket.disconnect(); socket = null; }
  if (!silent) showPage('home');
  else showPage('admin-login');
}

function currentAdminRole() {
  try { return JSON.parse(localStorage.getItem('nokayune_admin_info') || '{}').role; } catch { return null; }
}

// ================== ADMIN DASHBOARD ==================
async function renderAdminDashboard() {
  try {
    await apiFetch('/api/admin/me');
  } catch {
    return; // apiFetch already redirected to login on 401
  }
  connectSocket();
  const role = currentAdminRole();
  document.querySelectorAll('.admin-nav-item').forEach(item => {
    const tab = item.getAttribute('onclick')?.match(/adminTab\('(\w+)'/)?.[1];
    const ownerOnly = tab === 'menu' || tab === 'stats' || tab === 'settings';
    item.style.display = (ownerOnly && role !== 'owner') ? 'none' : '';
  });
  const staffPanel = document.getElementById('staffPanel');
  if (staffPanel) staffPanel.style.display = role === 'owner' ? '' : 'none';
  const regionsPanel = document.getElementById('regionsPanel');
  if (regionsPanel) regionsPanel.style.display = role === 'owner' ? '' : 'none';
  const qrisPanel = document.getElementById('qrisPanel');
  if (qrisPanel) qrisPanel.style.display = role === 'owner' ? '' : 'none';
  await loadAdminRegions();
  adminTab('orders', document.querySelector('.admin-nav-item'));
}

// ---- Regions (wilayah) admin management ----
async function loadAdminRegions() {
  try {
    adminRegions = currentAdminRole() === 'owner' ? await apiFetch('/api/regions/all') : await apiFetch('/api/regions');
  } catch (e) {
    adminRegions = [];
  }
  const fillSelect = (el, includeAll, includeUnset) => {
    if (!el) return;
    const prev = el.value;
    let opts = '';
    if (includeAll) opts += '<option value="all">Semua Wilayah</option>';
    if (includeUnset) opts += '<option value="">Semua Wilayah (menu ini)</option>';
    opts += adminRegions.map(r => `<option value="${r.id}">${r.name}${r.active ? '' : ' (nonaktif)'}</option>`).join('');
    el.innerHTML = opts;
    if ([...el.options].some(o => o.value === prev)) el.value = prev;
  };
  fillSelect(document.getElementById('ordersRegionFilter'), true, false);
  fillSelect(document.getElementById('statsRegionFilter'), true, false);
  fillSelect(document.getElementById('mf-region'), false, true);
  renderRegionsList();
}

function renderRegionsList() {
  const el = document.getElementById('regionsList');
  if (!el) return;
  if (!adminRegions.length) { el.innerHTML = '<p style="color:var(--gray);font-size:0.85rem;">Belum ada wilayah.</p>'; return; }
  el.innerHTML = adminRegions.map(r => `
    <div class="top-menu-item">
      <span>📍 ${r.name}${r.active ? '' : ' <em style="color:var(--gray);">(nonaktif)</em>'}<br/><small style="font-weight:400;color:var(--gray);">${r.wa_number ? '📱 ' + r.wa_number : ''} ${r.address ? '· ' + r.address : ''}</small></span>
      <span style="display:flex;gap:6px;">
        <button class="edit-btn" style="flex:none;padding:6px 12px;" onclick="toggleRegionActive(${r.id}, ${r.active ? 0 : 1})">${r.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
        <button class="del-btn" style="flex:none;padding:6px 12px;" onclick="deleteRegion(${r.id})">Hapus</button>
      </span>
    </div>`).join('');
}

async function addRegion() {
  const name = document.getElementById('region-name').value.trim();
  const wa_number = document.getElementById('region-wa').value.trim();
  const address = document.getElementById('region-address').value.trim();
  if (!name) { showToast('Nama wilayah wajib diisi.', 'error'); return; }
  try {
    await apiFetch('/api/regions', { method: 'POST', body: JSON.stringify({ name, wa_number, address }) });
    ['region-name', 'region-wa', 'region-address'].forEach(id => document.getElementById(id).value = '');
    await loadAdminRegions();
    showToast(`Wilayah "${name}" ditambahkan`);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function toggleRegionActive(id, active) {
  try {
    await apiFetch('/api/regions/' + id, { method: 'PUT', body: JSON.stringify({ active }) });
    await loadAdminRegions();
    showToast(active ? 'Wilayah diaktifkan' : 'Wilayah dinonaktifkan');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteRegion(id) {
  if (!await showConfirm('Hapus Wilayah', 'Wilayah hanya bisa dihapus kalau belum dipakai menu/pesanan. Yakin ingin menghapus?')) return;
  try {
    await apiFetch('/api/regions/' + id, { method: 'DELETE' });
    await loadAdminRegions();
    showToast('Wilayah dihapus');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function adminTab(tab, el) {
  document.querySelectorAll('.admin-nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  el?.classList.add('active');
  document.getElementById('admin-' + tab)?.classList.add('active');
  if (tab === 'orders') renderAdminOrders(ordersFilter, 1);
  if (tab === 'menu') renderAdminMenu();
  if (tab === 'stats') renderStats();
  if (tab === 'settings') loadSettingsForm();
}

// ---- Orders ----
async function renderAdminOrders(filter, page) {
  ordersFilter = filter || ordersFilter;
  ordersPage = page || ordersPage;
  const grid = document.getElementById('adminOrdersGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="text-align:center;padding:32px;"><div class="spinner"></div><p style="color:var(--gray);margin-top:12px;">Memuat pesanan...</p></div>';
  try {
    const res = await apiFetch(`/api/orders?status=${ordersFilter}&region=${ordersRegionFilter}&page=${ordersPage}&limit=10`);
    window._adminOrders = res.orders;
    if (!res.orders.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><h3>Belum ada pesanan</h3><p>Pesanan baru akan muncul di sini secara otomatis.</p></div>`;
    } else {
      grid.innerHTML = res.orders.map(orderCard).join('');
    }
    renderPagination(res.page, res.totalPages);
  } catch (e) {
    grid.innerHTML = `<p style="text-align:center;color:var(--clay);padding:24px;">${e.message}</p>`;
  }
}

function renderPagination(page, totalPages) {
  const el = document.getElementById('ordersPagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="filter-btn ${i === page ? 'active' : ''}" onclick="renderAdminOrders(ordersFilter, ${i})">${i}</button>`;
  }
  el.innerHTML = html;
}

function orderCard(o) {
  const itemsText = o.items.map(it => `${it.name} ×${it.qty}`).join(', ');
  const canCancel = !['cancelled', 'done', 'delivered'].includes(o.status);
  return `<div class="order-card">
    <div class="order-header">
      <span class="order-id">#${o.id} • ${new Date(o.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="order-status status-${o.status}">${statusLabel(o.status)}</span>
        <span class="${o.payment_status === 'paid' ? 'pay-paid' : 'pay-unpaid'}">${o.payment_status === 'paid' ? 'Lunas' : 'Belum bayar'}</span>
      </div>
    </div>
    <div class="order-customer">${o.name} — ${o.phone}</div>
    <div class="order-details">${o.address}${o.region_name ? ` · 📍 ${o.region_name}` : ''}<br/>🍽️ ${itemsText}</div>
    <div class="order-actions">
      <span class="order-total">${fmtRp(o.total)}</span>
      ${o.status === 'pending' ? `<button class="order-btn confirm" onclick="updateOrderStatus('${o.id}','confirmed')">Konfirmasi</button>` : ''}
      ${o.status === 'confirmed' ? `<button class="order-btn cook" onclick="updateOrderStatus('${o.id}','cooking')">Mulai Masak</button>` : ''}
      ${o.status === 'cooking' ? `<button class="order-btn deliver" onclick="updateOrderStatus('${o.id}','delivered')">Kirim</button>` : ''}
      ${o.status === 'delivered' ? `<button class="order-btn done" onclick="updateOrderStatus('${o.id}','done')">Selesai</button>` : ''}
      ${canCancel ? `<button class="order-btn cancel" onclick="cancelOrder('${o.id}')">✕ Batal</button>` : ''}
      <button class="order-btn wa" onclick="waToCustomer('${o.id}')">💬 WA</button>
    </div>
  </div>`;
}

async function cancelOrder(id) {
  if (!await showConfirm('Batalkan Pesanan', 'Stok akan dikembalikan ke menu. Pesanan yang sudah dibatalkan tidak bisa dikembalikan.')) return;
  try {
    await apiFetch(`/api/orders/${id}/cancel`, { method: 'PATCH' });
    renderAdminOrders(ordersFilter, ordersPage);
    showToast('Pesanan dibatalkan — stok dikembalikan.');
    loadMenu();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function statusLabel(s) {
  return { pending: 'Menunggu', confirmed: 'Dikonfirmasi', cooking: 'Dimasak', delivered: 'Dikirim', done: 'Selesai', cancelled: 'Dibatalkan' }[s] || s;
}

async function updateOrderStatus(id, status) {
  try {
    await apiFetch(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    renderAdminOrders(ordersFilter, ordersPage);
    showToast('Status pesanan diperbarui');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function filterOrders(val) { renderAdminOrders(val, 1); }
function filterOrdersByRegion(val) { ordersRegionFilter = val; renderAdminOrders(ordersFilter, 1); }

function waToCustomer(id) {
  const order = (window._adminOrders || []).find(o => o.id === id);
  if (!order) return;
  const msg = encodeURIComponent(`Halo ${order.name}, ini dari NokAyune mengenai pesanan #${order.id}.`);
  window.open(`https://wa.me/${order.phone.replace(/\D/g, '')}?text=${msg}`, '_blank');
}

// ---- Admin Menu ----
async function renderAdminMenu() {
  const grid = document.getElementById('adminMenuGrid');
  if (!grid) return;
  try {
    adminMenuData = await apiFetch('/api/menu');
    grid.innerHTML = adminMenuData.map(m => {
      const regionName = m.region_id ? (adminRegions.find(r => r.id === m.region_id)?.name || '?') : 'Semua Wilayah';
      const stockText = (m.stock === null || m.stock === undefined) ? 'Stok tak terbatas' : `Stok: ${m.stock}`;
      return `
      <div class="admin-menu-card">
        <div class="admin-menu-card-img">${m.image ? `<img src="${m.image}" alt="" style="width:100%;height:100%;object-fit:cover;"/>` : (m.emoji || '🍽️')}</div>
        <div class="admin-menu-card-body">
          <h4>${m.name} ${m.status === 'soldout' ? '<span style="color:var(--clay);font-size:0.75rem;">(Habis)</span>' : ''}</h4>
          <p>${fmtRp(m.price)}</p>
          <p style="color:var(--gray);font-weight:500;font-size:0.78rem;margin-top:-8px;margin-bottom:12px;">📦 ${stockText} · 📍 ${regionName}</p>
          <div class="admin-menu-actions">
            <button class="edit-btn" onclick="editMenu(${m.id})">✏️ Edit</button>
            <button class="del-btn" onclick="deleteMenu(${m.id})">🗑 Hapus</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = `<p style="color:var(--clay);">${e.message}</p>`;
  }
}

function showAddMenu() {
  editingMenuId = null;
  document.getElementById('menuFormTitle').textContent = 'Tambah Menu Baru';
  ['mf-name', 'mf-price', 'mf-emoji', 'mf-desc', 'mf-stock'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('mf-photo').value = '';
  document.getElementById('mf-cat').value = 'nasi-box';
  document.getElementById('mf-status').value = 'available';
  document.getElementById('mf-region').value = '';
  document.getElementById('adminMenuForm').style.display = 'block';
}

function editMenu(id) {
  const m = adminMenuData.find(x => x.id === id);
  if (!m) return;
  editingMenuId = id;
  document.getElementById('menuFormTitle').textContent = 'Edit Menu: ' + m.name;
  document.getElementById('mf-name').value = m.name;
  document.getElementById('mf-cat').value = m.cat;
  document.getElementById('mf-price').value = m.price;
  document.getElementById('mf-emoji').value = m.emoji || '';
  document.getElementById('mf-desc').value = m.desc || '';
  document.getElementById('mf-status').value = m.status;
  document.getElementById('mf-stock').value = (m.stock === null || m.stock === undefined) ? '' : m.stock;
  document.getElementById('mf-region').value = m.region_id || '';
  document.getElementById('mf-photo').value = '';
  document.getElementById('adminMenuForm').style.display = 'block';
  document.getElementById('adminMenuForm').scrollIntoView({ behavior: 'smooth' });
}

function cancelMenuForm() {
  document.getElementById('adminMenuForm').style.display = 'none';
  editingMenuId = null;
}

async function saveMenu() {
  const fd = new FormData();
  fd.append('name', document.getElementById('mf-name').value.trim());
  fd.append('cat', document.getElementById('mf-cat').value);
  fd.append('price', document.getElementById('mf-price').value);
  fd.append('emoji', document.getElementById('mf-emoji').value.trim() || '🍽️');
  fd.append('desc', document.getElementById('mf-desc').value.trim());
  fd.append('status', document.getElementById('mf-status').value);
  fd.append('stock', document.getElementById('mf-stock').value.trim());
  fd.append('region_id', document.getElementById('mf-region').value);
  const photoFile = document.getElementById('mf-photo').files[0];
  if (photoFile) fd.append('photo', photoFile);

  if (!fd.get('name') || !fd.get('price')) { showToast('Nama dan harga wajib diisi.', 'error'); return; }

  try {
    if (editingMenuId) {
      await apiFetch('/api/menu/' + editingMenuId, { method: 'PUT', body: fd });
      showToast('Menu diperbarui');
    } else {
      await apiFetch('/api/menu', { method: 'POST', body: fd });
      showToast('Menu ditambahkan');
    }
    cancelMenuForm();
    renderAdminMenu();
    loadMenu();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteMenu(id) {
  if (!await showConfirm('Hapus Menu', 'Menu yang dihapus tidak bisa dikembalikan. Lanjutkan?')) return;
  try {
    await apiFetch('/api/menu/' + id, { method: 'DELETE' });
    renderAdminMenu();
    loadMenu();
    showToast('Menu dihapus');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ---- Stats ----
let revenueChartInstance = null;
async function renderStats(regionVal) {
  const sel = document.getElementById('statsRegionFilter');
  const region = regionVal !== undefined ? regionVal : (sel?.value || 'all');
  if (sel && sel.value !== region) sel.value = region;
  try {
    const s = await apiFetch(`/api/stats?region=${region}`);
    document.getElementById('st-total').textContent = s.total;
    document.getElementById('st-revenue').textContent = fmtRp(s.revenue);
    document.getElementById('st-pending').textContent = s.pending;
    document.getElementById('st-items').textContent = s.activeItems;
    const lowStockEl = document.getElementById('st-lowstock');
    if (lowStockEl) lowStockEl.textContent = s.lowStock ?? 0;
    document.getElementById('topMenuList').innerHTML = s.topMenu.map(m => `<div class="top-menu-item"><span>${m.emoji || '🍽️'} ${m.name}</span><span>${m.sold} terjual</span></div>`).join('');

    const ctx = document.getElementById('revenueChart');
    if (ctx && window.Chart) {
      if (revenueChartInstance) revenueChartInstance.destroy();
      revenueChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: s.last7Days.map(d => new Date(d.date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' })),
          datasets: [{
            label: 'Pendapatan',
            data: s.last7Days.map(d => d.revenue),
            borderColor: '#2F5233',
            backgroundColor: 'rgba(47,82,51,0.12)',
            tension: 0.35,
            fill: true,
          }],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: v => 'Rp' + (v / 1000) + 'rb' } } },
        },
      });
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function exportOrdersCSV() {
  const region = document.getElementById('statsRegionFilter')?.value || 'all';
  const token = localStorage.getItem('nokayune_admin_token');
  const url = `/api/stats/export?region=${region}`;
  // Create a temporary link to trigger download
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  // Use fetch with auth header since <a> click won't send Bearer token
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then(res => res.blob())
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      a.href = blobUrl;
      a.download = `nokayune-orders-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(blobUrl);
      showToast('Data pesanan di-download');
    })
    .catch(() => showToast('Gagal export data.', 'error'));
}

// ---- Settings ----
async function loadSettingsForm() {
  try {
    storeSettings = await apiFetch('/api/admin/settings');
    document.getElementById('set-store_name').value = storeSettings.store_name || '';
    document.getElementById('set-owner_wa').value = storeSettings.owner_wa || '';
    document.getElementById('set-address').value = storeSettings.address || '';
    document.getElementById('set-open_hours').value = storeSettings.open_hours || '';
    document.getElementById('set-min_order').value = storeSettings.min_order || '';
    const qrisEl = document.getElementById('set-qris_static');
    if (qrisEl) qrisEl.value = storeSettings.qris_static || '';
    // Banner & social fields
    const setField = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setField('set-banner_image', storeSettings.banner_image);
    setField('set-banner_link', storeSettings.banner_link);
    setField('set-promo_text', storeSettings.promo_text);
    setField('set-promo_link', storeSettings.promo_link);
    setField('set-social_ig', storeSettings.social_ig);
    setField('set-social_tt', storeSettings.social_tt);
    setField('set-cutoff_time', storeSettings.cutoff_time);
  } catch (e) { /* non-fatal */ }
  if (currentAdminRole() === 'owner') loadStaffList();
}

async function saveSettings() {
  try {
    await apiFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        store_name: document.getElementById('set-store_name').value.trim(),
        owner_wa: document.getElementById('set-owner_wa').value.trim(),
        address: document.getElementById('set-address').value.trim(),
        open_hours: document.getElementById('set-open_hours').value.trim(),
        min_order: document.getElementById('set-min_order').value.trim(),
        cutoff_time: document.getElementById('set-cutoff_time').value,
      }),
    });
    showToast('Pengaturan disimpan');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function saveQrisSettings() {
  const qrisText = document.getElementById('set-qris_static').value.trim();
  const resultEl = document.getElementById('qrisTestResult');
  resultEl.innerHTML = '<p style="color:var(--gray);font-size:0.85rem;">Menyimpan & menguji...</p>';
  try {
    await apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ qris_static: qrisText }) });
    storeSettings.qris_static = qrisText;

    if (!qrisText) {
      resultEl.innerHTML = '<p style="color:var(--gray);font-size:0.85rem;">QRIS dikosongkan — halaman pembayaran pelanggan akan otomatis pakai jalur konfirmasi WhatsApp biasa.</p>';
      showToast('Pengaturan QRIS disimpan');
      return;
    }
    const test = await apiFetch('/api/payment/qris-test', { method: 'POST', body: JSON.stringify({ qris_static: qrisText, amount: 15000 }) });
    resultEl.innerHTML = `
      <div style="background:var(--leaf-light);border-radius:var(--radius-sm);padding:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
        <img src="${test.qrDataUrl}" alt="Pratinjau QRIS" style="width:130px;height:130px;border-radius:8px;background:white;padding:6px;"/>
        <div>
          <p style="font-weight:700;color:var(--leaf-dark);margin-bottom:4px;">✓ QRIS valid & tersimpan</p>
          <p style="font-size:0.82rem;color:var(--gray);">Ini contoh untuk nominal Rp 15.000 — coba scan pakai HP kamu untuk pastikan nominalnya kebaca benar sebelum dipakai pelanggan.</p>
        </div>
      </div>`;
    showToast('QRIS disimpan & valid ✓');
  } catch (e) {
    resultEl.innerHTML = `<p style="color:var(--clay);font-size:0.85rem;">✗ ${e.message}</p>`;
    showToast('QRIS belum valid, dicek lagi ya', 'error');
  }
}

async function saveBannerSettings() {
  try {
    await apiFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        banner_image: document.getElementById('set-banner_image').value.trim(),
        banner_link: document.getElementById('set-banner_link').value.trim(),
        promo_text: document.getElementById('set-promo_text').value.trim(),
        promo_link: document.getElementById('set-promo_link').value.trim(),
        social_ig: document.getElementById('set-social_ig').value.trim(),
        social_tt: document.getElementById('set-social_tt').value.trim(),
      }),
    });
    // Refresh storeSettings
    storeSettings = await apiFetch('/api/admin/settings');
    initHeroBanner();
    initPromoBanner();
    updateSocialLinks();
    showToast('Banner & promo disimpan ✓');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function changePassword() {
  const currentPassword = document.getElementById('pw-current').value;
  const newPassword = document.getElementById('pw-new').value;
  try {
    await apiFetch('/api/admin/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    showToast('Password berhasil diganti');
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value = '';
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function loadStaffList() {
  const el = document.getElementById('staffList');
  if (!el) return;
  try {
    const staff = await apiFetch('/api/admin/staff');
    el.innerHTML = staff.map(s => `<div class="top-menu-item"><span>${s.name} (@${s.username}) — ${s.role}</span><button class="del-btn" style="flex:none;padding:4px 10px;" onclick="deleteStaff(${s.id})">Hapus</button></div>`).join('');
  } catch (e) { /* ignore */ }
}

async function addStaff() {
  const name = document.getElementById('staff-name').value.trim();
  const username = document.getElementById('staff-username').value.trim();
  const password = document.getElementById('staff-password').value;
  const role = document.getElementById('staff-role').value;
  if (!name || !username || !password) { showToast('Lengkapi data staf.', 'error'); return; }
  try {
    await apiFetch('/api/admin/staff', { method: 'POST', body: JSON.stringify({ name, username, password, role }) });
    ['staff-name', 'staff-username', 'staff-password'].forEach(id => document.getElementById(id).value = '');
    loadStaffList();
    showToast('Staf ditambahkan');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteStaff(id) {
  if (!await showConfirm('Hapus Akun Staf', 'Akun staf akan dihapus permanen. Yakin?')) return;
  try {
    await apiFetch('/api/admin/staff/' + id, { method: 'DELETE' });
    loadStaffList();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ================== REAL-TIME (Socket.IO) ==================
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* audio not available */ }
}

function browserNotify(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') new Notification(title, { body });
  else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') new Notification(title, { body }); });
}

function connectSocket() {
  if (socket || typeof io === 'undefined') return;
  socket = io();
  socket.emit('join-admin');
  socket.on('new-order', (order) => {
    showToast(`🛎️ Pesanan baru masuk: ${order.id}`, 'info');
    playBeep();
    browserNotify('Pesanan baru — NokAyune', `${order.name} • ${fmtRp(order.total)}`);
    if (document.getElementById('admin-orders')?.classList.contains('active')) renderAdminOrders(ordersFilter, ordersPage);
  });
  socket.on('order-updated', () => {
    if (document.getElementById('admin-orders')?.classList.contains('active')) renderAdminOrders(ordersFilter, ordersPage);
  });
}

// ================== HELPERS ==================
function fmtRp(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }

// ================== NAVBAR SCROLL ==================
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  nav.style.boxShadow = window.scrollY > 20 ? '0 4px 24px rgba(36,31,25,0.08)' : 'none';
});

// ================== SCROLL REVEAL ==================
function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// ================== INIT ==================
document.addEventListener('DOMContentLoaded', async () => {
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
  try { storeSettings = await apiFetch('/api/admin/settings'); } catch (e) { /* non-fatal */ }
  await loadRegions();
  loadMenu();
  updateCartCount();
  if (isAdminLoggedIn()) connectSocket();
  loadHeroStats();
  initUploadPreview('mf-photo', 'uploadPreview');
  initLazyImages();
  initParallax();
  initPromoBanner();
  updateFloatWA();
  updateSocialLinks();
  updateCustomerUI();
  initHeroBanner();
  loadRealReviews();

  // Animate hero counter when visible
  const heroObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(document.getElementById('heroTotalOrders'), 500, 1800);
        heroObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  const heroStats = document.querySelector('.hero-stats');
  if (heroStats) heroObserver.observe(heroStats);

  // Form field validation listeners
  ['co-name', 'co-phone', 'co-address', 'co-time'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => validateField(id, 'fg-' + id, true));
  });

  // Scroll reveal
  initScrollReveal();

  // Navbar scroll effect
  window.addEventListener('scroll', () => {
    const nav = document.getElementById('navbar');
    if (!nav) return;
    nav.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });

  // Close mobile menu on resize
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeMobileMenu();
  });
});
