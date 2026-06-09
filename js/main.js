// Escapa contenido de usuario antes de insertarlo con innerHTML (anti-XSS).
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── SEARCH BAR ──
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.search-bar').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const q = form.querySelector('input').value.trim();
      if (q) {
        const base = window.location.pathname.includes('dashboard') ? '../' : '';
        window.location.href = `${base}tienda.html?q=${encodeURIComponent(q)}`;
      }
    });
  });
  const q = getSearchQuery();
  if (q) document.querySelectorAll('.search-bar input').forEach(i => i.value = q);

  injectMobileMenu();
  injectTrustBadges();
});

// ── WISHLIST EN CARD ──
let __wishlistIds = null;
async function loadWishlistIds() {
  if (!AUTH?.getSession?.()) { __wishlistIds = new Set(); return; }
  try {
    const r = await fetch('/api/wishlist', { credentials: 'include' });
    if (!r.ok) { __wishlistIds = new Set(); return; }
    const items = await r.json();
    __wishlistIds = new Set(items.map(p => p.id));
  } catch { __wishlistIds = new Set(); }
  document.querySelectorAll('.wishlist-heart').forEach(b => {
    const pid = Number(b.dataset.pid);
    if (__wishlistIds.has(pid)) {
      b.classList.add('active');
      b.querySelector('i').className = 'fa-solid fa-heart';
    }
  });
}
async function toggleCardWishlist(pid, btn, e) {
  e.preventDefault(); e.stopPropagation();
  if (!AUTH?.getSession?.()) { showToast('Inicia sesión para guardar favoritos', 'error'); setTimeout(() => location.href = getBase() + 'login.html', 1200); return; }
  if (!__wishlistIds) __wishlistIds = new Set();
  const isOn = __wishlistIds.has(pid);
  try {
    if (isOn) {
      await fetch('/api/wishlist/' + pid, { method: 'DELETE', credentials: 'include' });
      __wishlistIds.delete(pid);
      btn.classList.remove('active');
      btn.querySelector('i').className = 'fa-regular fa-heart';
      showToast('Quitado de favoritos');
    } else {
      await fetch('/api/wishlist', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ productId: pid }) });
      __wishlistIds.add(pid);
      btn.classList.add('active');
      btn.querySelector('i').className = 'fa-solid fa-heart';
      showToast('Añadido a favoritos');
    }
  } catch { showToast('Error', 'error'); }
}
// Recargar wishlist cuando se renderizan productos
const _origRender = window.renderProductCard;
new MutationObserver(() => {
  if (document.querySelector('.wishlist-heart:not([data-init])')) {
    document.querySelectorAll('.wishlist-heart:not([data-init])').forEach(b => b.setAttribute('data-init', '1'));
    loadWishlistIds();
  }
}).observe(document.body, { childList: true, subtree: true });

// ── SELLOS DE CONFIANZA ──
function injectTrustBadges() {
  const footer = document.querySelector('footer .container');
  if (!footer || footer.querySelector('.trust-badges')) return;
  const bottom = footer.querySelector('.footer-bottom');
  const strip = document.createElement('div');
  strip.className = 'trust-badges';
  strip.innerHTML = `
    <div class="trust-item"><i class="fa-solid fa-shield-halved"></i><span>Compra 100% segura</span></div>
    <div class="trust-item"><i class="fa-solid fa-lock"></i><span>Pagos con Stripe</span></div>
    <div class="trust-item"><i class="fa-brands fa-cc-visa" style="font-size:20px"></i><span>Visa</span></div>
    <div class="trust-item"><i class="fa-brands fa-cc-mastercard" style="font-size:20px"></i><span>Mastercard</span></div>
    <div class="trust-item"><i class="fa-brands fa-cc-amex" style="font-size:20px"></i><span>Amex</span></div>
    <div class="trust-item"><i class="fa-solid fa-truck-fast"></i><span>Envíos a todo México</span></div>
    <div class="trust-item"><i class="fa-solid fa-arrows-rotate"></i><span>Cambios garantizados</span></div>
  `;
  if (bottom) bottom.parentNode.insertBefore(strip, bottom);
  else footer.appendChild(strip);
}

