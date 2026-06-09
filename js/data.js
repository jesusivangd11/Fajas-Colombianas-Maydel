// ── API HELPER ───────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Error del servidor');
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
    if (filters.categories?.length) params.cat = filters.categories[0]; // single cat filter
    if (filters.brands?.length === 1) params.brand = filters.brands[0]; // single brand filter
    let products = await apiFetch('/api/products?' + new URLSearchParams(params));
    if (filters.categories?.length > 1) {
      products = products.filter(p => filters.categories.includes(p.category));
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
        const merged = serverCart.map(s => ({ key:`${s.productId}-${s.size}-${s.color}`, productId:s.productId, qty:s.qty, size:s.size, color:s.color }));
        localStorage.setItem(this.CART_KEY, JSON.stringify(merged));
        document.dispatchEvent(new CustomEvent('cartUpdated'));
      } else {
        // Merge: sumar cantidades por (productId,size,color)
        const map = new Map(localCart.map(i => [`${i.productId}-${i.size}-${i.color}`, i]));
        for (const s of serverCart) {
          const key = `${s.productId}-${s.size}-${s.color}`;
          if (map.has(key)) map.get(key).qty += s.qty;
          else map.set(key, { key, productId:s.productId, qty:s.qty, size:s.size, color:s.color });
        }
        this._saveCart([...map.values()]);
      }
    } catch {}
  },

  addToCart(productId, qty = 1, size = '', color = '') {
    const cart = this.getCart();
    const key  = `${productId}-${size}-${color}`;
    const item = cart.find(i => i.key === key);
    if (item) item.qty += qty;
    else cart.push({ key, productId, qty, size, color });
    this._saveCart(cart);
  },

  removeFromCart(key) { this._saveCart(this.getCart().filter(i => i.key !== key)); },
  updateCartQty(key, qty) {
    const cart = this.getCart();
    const item = cart.find(i => i.key === key);
    if (item) { item.qty = Math.max(1, qty); this._saveCart(cart); }
  },
  clearCart() { this._saveCart([]); },
  getCartCount() { return this.getCart().reduce((s, i) => s + i.qty, 0); },

  async getCartItems() {
    const cart = this.getCart();
    if (!cart.length) return [];
    const ids = [...new Set(cart.map(i => i.productId))];
    let products;
    try {
      products = await apiFetch(`/api/products?ids=${ids.join(',')}`);
    } catch { products = []; }
    const map = Object.fromEntries(products.map(p => [p.id, p]));
    return cart.map(item => {
      const product = map[item.productId];
      return product ? { ...item, product } : null;
    }).filter(Boolean);
  },

  async getCartTotal() {
    const items = await this.getCartItems();
    return items.reduce((s, i) => s + i.product.price * i.qty, 0);
  },

  // ── ORDERS ──────────────────────────────────────────────────────────────────
  async getOrders()          { return apiFetch('/api/orders'); },
  async getOrderStats()      { return apiFetch('/api/orders/stats'); },
  async updateOrderStatus(id, status) {
    return apiFetch(`/api/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
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
