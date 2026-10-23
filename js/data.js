/* =============================================================================
   data.js  ·  CAPA DE DATOS DEL FRONT-END
   -----------------------------------------------------------------------------
   Es el "puente" entre las paginas y el servidor. Aqui vive:
     • DB      → objeto con todas las llamadas a la API (productos, categorias,
                 marcas, pedidos, gastos...) y el CARRITO (busca "── CART ──").
     • Helpers → formatPrice, formatDate, showToast (avisos), updateCartBadge
                 (el numerito rojo del carrito), animaciones al hacer scroll.
     • Constantes → categorias, tallas, colores y estados de pedido por defecto.
   El CARRITO se guarda en el navegador (localStorage) y, si hay sesion iniciada,
   se sincroniza con la base de datos. Ver getCart / addToCart / _saveCart.
   ============================================================================= */

// ── API HELPER ───────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error || 'Error del servidor'), { status: res.status, data: err });
  }
  return res.json();
}

// ── DB ────────────────────────────────────────────────────────────────────────
const DB = {
  // Caches en memoria para lectura síncrona post-carga
  _catsCache:  null,
  _brandsCache: null,
  _prodsCache: null,

  getCats()        { return this._catsCache   || {}; },
  getBrandsCache() { return this._brandsCache || {}; },
  getProds()       { return this._prodsCache  || []; },
  getProductSync(id) { return (this._prodsCache || []).find(p => p.id == id) || null; },

  // ── PRODUCTS ────────────────────────────────────────────────────────────────
  async getProducts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const products = await apiFetch(`/api/products${qs ? '?' + qs : ''}`);
    this._prodsCache = products;
    return products;
  },

  async searchProducts(query, filters = {}) {
    const params = {};
    if (query)            params.q        = query;
    if (filters.sort)     params.sort     = filters.sort;
    if (filters.minPrice) params.minPrice = filters.minPrice;
    if (filters.maxPrice) params.maxPrice = filters.maxPrice;
    // Una sola categoría → la filtra el servidor (índice + JSON_CONTAINS). Varias
    // categorías → se traen todas y se filtran aquí con OR contra el arreglo de
    // categorías del producto (antes esto colapsaba a la primera categoría).
    if (filters.categories?.length === 1) params.cat = filters.categories[0];
    if (filters.brands?.length === 1) params.brand = filters.brands[0]; // single brand filter
    let products = await apiFetch('/api/products?' + new URLSearchParams(params));
    if (filters.categories?.length > 1) {
      products = products.filter(p => (p.categories || [p.category]).some(c => filters.categories.includes(c)));
    }
    if (filters.brands?.length > 1) {
      products = products.filter(p => filters.brands.includes(p.brand));
    }
    return products;
  },

  async getProduct(id) {
    // Intenta desde cache primero
    const cached = this.getProductSync(id);
    if (cached) return cached;
    return apiFetch(`/api/products/${id}`);
  },

  async getRelated(product, limit = 4) {
    return apiFetch(`/api/products?cat=${product.category}&exclude=${product.id}&limit=${limit}`);
  },

  async addProduct(data)       { return apiFetch('/api/products', { method: 'POST', body: JSON.stringify(data) }); },
  async updateProduct(id, data){ return apiFetch(`/api/products/${id}`, { method: 'PUT',  body: JSON.stringify(data) }); },
  async deleteProduct(id)      { return apiFetch(`/api/products/${id}`, { method: 'DELETE' }); },
  async getStockStats()        { return apiFetch('/api/products/stats'); },

  // ── CATEGORIES ──────────────────────────────────────────────────────────────
  async getCategories() {
    const cats = await apiFetch('/api/categories');
    this._catsCache = cats;
    return cats;
  },

  async addCategory(data)        { return apiFetch('/api/categories',        { method: 'POST',   body: JSON.stringify(data) }); },
  async updateCategory(key, data){ return apiFetch(`/api/categories/${key}`, { method: 'PUT',    body: JSON.stringify(data) }); },
  async deleteCategory(key)      { return apiFetch(`/api/categories/${key}`, { method: 'DELETE' }); },

  // ── BRANDS / MARCAS ─────────────────────────────────────────────────────────
  async getBrands() {
    const brands = await apiFetch('/api/brands');
    this._brandsCache = brands;
    return brands;
  },

  async addBrand(data)         { return apiFetch('/api/brands',        { method: 'POST',   body: JSON.stringify(data) }); },
  async updateBrand(key, data) { return apiFetch(`/api/brands/${key}`, { method: 'PUT',    body: JSON.stringify(data) }); },
  async deleteBrand(key)       { return apiFetch(`/api/brands/${key}`, { method: 'DELETE' }); },

  // ── CART (localStorage) ─────────────────────────────────────────────────────
  CART_KEY: 'fajasmaydel_cart',

  getCart()       { try { return JSON.parse(localStorage.getItem(this.CART_KEY) || '[]'); } catch { return []; } },
  _saveCart(cart) {
    localStorage.setItem(this.CART_KEY, JSON.stringify(cart));
    document.dispatchEvent(new CustomEvent('cartUpdated'));
    // Sync a DB si el usuario esta logueado (fire-and-forget)
    if (window.AUTH?.getSession?.()) {
      fetch('/api/cart', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart }),
      }).catch(() => {});
    }
  },

  // Llama esto al hacer login para fusionar carrito de DB con localStorage
  async syncCartFromServer() {
    if (!window.AUTH?.getSession?.()) return;
    try {
      const r = await fetch('/api/cart', { credentials: 'include' });
      if (!r.ok) return;
      const serverCart = await r.json();
      if (!serverCart.length) return; // Nada en DB, conservar local
      const localCart = this.getCart();
      if (!localCart.length) {
        // Local vacio: usar DB tal cual
        const merged = serverCart.map(s => ({ key:`${s.productId}-${s.size}-${s.color}-${s.option||''}`, productId:s.productId, qty:s.qty, size:s.size, color:s.color, option:s.option||'' }));
        localStorage.setItem(this.CART_KEY, JSON.stringify(merged));
        document.dispatchEvent(new CustomEvent('cartUpdated'));
      } else {
        // Merge: sumar cantidades por (productId,size,color,option)
        const k = i => `${i.productId}-${i.size}-${i.color}-${i.option||''}`;
        const map = new Map(localCart.map(i => [k(i), i]));
        for (const s of serverCart) {
          const key = k(s);
          if (map.has(key)) map.get(key).qty += s.qty;
          else map.set(key, { key, productId:s.productId, qty:s.qty, size:s.size, color:s.color, option:s.option||'' });
        }
        this._saveCart([...map.values()]);
      }
    } catch {}
  },

  addToCart(productId, qty = 1, size = '', color = '', option = '') {
    this.addManyToCart([{ productId, qty, size, color, option }]);
  },

  // Varias combinaciones de una vez (la misma faja en 4 tallas, por ejemplo).
  // Un solo _saveCart por lote: si guardaramos una por una, los PUT /api/cart
  // van sueltos y pueden llegar desordenados, dejando en la DB un carrito viejo.
  // `option` = opción extra de la variante (p.ej. "Con tirantes"); forma parte de
  // la clave para no mezclar dos variantes que solo difieren en esa opción.
  addManyToCart(entries) {
    const cart = this.getCart();
    for (const { productId, qty = 1, size = '', color = '', option = '' } of entries) {
      if (qty < 1) continue;
      const key  = `${productId}-${size}-${color}-${option}`;
      const item = cart.find(i => i.key === key);
      if (item) item.qty += qty;
      else cart.push({ key, productId, qty, size, color, option });
    }
    this._saveCart(cart);
    const pieces = entries.reduce((n, e) => n + (e.qty > 0 ? e.qty : 0), 0);
    if (pieces && window.trackEvent) window.trackEvent('add_to_cart', { items: entries.map(e => ({ item_id: String(e.productId), quantity: e.qty })) });
  },

  removeFromCart(key) { this._saveCart(this.getCart().filter(i => i.key !== key)); },
  updateCartQty(key, qty) {
    const cart = this.getCart();
    const item = cart.find(i => i.key === key);
    if (item) { item.qty = Math.max(1, qty); this._saveCart(cart); }
  },
  clearCart() { this._saveCart([]); },
  getCartCount() { return this.getCart().reduce((s, i) => s + i.qty, 0); },

  // Piezas mínimas de un mismo producto (sumando tallas/colores) para mayoreo.
  WHOLESALE_MIN: 6,

  // Precio base de un ítem según su VARIANTE. Si la variante elegida (color +
  // opción) tiene precio propio, ese manda; si no, el precio del producto. Debe
  // coincidir con la misma lógica del servidor en routes/orders.js.
  _variantBasePrice(product, item) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length) {
      const m = variants.find(v => (v.color || '') === (item.color || '') && (v.option || '') === (item.option || ''));
      if (m && m.price != null && Number(m.price) > 0) return Number(m.price);
    }
    return product.price;
  },

  // Inventario disponible de un ítem (talla+color+opción). Devuelve un número, o
  // null cuando no hay control de inventario (producto/variante sin stock por talla
  // = sin límite). Si el producto tiene variantes pero la combinación no existe, 0.
  _comboStock(product, item) {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length) {
      const v = variants.find(v => (v.color || '') === (item.color || '') && (v.option || '') === (item.option || ''));
      if (!v) return product.stock != null ? product.stock : 0;
      const se = (v.sizes || []).find(s => (s && typeof s === 'object' ? s.size : s) === (item.size || ''));
      if (!se) return 0;                                   // esa talla ya no está
      return (typeof se === 'object') ? se.stock : null;   // número, o null (talla vieja sin control)
    }
    return product.stock != null ? product.stock : null;
  },

  // Aplica el precio de mayoreo: cada ítem recibe `unitPrice` (mayoreo o normal)
  // y `wholesale` (bool). El mayoreo se activa por PRODUCTO cuando la suma de sus
  // piezas —combinando tallas/colores— llega a WHOLESALE_MIN y tiene precio de mayoreo.
  // El precio "normal" es el de la variante (puede diferir entre variantes).
  _applyWholesale(items) {
    const qtyByProduct = {};
    items.forEach(i => { qtyByProduct[i.productId] = (qtyByProduct[i.productId] || 0) + i.qty; });
    return items.map(i => {
      const wp = i.product.wholesalePrice;
      const totalQty = qtyByProduct[i.productId] || i.qty;
      const wholesale = wp != null && wp > 0 && totalQty >= this.WHOLESALE_MIN;
      const regularPrice = this._variantBasePrice(i.product, i);
      const unitPrice = wholesale ? wp : regularPrice;
      return { ...i, unitPrice, wholesale, regularPrice };
    });
  },

  async getCartItems() {
    const cart = this.getCart();
    if (!cart.length) return [];
    const ids = [...new Set(cart.map(i => i.productId))];
    let products;
    try {
      products = await apiFetch(`/api/products?ids=${ids.join(',')}`);
    } catch { products = []; }
    const map = Object.fromEntries(products.map(p => [p.id, p]));
    const items = cart.map(item => {
      const product = map[item.productId];
      return product ? { ...item, product } : null;
    }).filter(Boolean);
    // Precio (variante/mayoreo) + inventario disponible de cada combinación.
    return this._applyWholesale(items).map(i => ({ ...i, stockAvailable: this._comboStock(i.product, i) }));
  },

  async getCartTotal() {
    const items = await this.getCartItems();
    return items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  },

  // ── ORDERS ──────────────────────────────────────────────────────────────────
  async getOrders()          { return apiFetch('/api/orders'); },
  async getOrderStats()      { return apiFetch('/api/orders/stats'); },
  async updateOrderStatus(id, status) {
    return apiFetch(`/api/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
  },
  async setOrderDelay(id, delayed, note = '') {
    return apiFetch(`/api/orders/${id}/delay`, { method: 'PUT', body: JSON.stringify({ delayed, note }) });
  },
  async setOrderPayment(id, paymentStatus) {
    return apiFetch(`/api/orders/${id}/payment`, { method: 'PUT', body: JSON.stringify({ paymentStatus }) });
  },
  async setOrderTracking(id, carrier, number) {
    return apiFetch(`/api/orders/${id}/tracking`, { method: 'PUT', body: JSON.stringify({ carrier, number }) });
  },
  async refundOrder(id) {
    return apiFetch(`/api/orders/${id}/refund`, { method: 'POST' });
  },
  async addOrder(userId, userName, userEmail, items, total, shippingInfo = {}, notes = '') {
    return apiFetch('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ userId, userName, userEmail, items, total, shippingInfo, notes }),
    });
  },

  // ── EXPENSES ─────────────────────────────────────────────────────────────────
  async getExpenses()     { return apiFetch('/api/expenses'); },
  async getExpenseStats() { return apiFetch('/api/expenses/stats'); },
  async addExpense(concept, amount, category, date, notes) {
    return apiFetch('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ concept, amount, category, date, notes }),
    });
  },
  async deleteExpense(id) { return apiFetch(`/api/expenses/${id}`, { method: 'DELETE' }); },

  // ── FINANCE ──────────────────────────────────────────────────────────────────
  async getMonthlyData(year)  { return apiFetch(`/api/finance/monthly?year=${year}`); },
  async getExpensesByCategory(year) { return apiFetch(`/api/finance/expenses-by-category?year=${year}`); },

  // ── REVIEWS (localStorage) ────────────────────────────────────────────────────
  REVIEWS_KEY: 'fajasmaydel_reviews',
  getReviews() {
    try { return JSON.parse(localStorage.getItem(this.REVIEWS_KEY) || '[]'); } catch { return []; }
  },
  addReview(data) {
    const reviews = this.getReviews();
    const review = { ...data, id: 'REV-' + Date.now(), createdAt: new Date().toISOString() };
    reviews.unshift(review);
    localStorage.setItem(this.REVIEWS_KEY, JSON.stringify(reviews));
    return review;
  },
  deleteReview(id) {
    const reviews = this.getReviews().filter(r => r.id !== id);
    localStorage.setItem(this.REVIEWS_KEY, JSON.stringify(reviews));
  },
};

// ── CONSTANTES (sin cambios) ──────────────────────────────────────────────────
const DEFAULT_CATEGORIES = {
  'fajas-reductoras':  { label: 'Fajas Reductoras',  icon: 'fa-solid fa-vest' },
  'fajas-postparto':   { label: 'Fajas Postparto',   icon: 'fa-solid fa-baby' },
  'fajas-colombianas': { label: 'Fajas Colombianas', icon: 'fa-solid fa-flag' },
  'cinturillas':       { label: 'Cinturillas',       icon: 'fa-solid fa-ring' },
  'bodis':             { label: 'Bodis',             icon: 'fa-solid fa-person-dress' },
  'leggins':           { label: 'Leggings',          icon: 'fa-solid fa-socks' },
  'accesorios':        { label: 'Accesorios',        icon: 'fa-solid fa-gem' },
};

const STANDARD_SIZES = ['2XS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','Talla única'];

const COLOR_MAP = {
  'Negro':  '#1a1a1a', 'Blanco':  '#f0f0f0', 'Beige':   '#d4b896',
  'Nude':   '#c9a07a', 'Café':    '#6b4226', 'Cocoa':   '#3e2010',
  'Rojo':   '#cc2200', 'Rosa':    '#e84393', 'Azul':    '#1a3d99',
  'Verde':  '#1a5c2e', 'Gris':    '#777777', 'Morado':  '#6a0dad',
  'Naranja':'#e06020', 'Dorado':  '#c9a96e',
};

const ORDER_STATUSES = {
  pending:    { label: 'Pendiente',   color: '#f59e0b', icon: 'fa-clock' },
  confirmed:  { label: 'Confirmado', color: '#3b82f6', icon: 'fa-circle-check' },
  processing: { label: 'En proceso', color: '#8b5cf6', icon: 'fa-gear' },
  shipped:    { label: 'Enviado',    color: '#06b6d4', icon: 'fa-truck' },
  delivered:  { label: 'Entregado',  color: '#10b981', icon: 'fa-box-open' },
  cancelled:  { label: 'Cancelado',  color: '#ef4444', icon: 'fa-xmark' },
};

const EXPENSE_CATEGORIES = {
  inventario: 'Inventario / Mercancía',
  marketing:  'Marketing y Publicidad',
  operacion:  'Operación / Gastos fijos',
  envio:      'Envíos y logística',
  otro:       'Otro',
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
function formatPrice(price) {
  return '$ ' + Number(price || 0).toLocaleString('es-MX');
}

function formatDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getProductId() { return Number(new URLSearchParams(window.location.search).get('id')); }
function getSearchQuery() { return new URLSearchParams(window.location.search).get('q') || ''; }

function showToast(msg, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) { container = document.createElement('div'); container.className = 'toast-container'; document.body.appendChild(container); }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-xmark' : 'fa-circle-info';
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function updateCartBadge() {
  document.querySelectorAll('.cart-badge-count').forEach(b => {
    const count = DB.getCartCount();
    b.textContent = count;
    b.style.display = count > 0 ? 'flex' : 'none';
  });
}

function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.anim').forEach(el => observer.observe(el));
}

// ── SEED RESEÑAS DE EJEMPLO ───────────────────────────────────────────────────
(function _seedReviews() {
  try {
    if (JSON.parse(localStorage.getItem('fajasmaydel_reviews') || '[]').length > 0) return;
    const samples = [
      {
        id: 'REV-001', name: 'Ana Martínez', location: 'Chihuahua, Chih.', rating: 5,
        text: '¡Me encantó! La calidad es excelente, muy cómoda y se nota el resultado desde el primer día. El envío llegó súper rápido. Ya hice mi segundo pedido.',
        photo: 'https://randomuser.me/api/portraits/women/44.jpg',
        date: '2025-04-10', createdAt: '2025-04-10T10:00:00.000Z'
      },
      {
        id: 'REV-002', name: 'Sofía Ramírez', location: 'Ciudad Juárez, Chih.', rating: 5,
        text: 'Muy buena atención, me ayudaron a elegir la talla correcta por WhatsApp. La faja es de muy buena calidad, parece colombiana original. 100% recomendada.',
        photo: 'https://randomuser.me/api/portraits/women/63.jpg',
        date: '2025-03-28', createdAt: '2025-03-28T10:00:00.000Z'
      },
      {
        id: 'REV-003', name: 'Valeria Torres', location: 'Delicias, Chih.', rating: 5,
        text: 'Llevo 2 meses usando mi faja reductora y los resultados son increíbles. Muy cómoda para todo el día. Definitivamente volvería a comprar aquí.',
        photo: 'https://randomuser.me/api/portraits/women/82.jpg',
        date: '2025-03-15', createdAt: '2025-03-15T10:00:00.000Z'
      },
      {
        id: 'REV-004', name: 'Gabriela López', location: 'Hermosillo, Son.', rating: 5,
        text: 'Excelente producto y servicio. La faja postparto me ayudó mucho en mi recuperación. Llegó bien empacada y en tiempo. ¡Muchas gracias Maydel!',
        photo: 'https://randomuser.me/api/portraits/women/28.jpg',
        date: '2025-02-20', createdAt: '2025-02-20T10:00:00.000Z'
      }
    ];
    localStorage.setItem('fajasmaydel_reviews', JSON.stringify(samples));
  } catch(e) { console.warn('_seedReviews error:', e); }
})();

document.addEventListener('cartUpdated', updateCartBadge);
document.addEventListener('DOMContentLoaded', () => { updateCartBadge(); initScrollAnimations(); });
