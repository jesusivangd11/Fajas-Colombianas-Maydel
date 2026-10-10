/* =============================================================================
   main.js  ·  FUNCIONES COMPARTIDAS DE LA TIENDA
   -----------------------------------------------------------------------------
   Se carga en todas las paginas publicas. Aqui vive:
     • esc()                → limpia texto del usuario (proteccion anti-XSS).
     • Buscador (search-bar) → manda al usuario a tienda.html?q=...
     • Favoritos (corazon)   → toggleCardWishlist / loadWishlistIds.
     • injectMobileMenu()    → el menu hamburguesa en celular.
     • injectTrustBadges()   → los sellos de "Compra segura / Stripe" del footer.
     • renderProductCard()   → dibuja UNA tarjeta de producto (foto, precio,
                               boton "Añadir", corazon). Busca aqui para cambiar
                               el diseño de las tarjetas.
     • quickAddToCart()      → boton "Añadir" rapido de cada tarjeta.
   ============================================================================= */

// Escapa contenido de usuario antes de insertarlo con innerHTML (anti-XSS).
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Devuelve el atributo style con el punto de enfoque (object-position) de una
// imagen, si el admin lo definió. Se aplica donde la foto se recorta (cover).
// Solo aceptamos "x% y%" para no inyectar CSS arbitrario.
function imgFocusStyle(focusMap, url) {
  const v = focusMap && focusMap[url];
  if (typeof v === 'string' && /^\d{1,3}% \d{1,3}%$/.test(v)) return ` style="object-position:${v}"`;
  return '';
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
  injectProductsDropdown();
  injectFooterCategories();
  setFooterYear();
});

// ── FOOTER: columna "Productos" con las categorías reales ──
// El footer está repetido en cada página. En vez de mantener a mano la lista de
// categorías, se localiza la columna cuyo título es "Productos" y se reemplazan
// sus enlaces por las categorías activas de la API, para que se actualice sola.
async function injectFooterCategories() {
  const cols = [...document.querySelectorAll('footer .footer-col')];
  const col = cols.find(c => {
    const h = c.querySelector('h4');
    return h && h.textContent.trim().toLowerCase() === 'productos';
  });
  if (!col) return;

  let cats = DB.getCats();
  if (!cats || !Object.keys(cats).length) {
    try { cats = await DB.getCategories(); } catch { cats = {}; }
  }
  const entries = Object.entries(cats).filter(([, c]) => c.active !== false);
  if (!entries.length) return;

  const base = getBase();
  col.querySelectorAll('a').forEach(a => a.remove());
  const frag = document.createDocumentFragment();
  entries.slice(0, 8).forEach(([key, c]) => {
    const a = document.createElement('a');
    a.href = `${base}tienda.html?cat=${encodeURIComponent(key)}`;
    a.textContent = c.label;
    frag.appendChild(a);
  });
  col.appendChild(frag);
}

// ── DROPDOWN "PRODUCTOS" (categorías al pasar el ratón) ──
// El menú de navegación está repetido en cada página, así que en vez de tocar
// todos los HTML se construye aquí una sola vez: se localiza el enlace de
// "Productos" (el que apunta a tienda.html) y se le cuelga un submenú con las
// categorías activas traídas de la API. En escritorio se abre al pasar el ratón;
// en móvil se despliega como acordeón tocando la flecha.
async function injectProductsDropdown() {
  const navUl = document.querySelector('header .nav-bar ul');
  if (!navUl) return;

  const link = [...navUl.querySelectorAll('a')].find(a => {
    const href = (a.getAttribute('href') || '').split('?')[0];
    return /(^|\/)tienda\.html$/.test(href);
  });
  const li = link?.closest('li');
  if (!li || li.classList.contains('has-dropdown')) return;

  let cats = DB.getCats();
  if (!cats || !Object.keys(cats).length) {
    try { cats = await DB.getCategories(); } catch { cats = {}; }
  }
  const entries = Object.entries(cats).filter(([, c]) => c.active !== false);
  if (!entries.length) return;

  li.classList.add('has-dropdown');

  // Flechita indicadora dentro del enlace (visible en escritorio).
  if (!link.querySelector('.nav-chevron')) {
    const chev = document.createElement('i');
    chev.className = 'fa-solid fa-chevron-down nav-chevron';
    chev.setAttribute('aria-hidden', 'true');
    link.appendChild(chev);
  }

  // Botón de flecha para desplegar/plegar en móvil (no navega, solo abre).
  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'nav-caret';
  caret.setAttribute('aria-label', 'Ver categorías');
  caret.innerHTML = '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
  caret.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    li.classList.toggle('open');
  });
  li.appendChild(caret);

  const base = getBase();
  const dd = document.createElement('ul');
  dd.className = 'nav-dropdown';
  dd.innerHTML =
    `<li><a class="dd-all" href="${base}tienda.html"><i class="fa-solid fa-grip"></i> Ver todos los productos</a></li>` +
    entries.map(([key, c]) =>
      `<li><a href="${base}tienda.html?cat=${encodeURIComponent(key)}"><i class="${esc(c.icon || 'fa-solid fa-tag')}"></i> ${esc(c.label)}</a></li>`
    ).join('');
  li.appendChild(dd);
}

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