// ── MOBILE MENU (HAMBURGUESA) ──
function injectMobileMenu() {
  const headerTop = document.querySelector('header .header-top');
  const navBar    = document.querySelector('header .nav-bar');
  if (!headerTop || !navBar) return;
  if (document.querySelector('.burger-btn')) return;

  const burger = document.createElement('button');
  burger.className = 'burger-btn';
  burger.setAttribute('aria-label', 'Abrir menú');
  burger.setAttribute('aria-expanded', 'false');
  burger.innerHTML = '<span></span><span></span><span></span>';
  headerTop.insertBefore(burger, headerTop.firstChild);

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'mobile-backdrop';
  document.body.appendChild(backdrop);

  navBar.classList.add('nav-bar-mobile-ready');

  function open() {
    navBar.classList.add('open');
    backdrop.classList.add('open');
    burger.classList.add('open');
    burger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    navBar.classList.remove('open');
    backdrop.classList.remove('open');
    burger.classList.remove('open');
    burger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
  burger.addEventListener('click', () => navBar.classList.contains('open') ? close() : open());
  backdrop.addEventListener('click', close);
  navBar.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  window.addEventListener('resize', () => { if (window.innerWidth > 768) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

// ── PRODUCT CARD ──
function renderProductCard(product) {
  const cats    = DB.getCats();
  const catInfo = cats[product.category] || {};
  const imgSrc  = product.images?.[0];
  const hasDiscount  = product.originalPrice && product.originalPrice > product.price;
  const discountPct  = hasDiscount ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;

  return `
  <article class="product-card anim fade-up">
    <a href="${getBase()}producto.html?id=${product.id}" aria-label="Ver ${product.name}">
      <div class="product-card-img">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="${product.name}" loading="lazy" decoding="async" onerror="this.parentNode.innerHTML='<div class=\\'no-img\\'><i class=\\'fa-solid fa-shirt\\'></i></div>'">`
          : `<div class="no-img"><i class="fa-solid fa-shirt" aria-hidden="true"></i></div>`}
        ${hasDiscount ? `<span class="badge-discount">-${discountPct}%</span>` : ''}
        ${product.isNew ? `<span class="badge-new">Nuevo</span>` : ''}
        <button class="wishlist-heart" data-pid="${product.id}" onclick="toggleCardWishlist(${product.id}, this, event)" aria-label="Guardar en favoritos">
          <i class="fa-regular fa-heart" aria-hidden="true"></i>
        </button>
      </div>
    </a>
    <div class="product-card-body">
      ${catInfo.label ? `<div class="product-category"><i class="${catInfo.icon}"></i> ${catInfo.label}</div>` : ''}
      <a href="${getBase()}producto.html?id=${product.id}">
        <div class="product-name">${product.name}</div>
      </a>
      <div class="product-price">
        <span class="price-main">${formatPrice(product.price)}</span>
        ${hasDiscount ? `<span class="price-original">${formatPrice(product.originalPrice)}</span>` : ''}
      </div>
    </div>
    <div class="product-card-actions">
      <button class="btn-add-cart" onclick="quickAddToCart(${product.id}, event)">
        <i class="fa-solid fa-cart-plus"></i> Añadir
      </button>
      <a href="${getBase()}producto.html?id=${product.id}" class="btn-detail" aria-label="Ver detalle de ${product.name}">
        <i class="fa-solid fa-eye" aria-hidden="true"></i>
      </a>
    </div>
  </article>`;
}

function getBase() {
  return window.location.pathname.includes('dashboard') ? '../' : '';
}

// quickAddToCart es síncrono: usa cache que ya fue cargado antes de renderizar las tarjetas
function quickAddToCart(productId, e) {
  e.preventDefault();
  const product = DB.getProductSync(productId);
  if (!product) return;
  DB.addToCart(productId, 1, product.sizes?.[0] || '', product.colors?.[0] || '');
  showToast(`"${product.name}" agregado al carrito`);
}