// ── AÑO DEL FOOTER ──
// El HTML trae el año escrito como respaldo por si el JS no corre;
// aqui se reescribe con el año real para que no se quede atrasado.
function setFooterYear() {
  const y = new Date().getFullYear();
  document.querySelectorAll('#footerYear').forEach(el => el.textContent = y);
}

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

  const safeName = esc(product.name);
  return `
  <article class="product-card anim fade-up">
    <a href="${getBase()}producto.html?id=${product.id}" aria-label="Ver ${safeName}">
      <div class="product-card-img">
        ${imgSrc
          ? `<img src="${esc(imgSrc)}" alt="${safeName}" loading="lazy" decoding="async" onerror="this.parentNode.innerHTML='<div class=\\'no-img\\'><i class=\\'fa-solid fa-shirt\\'></i></div>'">`
          : `<div class="no-img"><i class="fa-solid fa-shirt" aria-hidden="true"></i></div>`}
        ${hasDiscount ? `<span class="badge-discount">-${discountPct}%</span>` : ''}
        ${product.isNew ? `<span class="badge-new">Nuevo</span>` : ''}
        <button class="wishlist-heart" data-pid="${product.id}" onclick="toggleCardWishlist(${product.id}, this, event)" aria-label="Guardar en favoritos">
          <i class="fa-regular fa-heart" aria-hidden="true"></i>
        </button>
      </div>
    </a>
    <div class="product-card-body">
      ${catInfo.label ? `<div class="product-category"><i class="${esc(catInfo.icon)}"></i> ${esc(catInfo.label)}</div>` : ''}
      <a href="${getBase()}producto.html?id=${product.id}">
        <div class="product-name">${safeName}</div>
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
      <a href="${getBase()}producto.html?id=${product.id}" class="btn-detail" aria-label="Ver detalle de ${safeName}">
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
  // Productos con variantes (color → tallas + opción) no se pueden resolver desde
  // la tarjeta: hay que elegir la combinación en la ficha. Se redirige allí.
  if (Array.isArray(product.variants) && product.variants.length) {
    window.location.href = `${getBase()}producto.html?id=${productId}`;
    return;
  }
  const size  = product.sizes?.[0] || '';
  const color = product.colors?.[0] || '';
  DB.addToCart(productId, 1, size, color);
  showAddedToCartModal(product, { qty: 1, size, color });
}

// ── POPUP "AGREGADO AL CARRITO" ──
// Ventana emergente al añadir una faja, con enlace directo al carrito (estilo
// tiendas grandes). Se crea una sola vez y se reutiliza en todas las páginas.
function showAddedToCartModal(product, { qty = 1, size = '', color = '', option = '' } = {}) {
  let overlay = document.getElementById('addedCartModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'addedCartModal';
    overlay.className = 'added-cart-overlay';
    overlay.innerHTML = `
      <div class="added-cart-panel" role="dialog" aria-modal="true" aria-labelledby="acmTitle">
        <button class="added-cart-close" type="button" aria-label="Cerrar">&times;</button>
        <div class="added-cart-head">
          <span class="added-cart-check"><i class="fa-solid fa-check"></i></span>
          <div>
            <div class="added-cart-title" id="acmTitle">¡Agregado al carrito!</div>
            <div class="added-cart-sub" id="acmSub"></div>
          </div>
        </div>
        <div class="added-cart-body">
          <div class="added-cart-thumb" id="acmThumb"></div>
          <div class="added-cart-info">
            <div class="added-cart-name" id="acmName"></div>
            <div class="added-cart-meta" id="acmMeta"></div>
          </div>
        </div>
        <div class="added-cart-actions">
          <a class="added-cart-btn primary" id="acmGoCart"><i class="fa-solid fa-cart-shopping"></i> Ir al carrito</a>
          <button class="added-cart-btn ghost" type="button" id="acmContinue"><i class="fa-solid fa-arrow-left"></i> Seguir comprando</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.classList.remove('open');
    overlay.querySelector('.added-cart-close').onclick = close;
    overlay.querySelector('#acmContinue').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  const img = product.images?.[0];
  overlay.querySelector('#acmThumb').innerHTML = img
    ? `<img src="${esc(img)}" alt="" onerror="this.parentNode.innerHTML='<div class=\\'no-img\\'><i class=\\'fa-solid fa-shirt\\'></i></div>'">`
    : `<div class="no-img"><i class="fa-solid fa-shirt"></i></div>`;
  overlay.querySelector('#acmName').textContent = product.name;
  const meta = [size ? `Talla ${size}` : null, color || null, option || null, `${qty} unidad${qty > 1 ? 'es' : ''}`].filter(Boolean).join(' · ');
  overlay.querySelector('#acmMeta').textContent = meta;
  const count = DB.getCartCount();
  overlay.querySelector('#acmSub').textContent = `Tu carrito tiene ${count} producto${count !== 1 ? 's' : ''}`;
  overlay.querySelector('#acmGoCart').href = getBase() + 'carrito.html';
  overlay.classList.add('open');
}
