// Escapa contenido de usuario antes de insertarlo con innerHTML (anti-XSS).
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── AUTH GUARD ──
document.addEventListener('DOMContentLoaded', async () => {
  await AUTH.init();
  AUTH.requireAdmin();

  const s = AUTH.getSession();
  if (s) {
    document.getElementById('dashUserName').textContent = s.name;
    document.getElementById('dashUserEmail').textContent = s.email;
  }
  document.getElementById('overviewDate').textContent = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  await Promise.all([DB.getCategories(), DB.getBrands(), DB.getProducts()]);
  await populateCatFilter();
  showPanel('overview', document.querySelector('.dash-nav-item'));
  document.getElementById('expDate').valueAsDate = new Date();
});

// ── PANELS ──
async function showPanel(name, btn) {
  document.querySelectorAll('[id^="panel-"]').forEach(p => p.style.display = 'none');
  document.getElementById(`panel-${name}`).style.display = 'block';
  document.querySelectorAll('.dash-nav-item').forEach(n => n.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (name === 'overview')    await renderOverview();
  else if (name === 'products')   { await loadProductStats(); await loadProductTable(); }
  else if (name === 'categories') await loadCategoryTable();
  else if (name === 'brands')     await loadBrandTable();
  else if (name === 'orders')     { await loadOrderStats(); await loadOrderTable(); }
  else if (name === 'finance')    await loadFinance();
  else if (name === 'expenses')   await loadExpenseTable();
  else if (name === 'reviews')    loadReviewTable();
  else if (name === 'testimonials') loadTestimonialPanel();
  else if (name === 'coupons')    loadCouponTable();
  else if (name === 'users')      loadUserPanel();
  else if (name === 'income')     loadIncomePanel();
  else if (name === 'account')    await ACCOUNT.mount(document.getElementById('acctRoot'));
}

// ── TABS ──
function switchTab(name, btn) {
  document.querySelectorAll('[id^="tab-"]').forEach(t => t.style.display = 'none');
  document.getElementById(`tab-${name}`).style.display = 'block';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── OVERVIEW ──
async function renderOverview() {
  const [stats, expenses, products] = await Promise.all([
    DB.getOrderStats(),
    DB.getExpenseStats(),
    DB.getProducts(),
  ]);
  const net = stats.allRevenue - expenses.total;

  document.getElementById('overviewStats').innerHTML = `
    ${statCard('Ingresos totales',   formatPrice(stats.allRevenue), 'fa-arrow-trend-up',  'green',  `${stats.delivered} pedidos entregados`)}
    ${statCard('Gastos totales',     formatPrice(expenses.total),   'fa-arrow-trend-down', 'red',    `${expenses.count} registros`)}
    ${statCard('Utilidad neta',      formatPrice(net),              'fa-coins',            net >= 0 ? 'green' : 'red', net >= 0 ? 'Positivo' : 'Negativo')}
    ${statCard('Pedidos pendientes', stats.pending,                 'fa-clock',            'amber',  `${stats.total} en total`)}
    ${statCard('Productos activos',  products.filter(p => p.active !== false).length, 'fa-boxes-stacked', 'blue', `${products.length} total`)}`;

  const orders = await DB.getOrders();
  const recent = orders.slice(0, 6);
  const recentEl = document.getElementById('recentOrdersList');
  if (!recent.length) {
    recentEl.innerHTML = '<p style="color:var(--gray-400);font-size:14px;text-align:center;padding:24px 0">No hay pedidos aún.</p>';
  } else {
    recentEl.innerHTML = `<div style="overflow-x:auto"><table class="data-table"><thead><tr><th>ID</th><th>Cliente</th><th>Total</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>
    ${recent.map(o => {
      const st = ORDER_STATUSES[o.status] || {};
      return `<tr>
        <td style="font-weight:700;font-size:12px;color:var(--gray-500)">${o.id}</td>
        <td>${esc(o.userName)}<br><small style="color:var(--gray-400)">${esc(o.userEmail)}</small></td>
        <td style="font-weight:700;color:var(--primary)">${formatPrice(o.total)}</td>
        <td><span class="badge badge-${o.status}"><i class="fa-solid ${st.icon}"></i> ${st.label}</span></td>
        <td style="font-size:12px;color:var(--gray-500)">${formatDate(o.createdAt)}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
  }
  renderOverviewCharts();
}

function statCard(label, value, icon, color, sub = '') {
  return `<div class="stat-card stat-${color}">
    <div class="stat-info">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>
    <div class="stat-icon-wrap"><i class="fa-solid ${icon}"></i></div>
  </div>`;
}

// ── PRODUCTS ──
async function loadProductStats() {
  const [products, cats] = await Promise.all([DB.getProducts(), DB.getCategories()]);
  document.getElementById('productStats').innerHTML = `
    ${statCard('Total productos', products.length, 'fa-boxes-stacked', 'blue')}
    ${statCard('Publicados', products.filter(p => p.active !== false).length, 'fa-circle-check', 'green')}
    ${statCard('Destacados', products.filter(p => p.featured).length, 'fa-star', 'amber')}
    ${statCard('Categorías', Object.keys(cats).length, 'fa-folder-tree', 'purple')}`;
}

async function populateCatFilter() {
  const cats = await DB.getCategories();
  const sel = document.getElementById('tableCat');
  sel.innerHTML = '<option value="">Todas las categorías</option>';
  Object.entries(cats).forEach(([k, v]) => {
    sel.innerHTML += `<option value="${k}">${v.label}</option>`;
  });
  const brands = await DB.getBrands();
  const fBrand = document.getElementById('f-brand');
  if (fBrand) {
    // La marca es obligatoria: es lo que alimenta el filtro de marcas de la
    // tienda, así que ya no ofrecemos "Sin marca" como opción válida.
    fBrand.innerHTML = '<option value="">Seleccionar...</option>';
    Object.entries(brands).forEach(([k, v]) => {
      fBrand.innerHTML += `<option value="${k}">${v.label}</option>`;
    });
  }
}

async function loadProductTable() {
  const q = document.getElementById('tableSearch').value.toLowerCase();
  const cat = document.getElementById('tableCat').value;
  const status = document.getElementById('tableStatus').value;
  const [products, cats] = await Promise.all([DB.getProducts(), DB.getCategories()]);

  let list = products;
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || (p.reference || '').toLowerCase().includes(q));
  if (cat) list = list.filter(p => (p.categories && p.categories.length ? p.categories : [p.category]).includes(cat));
  if (status === 'active')   list = list.filter(p => p.active !== false);
  if (status === 'inactive') list = list.filter(p => p.active === false);

  const tbody = document.getElementById('productsTableBody');
  const empty = document.getElementById('tableEmpty');
  if (!list.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  tbody.innerHTML = list.map(p => {
    const img     = p.images?.[0];
    const prodCats = (p.categories && p.categories.length) ? p.categories : (p.category ? [p.category] : []);
    // La primera categoría se muestra con su ícono; el resto como "+N".
    const primaryCat = cats[prodCats[0]] || {};
    const extraCats  = prodCats.length - 1;
    const isActive = p.active !== false;
    const hasDiscount = p.originalPrice && p.originalPrice > p.price;
    return `<tr>
      <td>${img
        ? `<img src="${img}" class="table-img" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
        : ''}<div class="table-no-img"${img ? ' style="display:none"' : ''}><i class="fa-solid fa-shirt"></i></div>
      </td>
      <td>
        <div style="font-weight:600">${p.name}</div>
        ${p.reference ? `<div style="font-size:11px;color:var(--gray-400)">${p.reference}</div>` : ''}
        ${p.featured ? `<span class="badge" style="background:#fef9c3;color:#854d0e;margin-top:3px"><i class="fa-solid fa-star"></i> Destacado</span>` : ''}
      </td>
      <td>${primaryCat.icon ? `<i class="${primaryCat.icon}" style="color:var(--primary);margin-right:5px"></i>` : ''}${primaryCat.label || prodCats[0] || '–'}${extraCats > 0 ? `<span class="badge" style="background:var(--gray-100);color:var(--gray-600);margin-left:6px" title="${prodCats.slice(1).map(k => cats[k]?.label || k).join(', ')}">+${extraCats}</span>` : ''}</td>
      <td>
        <div style="font-weight:700;color:var(--primary)">${formatPrice(p.price)}</div>
        ${hasDiscount ? `<div style="font-size:11px;color:var(--gray-400);text-decoration:line-through">${formatPrice(p.originalPrice)}</div>` : ''}
      </td>
      <td style="font-weight:600;color:${(p.stock || 0) > 0 ? 'var(--success)' : 'var(--danger)'}">${p.stock ?? '–'}</td>
      <td><span class="badge ${isActive ? 'badge-active' : 'badge-inactive'}">
        <i class="fa-solid ${isActive ? 'fa-circle-check' : 'fa-circle-pause'}"></i>
        ${isActive ? 'Publicado' : 'Oculto'}
      </span></td>
      <td><div class="action-btns">
        <button class="btn-edit" onclick="openProductModal(${p.id})"><i class="fa-solid fa-pen"></i> Editar</button>
        <button class="btn-del" onclick="confirmDeleteProduct(${p.id},'${p.name.replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

// ── PRODUCT MODAL ──
let editingProductId = null;
let currentImages = [];
// Enfoque por imagen: { urlImagen: "x% y%" }. Elige qué parte se ve al recortar.
let currentImageFocus = {};
// Varios videos por producto. Cada uno: { url, position }, donde position es el
// nº de imágenes que van antes del video en la galería (0 = primero, null = al
// final). Se arrastran junto a las imágenes en la misma tira.
let currentVideos = [];
let currentTags = [];
let selectedCats = [];
let selectedSizes = [];
let selectedColors = [];
// Variantes estructuradas del producto: [{ color, option, sizes:[{size,stock}], price }].
// Vacío = el producto no usa variantes (stock/tallas planos).
let currentVariants = [];
// Estado del constructor de variantes (el formulario de arriba en la pestaña).
let vSelColor = '';        // color elegido para la variante en construcción
let vSizeStock = {};       // { talla: cantidad } de la variante en construcción
let vOptions = [''];       // valores de opción (con tirantes, largo…); 1+ inputs
let vEditIndex = null;     // índice que se está editando (null = variante nueva)
// Inventario tal como estaba al abrir el formulario. El servidor aplica solo el
// cambio que hiciste sobre el stock actual, así una venta que entre mientras
// editas no se pierde al guardar.
let loadedStockBase = null;
const MAX_IMAGES = 12;
const MAX_VIDEOS = 6;
// La mayoría de los videos van en segunda posición, así que ahí caen por defecto.
const DEFAULT_VIDEO_POS = 1;

async function openProductModal(id) {
  editingProductId = id || null;
  currentImages = []; currentVideos = []; currentImageFocus = {};
  currentTags = []; selectedCats = []; selectedSizes = []; selectedColors = [];
  currentVariants = []; resetVariantBuilder();
  loadedStockBase = null;

  document.getElementById('productModalTitle').textContent = id ? 'Editar Producto' : 'Nuevo Producto';
  ['f-name','f-reference','f-price','f-original-price','f-wholesale-price','f-stock','f-material','f-desc'].forEach(f => document.getElementById(f).value = '');
  const fBrandEl = document.getElementById('f-brand'); if (fBrandEl) fBrandEl.value = '';
  document.getElementById('f-active').checked = true;
  document.getElementById('f-featured').checked = false;
  document.getElementById('f-isnew').checked = false;

  switchTab('info', document.querySelector('.tab-btn'));
  renderTagsInput(); renderImagePreviews(); renderVideoPreview();
  renderVariantBuilder(); renderVariantList();
  await populateCatFilter();
  renderCatCheckboxes();

  if (id) {
    const p = await DB.getProduct(id);
    if (!p) return;
    loadedStockBase = { stock: p.stock ?? 0, variants: JSON.parse(JSON.stringify(p.variants || [])) };
    document.getElementById('f-name').value          = p.name || '';
    selectedCats = (p.categories && p.categories.length) ? [...p.categories] : (p.category ? [p.category] : []);
    renderCatCheckboxes();
    const fBrandSet = document.getElementById('f-brand'); if (fBrandSet) fBrandSet.value = p.brand || '';
    document.getElementById('f-reference').value     = p.reference || '';
    document.getElementById('f-price').value         = p.price || '';
    document.getElementById('f-original-price').value= p.originalPrice || '';
    document.getElementById('f-wholesale-price').value = p.wholesalePrice || '';
    document.getElementById('f-stock').value         = p.stock ?? '';
    document.getElementById('f-material').value      = p.material || '';
    document.getElementById('f-desc').value          = p.description || '';
    document.getElementById('f-active').checked      = p.active !== false;
    document.getElementById('f-featured').checked    = !!p.featured;
    document.getElementById('f-isnew').checked       = !!p.isNew;
    currentImages  = [...(p.images  || [])];
    currentImageFocus = (p.imageFocus && typeof p.imageFocus === 'object') ? { ...p.imageFocus } : {};
    currentVideos  = (Array.isArray(p.videos) && p.videos.length)
      ? p.videos.map(v => ({ url: v.url, position: v.position == null ? null : Number(v.position) }))
      : (p.video ? [{ url: p.video, position: p.videoPosition ?? null }] : []);
    currentTags    = [...(p.tags    || [])];
    selectedSizes  = [...(p.sizes   || [])];
    selectedColors = [...(p.colors  || [])];
    currentVariants = Array.isArray(p.variants)
      ? p.variants.map(v => ({ color: v.color || '', option: v.option || '', sizes: [...(v.sizes || [])], price: v.price != null ? Number(v.price) : null }))
      : [];
    // selectedSizes / selectedColors se conservan aunque ya no haya UI de "modo
    // simple": así los productos antiguos (con tallas/colores planos y sin
    // variantes) no pierden esos datos al guardarse.
    renderTagsInput(); renderImagePreviews(); renderVideoPreview();
    renderVariantBuilder(); renderVariantList();
  }

  document.getElementById('productModal').classList.remove('hidden');
}

function closeProductModal() { document.getElementById('productModal').classList.add('hidden'); }

async function saveProduct() {
  const name     = document.getElementById('f-name').value.trim();
  const brand    = document.getElementById('f-brand')?.value || '';
  const price    = Number(document.getElementById('f-price').value);

  if (!name)            { showToast('El nombre es obligatorio', 'error');    switchTab('info', document.querySelector('.tab-btn')); return; }
  if (!selectedCats.length){ showToast('Selecciona al menos una categoría', 'error'); switchTab('info', document.querySelector('.tab-btn')); return; }
  // Sin marca el producto no aparece en el filtro de marcas de la tienda.
  if (!brand)           { showToast('Selecciona una marca', 'error');        switchTab('info', document.querySelector('.tab-btn')); return; }
  // El precio ahora vive en la pestaña "Precios e Inventario" (3er tab).
  if (!price || price <= 0){ showToast('Ingresa un precio válido', 'error'); switchTab('variants', document.querySelectorAll('.tab-btn')[2]); return; }

  const data = {
    name, price, brand,
    // La primera categoría elegida es la principal; se envían todas.
    category:   selectedCats[0],
    categories: [...selectedCats],
    reference:     document.getElementById('f-reference').value.trim(),
    originalPrice: Number(document.getElementById('f-original-price').value) || null,
    wholesalePrice: Number(document.getElementById('f-wholesale-price').value) || null,
    stock:         Number(document.getElementById('f-stock').value) || 0,
    material:      document.getElementById('f-material').value.trim(),
    description:   document.getElementById('f-desc').value.trim(),
    active:        document.getElementById('f-active').checked,
    featured:      document.getElementById('f-featured').checked,
    isNew:         document.getElementById('f-isnew').checked,
    images:        [...currentImages],
    imageFocus:    { ...currentImageFocus },
    videos:        currentVideos.map(v => ({ url: v.url, position: v.position })),
    tags:          [...currentTags],
    sizes:         [...selectedSizes],
    colors:        [...selectedColors],
    // Variantes: si hay al menos una, el servidor deriva de ellas las tallas/colores
    // planos; si no, se queda con el modo simple de arriba.
    variants:      currentVariants.map(v => ({ color: v.color, option: v.option, sizes: [...v.sizes], price: v.price })),
    ...(editingProductId && loadedStockBase
      ? { baseStock: loadedStockBase.stock, baseVariants: loadedStockBase.variants } : {}),
  };

  try {
    if (editingProductId) { await DB.updateProduct(editingProductId, data); showToast('Producto actualizado'); }
    else                  { await DB.addProduct(data);                       showToast('Producto creado'); }
    closeProductModal();
    await loadProductTable();
    await loadProductStats();
  } catch (err) {
    showToast(err.message || 'Error al guardar', 'error');
  }
}

// ── SUBIDA DE ARCHIVOS ──
/* En producción (Vercel) el disco es de solo lectura y cada petición se corta en
   4.5 MB, así que el navegador sube DIRECTO a Vercel Blob con un permiso que firma
   /api/upload/blob. En local el servidor guarda en uploads/ como siempre.
   Devuelve [{ url, hasAudio }] en el mismo orden que `files`; lanza Error en español. */
const UPLOAD_RULES = {
  image: { exts: ['.jpg', '.jpeg', '.png', '.webp', '.gif'], maxMB: 5,  label: 'imágenes JPG, PNG, WEBP o GIF' },
  video: { exts: ['.mp4', '.webm', '.mov', '.ogg'],          maxMB: 50, label: 'videos MP4, WEBM, MOV u OGG' },
};
let uploadModePromise = null;

function getUploadMode() {
  if (!uploadModePromise) {
    uploadModePromise = fetch('/api/upload/config', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { blob: false })
      .catch(() => ({ blob: false }));
  }
  return uploadModePromise;
}

async function uploadFiles(files, kind = 'image') {
  const rules = UPLOAD_RULES[kind];
  for (const f of files) {
    const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!rules.exts.includes(ext)) throw new Error(`Solo se permiten ${rules.label}`);
    if (f.size > rules.maxMB * 1024 * 1024) throw new Error(`"${f.name}" pesa más de ${rules.maxMB} MB`);
  }

  const { blob } = await getUploadMode();
  if (blob) {
    const { upload } = await import('/dashboard/vendor/blob-client.mjs');
    const results = [];
    for (const f of files) {
      const safe = f.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
      const res = await upload(`uploads/${safe}`, f, {
        access: 'public',
        handleUploadUrl: '/api/upload/blob',
        clientPayload: kind,
        contentType: f.type || undefined,
      });
      results.push({ url: res.url, hasAudio: kind === 'video' ? await videoTieneAudio(f) : null });
    }
    return results;
  }

  const fd = new FormData();
  files.forEach(f => fd.append(kind === 'video' ? 'video' : 'images', f));
  const res  = await fetch(kind === 'video' ? '/api/upload/video' : '/api/upload',
                           { method: 'POST', credentials: 'include', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error al subir el archivo');
  return kind === 'video'
    ? [{ url: data.url, hasAudio: data.hasAudio }]
    : data.urls.map(url => ({ url, hasAudio: null }));
}

/* ¿El video trae pista de audio? (misma regla que routes/upload.js)
   En MP4/MOV cada pista se declara en una caja "hdlr" cuyo handler_type es
   'soun' para sonido. null = formato que no usa esas cajas (WEBM/OGG). */
async function videoTieneAudio(file) {
  if (!/\.(mp4|mov)$/i.test(file.name)) return null;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const at = (i, s) => s.split('').every((c, k) => buf[i + k] === c.charCodeAt(0));
    for (let i = 0; i < buf.length - 16; i++) {
      if (buf[i] === 0x68 && at(i, 'hdlr') && at(i + 12, 'soun')) return true;
    }
    return false;
  } catch {
    return null;
  }
}

// ── IMAGE HANDLING ──
function addImageUrl() {
  const url = document.getElementById('imgUrlInput').value.trim();
  if (!url) return;
  if (currentImages.length >= MAX_IMAGES) { showToast(`Máximo ${MAX_IMAGES} imágenes por producto`, 'error'); return; }
  currentImages.push(url);
  document.getElementById('imgUrlInput').value = '';
  renderImagePreviews();
}

async function handleFileUpload(input) {
  const remaining = MAX_IMAGES - currentImages.length;
  if (remaining <= 0) { showToast(`Máximo ${MAX_IMAGES} imágenes por producto`, 'error'); input.value = ''; return; }
  let files = Array.from(input.files);
  if (files.length > remaining) {
    showToast(`Solo se agregarán ${remaining}; el máximo es ${MAX_IMAGES} imágenes`, 'error');
    files = files.slice(0, remaining);
  }
  showToast('Subiendo imágenes...');
  try {
    const subidas = await uploadFiles(files, 'image');
    subidas.forEach(s => currentImages.push(s.url));
    renderImagePreviews();
    showToast('Imágenes agregadas');
  } catch (err) {
    showToast(err.message || 'Error al subir imagen', 'error');
  }
  input.value = '';
}

function removeImage(i) {
  const removedUrl = currentImages[i];
  currentImages.splice(i, 1);
  if (removedUrl) delete currentImageFocus[removedUrl];   // su enfoque ya no aplica
  // Los videos que iban después de esa imagen pierden un hueco por delante;
  // luego se recorta cualquier posición que se salga de la galería.
  currentVideos.forEach(v => {
    if (v.position != null && v.position > i) v.position -= 1;
    if (v.position != null) v.position = Math.min(v.position, currentImages.length);
  });
  renderImagePreviews();
}

// ── EDITOR DE ENFOQUE (qué parte de la imagen se ve al recortar) ──────────────
// Solo el admin lo usa. Haces clic/arrastras sobre la foto para elegir el punto
// que debe quedar centrado; se guarda como object-position ("x% y%") y se aplica
// en la tienda donde la foto se recorta (destacados, nuevos ingresos, miniaturas).
function openFocusEditor(index) {
  const url = currentImages[index];
  if (!url) return;
  if (document.querySelector('.focus-editor')) return;

  let x = 50, y = 50;
  const cur = currentImageFocus[url];
  if (typeof cur === 'string') { const m = cur.match(/^(\d{1,3})% (\d{1,3})%$/); if (m) { x = +m[1]; y = +m[2]; } }

  const overlay = document.createElement('div');
  overlay.className = 'focus-editor';
  overlay.innerHTML = `
    <div class="fe-card" role="dialog" aria-modal="true" aria-label="Enfoque de la imagen">
      <div class="fe-head">
        <h3><i class="fa-solid fa-crop-simple"></i> Enfoque de la imagen</h3>
        <button class="fe-x fe-cancel" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <p class="fe-hint">Toca o arrastra sobre la foto para elegir qué parte queda a la vista cuando se recorta. Apunta a la <b>prenda</b> (no a la cara): la mayoría de las clientas entran desde el celular, donde la foto se recorta en cuadrado.</p>
      <div class="fe-body">
        <div class="fe-pick">
          <div class="fe-imgwrap">
            <img class="fe-img" src="${esc(url)}" draggable="false" alt="">
            <span class="fe-dot"></span>
          </div>
        </div>
        <div class="fe-previews">
          <div class="fe-prev-group">
            <span class="fe-prev-label">Nuevos ingresos / miniaturas</span>
            <div class="fe-prev fe-prev-tall"><img src="${esc(url)}" alt=""></div>
          </div>
          <div class="fe-prev-group">
            <span class="fe-prev-label">Destacado (celular y escritorio)</span>
            <div class="fe-prev fe-prev-wide"><img src="${esc(url)}" alt=""></div>
          </div>
          <div class="fe-coord">Enfoque: <b class="fe-val"></b></div>
        </div>
      </div>
      <div class="fe-foot">
        <button class="fe-btn fe-reset"><i class="fa-solid fa-arrows-to-dot"></i> Restablecer</button>
        <span class="fe-spacer"></span>
        <button class="fe-btn fe-cancel">Cancelar</button>
        <button class="fe-btn fe-save primary"><i class="fa-solid fa-check"></i> Guardar enfoque</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => overlay.classList.add('open'));

  const imgwrap = overlay.querySelector('.fe-imgwrap');
  const pickImg = overlay.querySelector('.fe-img');
  const dot     = overlay.querySelector('.fe-dot');
  const val     = overlay.querySelector('.fe-val');
  const prevs   = [...overlay.querySelectorAll('.fe-prev img')];

  function apply() {
    const pos = `${x}% ${y}%`;
    dot.style.left = x + '%';
    dot.style.top  = y + '%';
    prevs.forEach(p => { p.style.objectPosition = pos; });
    val.textContent = pos;
  }
  function setFromEvent(e) {
    const r = pickImg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    x = Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width)  * 100)));
    y = Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top)  / r.height) * 100)));
    apply();
  }
  let dragging = false;
  imgwrap.addEventListener('pointerdown', e => { dragging = true; imgwrap.setPointerCapture(e.pointerId); setFromEvent(e); });
  imgwrap.addEventListener('pointermove', e => { if (dragging) setFromEvent(e); });
  imgwrap.addEventListener('pointerup',   () => { dragging = false; });

  const close = () => {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 200);
  };
  const onKey = ev => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('.fe-cancel').forEach(b => b.addEventListener('click', close));
  overlay.querySelector('.fe-reset').addEventListener('click', () => {
    delete currentImageFocus[url];           // vuelve al enfoque por defecto del sitio
    renderImagePreviews();
    close();
  });
  overlay.querySelector('.fe-save').addEventListener('click', () => {
    currentImageFocus[url] = `${x}% ${y}%`;
    renderImagePreviews();
    close();
  });

  // La imagen puede tardar en cargar; recalculamos al terminar por si acaso.
  if (pickImg.complete) apply(); else pickImg.addEventListener('load', apply, { once: true });
  apply();
}

// Construye la tira (= galería tal como la verá la clienta): imágenes con los
// videos intercalados en su hueco. Devuelve descriptores en orden de aparición.
// Un video con position null (o fuera de rango) cae al final.
function buildStrip() {
  const n = currentImages.length;
  const strip = [];
  for (let s = 0; s <= n; s++) {
    currentVideos.forEach((v, vi) => {
      const pos = v.position == null ? n : Math.max(0, Math.min(v.position, n));
      if (pos === s) strip.push({ kind: 'video', vi });
    });
    if (s < n) strip.push({ kind: 'img', i: s });
  }
  return strip;
}

// Todo se arrastra, incluidos los videos. data-i / data-vi guardan el índice
// ORIGINAL de cada imagen/video: al soltar reconstruimos el orden leyendo el
// DOM (ver commitImageOrder).
function renderImagePreviews() {
  const c = document.getElementById('imgPreview');
  const counter = document.getElementById('imgCount');
  if (counter) counter.textContent = `(${currentImages.length}/${MAX_IMAGES})`;

  if (!currentImages.length && !currentVideos.length) {
    c.innerHTML = '<span style="color:var(--gray-400);font-size:13px">Sin imágenes.</span>';
    return;
  }

  c.innerHTML = buildStrip().map(item => {
    if (item.kind === 'img') {
      const src = currentImages[item.i];
      const focus = currentImageFocus[src];
      const focusStyle = (typeof focus === 'string' && /^\d{1,3}% \d{1,3}%$/.test(focus)) ? ` style="object-position:${focus}"` : '';
      const hasFocus = !!focusStyle;
      return `
    <div class="img-preview-item" data-kind="img" data-i="${item.i}" title="Arrastra para cambiar el orden">
      <img src="${src}" alt="" draggable="false"${focusStyle}>
      <div class="img-label">Principal</div>
      <button class="img-focus${hasFocus ? ' is-set' : ''}" title="Elegir qué parte se ve (enfoque)" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation();openFocusEditor(${item.i})"><i class="fa-solid fa-crop-simple"></i></button>
      <button class="img-remove" onpointerdown="event.stopPropagation()" onclick="removeImage(${item.i})"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
    }
    const v = currentVideos[item.vi];
    return `
    <div class="img-preview-item is-video" data-kind="video" data-vi="${item.vi}" title="Arrastra el video a donde quieras">
      <video src="${v.url}#t=0.1" muted playsinline preload="metadata"></video>
      <span class="video-play"><i class="fa-solid fa-circle-play"></i></span>
      <div class="img-label">Principal</div>
      <button class="img-remove" onclick="removeVideo(${item.vi})"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }).join('');
}

/* ── REORDENAR IMÁGENES ARRASTRÁNDOLAS ────────────────────────────────────────
   Con Pointer Events (no con el drag&drop nativo de HTML5) para que funcione
   igual con el ratón que con el dedo: el nativo no dispara nada en móvil.

   Se arrastra un CLON flotante ("fantasma") que sigue al cursor en coordenadas
   de pantalla, mientras la miniatura real se queda en el flujo como hueco y va
   saltando de posición. Es importante que el fantasma sea independiente: si en
   vez de eso movemos la propia miniatura con un transform, cada reinserción
   obliga a reajustar su punto de origen y el arrastre se rompe (la última no
   llegaba nunca a la primera posición).

   La primera imagen es la principal, así que traer una al frente es lo que la
   convierte en portada.                                                        */
let imgDrag = null;

function initImageSort() {
  const c = document.getElementById('imgPreview');
  if (!c) return;
  // Delegado en el contenedor: sobrevive a los renderImagePreviews().
  c.addEventListener('pointerdown', e => {
    const item = e.target.closest('.img-preview-item');
    if (!item || e.target.closest('.img-remove')) return; // la X sigue siendo un botón
    if (e.button > 0) return;                             // solo el botón izquierdo
    // Con un solo elemento en la tira no hay nada que reordenar. Cuenta el
    // video, que también se arrastra: 1 imagen + 1 video ya son reordenables.
    if (c.querySelectorAll('.img-preview-item').length < 2) return;

    e.preventDefault(); // evita la selección de texto y el arrastre nativo del navegador
    imgDrag = {
      item, container: c, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      ghost: null, moved: false,
    };

    // Los listeners van en DOCUMENT, no en la miniatura. Y sin setPointerCapture:
    // insertBefore() saca el nodo del documento y lo vuelve a meter, y sacarlo
    // LIBERA su captura de puntero. Si escucháramos en la miniatura, en cuanto
    // cambiara de hueco dejaría de recibir pointermove/pointerup y el arrastre
    // moriría a medias (era justo lo que impedía llevar la última al frente).
    document.addEventListener('pointermove',   onImageDragMove);
    document.addEventListener('pointerup',     endImageDrag);
    document.addEventListener('pointercancel', endImageDrag);
  });
}

// Despega la miniatura: crea el fantasma sobre ella y deja el hueco marcado.
function liftImage(d) {
  const r = d.item.getBoundingClientRect();
  const ghost = d.item.cloneNode(true);
  ghost.classList.add('img-ghost');
  ghost.removeAttribute('data-i');
  ghost.style.left   = `${r.left}px`;
  ghost.style.top    = `${r.top}px`;
  ghost.style.width  = `${r.width}px`;
  ghost.style.height = `${r.height}px`;
  document.body.appendChild(ghost);

  d.ghost = ghost;
  d.item.classList.add('is-placeholder');
}

function onImageDragMove(e) {
  if (!imgDrag || e.pointerId !== imgDrag.pointerId) return;
  const dx = e.clientX - imgDrag.startX;
  const dy = e.clientY - imgDrag.startY;

  // Umbral: un clic con el pulso tembloroso no debe contar como arrastre.
  if (!imgDrag.moved) {
    if (Math.hypot(dx, dy) < 6) return;
    imgDrag.moved = true;
    liftImage(imgDrag);
  }

  // El fantasma sigue al cursor. Nada que reanclar: siempre desde el mismo origen.
  imgDrag.ghost.style.transform = `translate(${dx}px, ${dy}px)`;

  // El fantasma lleva pointer-events:none, así que esto devuelve la miniatura
  // que hay debajo del cursor, no el propio fantasma.
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const over  = under && under.closest ? under.closest('.img-preview-item') : null;
  if (!over || over === imgDrag.item || over.parentElement !== imgDrag.container) return;

  // ¿El hueco va antes o después? Según de qué lado del centro voy pasando.
  const r = over.getBoundingClientRect();
  const after = e.clientX > r.left + r.width / 2;
  imgDrag.container.insertBefore(imgDrag.item, after ? over.nextSibling : over);
}

function endImageDrag(e) {
  if (!imgDrag || e.pointerId !== imgDrag.pointerId) return;
  const { item, ghost, container, moved } = imgDrag;

  document.removeEventListener('pointermove',   onImageDragMove);
  document.removeEventListener('pointerup',     endImageDrag);
  document.removeEventListener('pointercancel', endImageDrag);
  if (ghost) ghost.remove();
  item.classList.remove('is-placeholder');
  imgDrag = null;

  if (!moved) return; // fue un clic, no un arrastre: no toques nada
  commitImageOrder(container);
}

// El DOM ya quedó en el orden nuevo; de ahí sacamos el orden de las imágenes y,
// para cada video, su nueva posición (= nº de imágenes que quedaron antes de él).
function commitImageOrder(container) {
  const nodos = [...container.querySelectorAll('.img-preview-item')];

  const newImages = nodos
    .filter(el => el.dataset.kind === 'img')
    .map(el => currentImages[Number(el.dataset.i)]);

  const newVideos = [];
  let imgsBefore = 0;
  for (const el of nodos) {
    if (el.dataset.kind === 'img') { imgsBefore++; continue; }
    const v = currentVideos[Number(el.dataset.vi)];
    if (v) newVideos.push({ url: v.url, position: imgsBefore });
  }

  currentImages = newImages;
  currentVideos = newVideos;

  renderImagePreviews(); // re-numera los data-i/data-vi y mueve la etiqueta "Principal"
}

// ── VIDEO HANDLING ──
// Un video recién puesto aterriza en segunda posición (lo habitual). Si el
// producto tiene menos imágenes que eso, cae al final. Luego se arrastra.
function addVideo(url) {
  if (!url) return false;
  if (currentVideos.length >= MAX_VIDEOS) {
    showToast(`Máximo ${MAX_VIDEOS} videos por producto`, 'error');
    return false;
  }
  currentVideos.push({ url, position: Math.min(DEFAULT_VIDEO_POS, currentImages.length) });
  renderImagePreviews();
  renderVideoPreview();
  return true;
}

function addVideoUrl() {
  const input = document.getElementById('videoUrlInput');
  const url = input.value.trim();
  if (!url) return;
  if (addVideo(url)) input.value = '';
}

async function handleVideoUpload(input) {
  if (!input.files?.length) return;
  if (currentVideos.length >= MAX_VIDEOS) {
    showToast(`Máximo ${MAX_VIDEOS} videos por producto`, 'error');
    input.value = '';
    return;
  }
  showToast('Subiendo video...');
  try {
    const [data] = await uploadFiles([input.files[0]], 'video');
    addVideo(data.url);
    // El servidor mira si el archivo trae pista de audio. Si viene mudo de
    // origen no hay reproductor que lo arregle, así que avisamos ahora.
    if (data.hasAudio === false) {
      showToast('Ojo: este video NO tiene pista de audio. Se verá pero no se oirá.', 'error');
    } else {
      showToast('Video agregado');
    }
  } catch (err) {
    showToast(err.message || 'Error al subir el video', 'error');
  }
  input.value = '';
}

function removeVideo(vi) {
  currentVideos.splice(vi, 1);
  renderImagePreviews();
  renderVideoPreview();
}

function renderVideoPreview() {
  const c = document.getElementById('videoPreview');
  if (!c) return;
  const counter = document.getElementById('vidCount');
  if (counter) counter.textContent = `(${currentVideos.length}/${MAX_VIDEOS})`;
  if (!currentVideos.length) { c.innerHTML = '<span style="color:var(--gray-400);font-size:13px">Sin videos.</span>'; return; }
  c.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:12px">' + currentVideos.map((v, vi) => `
    <div class="img-preview-item" style="width:220px;max-width:100%;position:relative">
      <video src="${v.url}" controls style="width:100%;border-radius:8px;display:block"></video>
      <button class="img-remove" onclick="removeVideo(${vi})"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('') + '</div>';
}

// ── TAGS ──
function renderTagsInput() {
  const container = document.getElementById('tagsInput');
  const input = document.getElementById('tagField');
  container.querySelectorAll('.tag-pill').forEach(t => t.remove());
  currentTags.forEach((tag, i) => {
    const pill = document.createElement('div');
    pill.className = 'tag-pill';
    pill.innerHTML = `${tag} <button onclick="removeTag(${i})"><i class="fa-solid fa-xmark"></i></button>`;
    container.insertBefore(pill, input);
  });
}
function removeTag(i) { currentTags.splice(i, 1); renderTagsInput(); }

document.addEventListener('DOMContentLoaded', () => {
  initImageSort();

  const tagField = document.getElementById('tagField');
  if (tagField) {
    tagField.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = tagField.value.trim().replace(/,$/, '');
        if (val && !currentTags.includes(val)) { currentTags.push(val); renderTagsInput(); }
        tagField.value = '';
      }
    });
  }
  const customSize = document.getElementById('customSizeInput');
  if (customSize) {
    customSize.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = customSize.value.trim().toUpperCase();
        if (val && !selectedSizes.includes(val)) { selectedSizes.push(val); renderSizeCheckboxes(); }
        customSize.value = '';
      }
    });
  }
  // Talla personalizada del constructor de variantes.
  const vSize = document.getElementById('vSizeCustom');
  if (vSize) {
    vSize.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = vSize.value.trim().toUpperCase();
        if (val && !Object.prototype.hasOwnProperty.call(vSizeStock, val)) { vSizeStock[val] = 1; renderVSizeGrid(); }
        vSize.value = '';
      }
    });
  }
});

// ── CATEGORÍAS (multi-selección) ──
// Un producto puede tener varias categorías; la primera elegida es la principal.
function renderCatCheckboxes() {
  const c = document.getElementById('catCheckboxes');
  if (!c) return;
  const cats = DB.getCats();
  const entries = Object.entries(cats);
  if (!entries.length) { c.innerHTML = '<span style="font-size:12px;color:var(--gray-400)">Crea categorías primero en la pestaña Categorías.</span>'; return; }
  c.innerHTML = entries.map(([key, cat]) => {
    const on = selectedCats.includes(key);
    return `<button type="button" class="size-btn${on ? ' active' : ''}" data-cat="${key}" onclick="toggleCat('${key}', this)">
      ${cat.icon ? `<i class="${cat.icon}" style="margin-right:5px"></i>` : ''}${cat.label}</button>`;
  }).join('');
}
function toggleCat(key, btn) {
  const i = selectedCats.indexOf(key);
  if (i === -1) selectedCats.push(key); else selectedCats.splice(i, 1);
  btn.classList.toggle('active');
}

// ── SIZES ──
function renderSizeCheckboxes() {
  const c = document.getElementById('sizeCheckboxes');
  if (!c) return;
  c.innerHTML = STANDARD_SIZES.map(s => `
    <button class="size-btn${selectedSizes.includes(s) ? ' active' : ''}" onclick="toggleSize('${s}', this)">${s}</button>`).join('');
}
function toggleSize(size, btn) {
  const i = selectedSizes.indexOf(size);
  if (i === -1) selectedSizes.push(size); else selectedSizes.splice(i, 1);
  btn.classList.toggle('active');
}

// ── COLORS ──
function renderColorSwatches() {
  const c = document.getElementById('colorSwatches');
  if (!c) return;
  c.innerHTML = Object.entries(COLOR_MAP).map(([name, hex]) => `
    <button title="${name}" onclick="toggleColor('${name}')" style="width:30px;height:30px;border-radius:50%;background:${hex};cursor:pointer;outline:2.5px solid ${selectedColors.includes(name) ? 'var(--primary)' : 'transparent'};outline-offset:2px;border:3px solid white;transition:outline .2s"></button>`).join('');
}
function toggleColor(color) {
  const i = selectedColors.indexOf(color);
  if (i === -1) selectedColors.push(color); else selectedColors.splice(i, 1);
  renderColorSwatches(); renderSelectedColors();
}
function addCustomColor() {
  const input = document.getElementById('customColorInput');
  const val = input.value.trim();
  if (val && !selectedColors.includes(val)) { selectedColors.push(val); renderSelectedColors(); }
  input.value = '';
}
function renderSelectedColors() {
  const c = document.getElementById('selectedColorsChips');
  if (!c) return;
  if (!selectedColors.length) { c.innerHTML = '<span style="font-size:12px;color:var(--gray-400)">Sin colores seleccionados</span>'; return; }
  c.innerHTML = selectedColors.map((col, i) => `
    <div class="color-chip">
      <div class="color-chip-dot" style="background:${COLOR_MAP[col] || '#999'}"></div>
      ${col}
      <button onclick="removeColor(${i})"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
}
function removeColor(i) { selectedColors.splice(i, 1); renderColorSwatches(); renderSelectedColors(); }

// ── VARIANTES E INVENTARIO (color → tallas con stock + opciones + precio) ─────
// Constructor: color, opciones (varias), precio propio y qué tallas hay con cuántas
// piezas de cada una. "Agregar" la mete a la lista; editar la recarga al formulario.

function renderVariantBuilder() {
  // Colores: los estándar + cualquiera ya usado en variantes.
  const usados = [...new Set(currentVariants.map(v => v.color).filter(Boolean))];
  const paleta = [...Object.keys(COLOR_MAP), ...usados.filter(c => !(c in COLOR_MAP))];
  const sw = document.getElementById('vColorSwatches');
  if (sw) {
    sw.innerHTML = paleta.map(name => {
      const on = vSelColor === name;
      return `<button type="button" title="${esc(name)}" onclick="vPickColor('${esc(name).replace(/'/g,"\\'")}')" style="width:30px;height:30px;border-radius:50%;background:${COLOR_MAP[name] || '#999'};cursor:pointer;outline:2.5px solid ${on ? 'var(--primary)' : 'transparent'};outline-offset:2px;border:3px solid white;transition:outline .2s"></button>`;
    }).join('');
  }
  const chosen = document.getElementById('vColorChosen');
  if (chosen) chosen.innerHTML = vSelColor
    ? `Color: <b>${esc(vSelColor)}</b>`
    : '<span style="color:var(--gray-400)">Sin color (variante solo de talla u opción)</span>';
  renderVOptions();
  renderVSizeGrid();
}

// Inputs de opciones (varias). Cada uno actualiza vOptions en vivo; el botón − lo quita.
function renderVOptions() {
  const box = document.getElementById('vOptionList');
  if (!box) return;
  if (!vOptions.length) vOptions = [''];
  box.innerHTML = vOptions.map((val, i) => `
    <div class="vb-opt-row">
      <input type="text" class="form-input" placeholder="Ej. Con tirantes / Largo" value="${esc(val)}" oninput="vOptions[${i}]=this.value">
      ${vOptions.length > 1 ? `<button type="button" class="vb-opt-del" title="Quitar opción" onclick="vRemoveOptionField(${i})"><i class="fa-solid fa-xmark"></i></button>` : ''}
    </div>`).join('');
}
function vAddOptionField() { vSyncOptions(); vOptions.push(''); renderVOptions(); }
function vRemoveOptionField(i) { vSyncOptions(); vOptions.splice(i, 1); if (!vOptions.length) vOptions = ['']; renderVOptions(); }
// Lee los valores actuales de los inputs al DOM → vOptions (por si se re-renderiza).
function vSyncOptions() {
  const inputs = document.querySelectorAll('#vOptionList .vb-opt-row input');
  if (inputs.length) vOptions = [...inputs].map(inp => inp.value);
}

// Rejilla de tallas con su inventario. Marcar una talla la pone "on" con 1 pz por
// defecto; el número ajusta el stock (0 = agotada pero se sigue ofreciendo/mostrando).
function renderVSizeGrid() {
  const grid = document.getElementById('vSizeGrid');
  if (!grid) return;
  const extra = Object.keys(vSizeStock).filter(s => !STANDARD_SIZES.includes(s));
  const all = [...STANDARD_SIZES, ...extra];
  grid.innerHTML = all.map(s => {
    const on = Object.prototype.hasOwnProperty.call(vSizeStock, s);
    const qty = on ? vSizeStock[s] : '';
    const sc = esc(s).replace(/'/g, "\\'");
    return `<div class="vsize-cell ${on ? 'on' : ''}">
      <button type="button" class="vsz-toggle" onclick="vToggleSize('${sc}')">${esc(s)}</button>
      <input type="number" class="vsz-qty" min="0" value="${qty}" ${on ? '' : 'disabled'} onclick="event.stopPropagation()" oninput="vSetSizeStock('${sc}', this.value)">
      <span class="vsz-unit">pz</span>
    </div>`;
  }).join('');
}

function vPickColor(name) {
  vSelColor = (vSelColor === name) ? '' : name;
  renderVariantBuilder();
}
function vAddCustomColor() {
  const input = document.getElementById('vColorCustom');
  const val = (input.value || '').trim();
  if (val) { vSelColor = val; input.value = ''; renderVariantBuilder(); }
}
function vToggleSize(size) {
  if (Object.prototype.hasOwnProperty.call(vSizeStock, size)) delete vSizeStock[size];
  else vSizeStock[size] = 1;
  renderVSizeGrid();
}
function vSetSizeStock(size, val) {
  if (!Object.prototype.hasOwnProperty.call(vSizeStock, size)) return;
  vSizeStock[size] = Math.max(0, Math.floor(Number(val) || 0));
}

function addVariant() {
  vSyncOptions();
  const color  = vSelColor.trim();
  const option = vOptions.map(o => (o || '').trim()).filter(Boolean).join(' · ');
  const priceRaw = document.getElementById('vPrice').value;
  const price  = priceRaw !== '' && Number(priceRaw) > 0 ? Number(priceRaw) : null;
  const sizes  = Object.keys(vSizeStock).map(size => ({ size, stock: Math.max(0, Math.floor(Number(vSizeStock[size]) || 0)) }));
  if (!color && !option && !sizes.length) {
    showToast('La variante necesita al menos un color, una opción o tallas', 'error');
    return;
  }
  // Evitar duplicar la misma combinación color+opción (salvo que se esté editando esa).
  const dupe = currentVariants.findIndex(v => (v.color||'') === color && (v.option||'') === option);
  if (dupe !== -1 && dupe !== vEditIndex) {
    showToast('Ya existe una variante con ese color y opciones', 'error');
    return;
  }
  const variant = { color, option, sizes, price };
  if (vEditIndex != null) currentVariants[vEditIndex] = variant;
  else                    currentVariants.push(variant);
  resetVariantBuilder();
  renderVariantList();
}

function editVariant(i) {
  const v = currentVariants[i]; if (!v) return;
  vEditIndex = i;
  vSelColor = v.color || '';
  vOptions = v.option ? String(v.option).split(' · ') : [''];
  vSizeStock = {};
  (v.sizes || []).forEach(s => {
    const name = (s && typeof s === 'object') ? s.size : s;
    const stock = (s && typeof s === 'object' && s.stock != null) ? s.stock : 0;
    if (name) vSizeStock[name] = stock;
  });
  document.getElementById('vPrice').value  = v.price != null ? v.price : '';
  document.getElementById('vbTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Editar variante';
  document.getElementById('vAddBtn').innerHTML = '<i class="fa-solid fa-check"></i> Guardar cambios';
  document.getElementById('vCancelBtn').style.display = '';
  renderVariantBuilder();
  document.getElementById('variantBuilder').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Pide confirmación antes de quitar la variante (reutiliza el modal de confirmación
// del dashboard, que se pinta encima del modal de producto por estar después en el DOM).
function confirmRemoveVariant(i) {
  const v = currentVariants[i]; if (!v) return;
  const label = [v.color || 'Sin color', v.option].filter(Boolean).join(' · ');
  document.getElementById('confirmMsg').textContent = `¿Eliminar la variante "${label}"? Esta acción no elimina el producto, solo esta variante.`;
  document.getElementById('confirmModal').classList.remove('hidden');
  document.getElementById('confirmDeleteBtn').onclick = () => { removeVariant(i); closeConfirm(); };
}

function removeVariant(i) {
  currentVariants.splice(i, 1);
  if (vEditIndex === i) resetVariantBuilder();
  else if (vEditIndex != null && i < vEditIndex) vEditIndex -= 1;
  renderVariantList();
}

function resetVariantBuilder() {
  vSelColor = ''; vSizeStock = {}; vOptions = ['']; vEditIndex = null;
  const pr = document.getElementById('vPrice');    if (pr) pr.value = '';
  const t  = document.getElementById('vbTitle');   if (t)  t.innerHTML = '<i class="fa-solid fa-plus-circle"></i> Nueva variante';
  const ab = document.getElementById('vAddBtn');   if (ab) ab.innerHTML = '<i class="fa-solid fa-plus"></i> Agregar variante';
  const cb = document.getElementById('vCancelBtn');if (cb) cb.style.display = 'none';
  renderVariantBuilder();
}

// Total de piezas de una variante (suma del inventario por talla).
function variantTotalStock(v) {
  return (v.sizes || []).reduce((n, s) => n + ((s && typeof s === 'object' && s.stock != null) ? s.stock : 0), 0);
}

function renderVariantList() {
  const box = document.getElementById('variantList');
  if (box) {
    if (!currentVariants.length) {
      box.innerHTML = '<div class="variant-empty"><i class="fa-solid fa-circle-info"></i> Aún no hay variantes. El producto usará el stock general de abajo.</div>';
    } else {
      box.innerHTML = currentVariants.map((v, i) => {
        const dot   = `<span class="vc-dot" style="background:${COLOR_MAP[v.color] || (v.color ? '#999' : '#e5e7eb')}"></span>`;
        const name  = esc(v.color || 'Sin color');
        const opt   = v.option ? `<span class="vc-opt">${esc(v.option)}</span>` : '';
        const price = (v.price != null) ? `<span class="vc-price">${formatPrice(v.price)}</span>` : '';
        const total = variantTotalStock(v);
        const sizes = (v.sizes && v.sizes.length)
          ? `<div class="vc-sizes">${v.sizes.map(s => {
              const nm = (s && typeof s === 'object') ? s.size : s;
              const st = (s && typeof s === 'object') ? s.stock : null;
              const zero = st === 0;
              return `<span${zero ? ' style="opacity:.5;text-decoration:line-through"' : ''}>${esc(nm)}${st != null ? ` ×${st}` : ''}</span>`;
            }).join('')} <span style="background:none;border:none;color:var(--gray-400);font-weight:600">= ${total} pz</span></div>`
          : '<div class="vc-sizes" style="color:var(--gray-400)">Sin tallas</div>';
        return `<div class="variant-card">
          ${dot}
          <div class="vc-body">
            <div class="vc-name">${name} ${opt} ${price}</div>
            ${sizes}
          </div>
          <div class="vc-actions">
            <button type="button" class="vc-btn" title="Editar" onclick="editVariant(${i})"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="vc-btn del" title="Quitar" onclick="confirmRemoveVariant(${i})"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>`;
      }).join('');
    }
  }
  refreshStockUI();
}

// Muestra el campo de stock general (sin variantes) o el total calculado (con
// variantes), según corresponda.
function refreshStockUI() {
  const plain = document.getElementById('plainStockBox');
  const info  = document.getElementById('variantStockInfo');
  const hasVariants = currentVariants.length > 0;
  if (plain) plain.style.display = hasVariants ? 'none' : 'block';
  if (info) {
    if (hasVariants) {
      const total = currentVariants.reduce((n, v) => n + variantTotalStock(v), 0);
      info.style.display = 'flex';
      info.innerHTML = `<i class="fa-solid fa-warehouse"></i> Stock total del producto: ${total} pz <span style="font-weight:400;color:#38614a">(suma del inventario de todas las variantes)</span>`;
    } else {
      info.style.display = 'none';
    }
  }
}

// ── CATEGORIES ──
let editingCatKey = null;

async function loadCategoryTable() {
  const [cats, products] = await Promise.all([DB.getCategories(), DB.getProducts()]);
  const tbody = document.getElementById('catTableBody');
  tbody.innerHTML = Object.entries(cats).map(([key, cat]) => {
    const count    = products.filter(p => (p.categories && p.categories.length ? p.categories : [p.category]).includes(key)).length;
    const isActive = cat.active !== false;
    return `<tr>
      <td><div style="width:36px;height:36px;background:var(--primary-bg);border-radius:8px;display:flex;align-items:center;justify-content:center">
        <i class="${cat.icon || 'fa-solid fa-tag'}" style="color:var(--primary);font-size:16px"></i></div></td>
      <td style="font-weight:600">${cat.label}</td>
      <td style="font-size:12px;color:var(--gray-400);font-family:monospace">${key}</td>
      <td>${count} producto${count !== 1 ? 's' : ''}</td>
      <td><span class="badge ${isActive ? 'badge-active' : 'badge-inactive'}">${isActive ? 'Activa' : 'Inactiva'}</span></td>
      <td><div class="action-btns">
        <button class="btn-edit" onclick="openCategoryModal('${key}')"><i class="fa-solid fa-pen"></i> Editar</button>
        <button class="btn-del" onclick="confirmDeleteCategory('${key}','${cat.label.replace(/'/g, "\\'")}',${count})"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

async function openCategoryModal(key) {
  editingCatKey = key || null;
  document.getElementById('catModalTitle').textContent = key ? 'Editar Categoría' : 'Nueva Categoría';
  if (key) {
    const cats = await DB.getCategories();
    const cat  = cats[key];
    document.getElementById('catName').value   = cat?.label || '';
    document.getElementById('catIcon').value   = cat?.icon  || '';
    document.getElementById('catActive').checked = cat?.active !== false;
  } else {
    document.getElementById('catName').value   = '';
    document.getElementById('catIcon').value   = 'fa-solid fa-tag';
    document.getElementById('catActive').checked = true;
  }
  document.getElementById('categoryModal').classList.remove('hidden');
}

function closeCategoryModal() { document.getElementById('categoryModal').classList.add('hidden'); }

async function saveCategory() {
  const label  = document.getElementById('catName').value.trim();
  const icon   = document.getElementById('catIcon').value.trim() || 'fa-solid fa-tag';
  const active = document.getElementById('catActive').checked;
  if (!label) { showToast('El nombre es obligatorio', 'error'); return; }

  try {
    if (editingCatKey) {
      await DB.updateCategory(editingCatKey, { label, icon, active });
      showToast('Categoría actualizada');
    } else {
      await DB.addCategory({ label, icon, active });
      showToast('Categoría creada');
    }
    closeCategoryModal();
    await loadCategoryTable();
    await populateCatFilter();
  } catch (err) {
    showToast(err.message || 'Error al guardar categoría', 'error');
  }
}

async function confirmDeleteCategory(key, name, count = 0) {
  document.getElementById('confirmMsg').textContent = count > 0
    ? `¿Eliminar "${name}"? Se quitará de ${count} producto${count !== 1 ? 's' : ''} que la tiene${count !== 1 ? 'n' : ''} (los productos NO se borran).`
    : `¿Eliminar "${name}"?`;
  document.getElementById('confirmModal').classList.remove('hidden');
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    try {
      const res = await DB.deleteCategory(key);
      closeConfirm();
      const n = res && typeof res.affected === 'number' ? res.affected : 0;
      showToast(n > 0
        ? `Categoría eliminada y retirada de ${n} producto${n !== 1 ? 's' : ''}`
        : 'Categoría eliminada');
      await loadCategoryTable();
      await populateCatFilter();
    } catch (err) {
      showToast(err.message || 'Error al eliminar', 'error');
      closeConfirm();
    }
  };
}

// ── BRANDS / MARCAS ──
let editingBrandKey = null;

async function loadBrandTable() {
  const [brands, products] = await Promise.all([DB.getBrands(), DB.getProducts()]);
  const tbody = document.getElementById('brandTableBody');
  const entries = Object.entries(brands);
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:24px">Aún no hay marcas. Crea la primera.</td></tr>';
    return;
  }
  tbody.innerHTML = entries.map(([key, brand]) => {
    const count    = products.filter(p => p.brand === key).length;
    const isActive = brand.active !== false;
    const logoCell = brand.logo
      ? `<img src="${brand.logo}" alt="${brand.label}" style="width:46px;height:36px;object-fit:contain;background:#fff;border-radius:6px;border:1px solid var(--gray-200)">`
      : `<div style="width:36px;height:36px;background:var(--primary-bg);border-radius:8px;display:flex;align-items:center;justify-content:center">
           <i class="${brand.icon || 'fa-solid fa-certificate'}" style="color:var(--primary);font-size:16px"></i></div>`;
    return `<tr>
      <td>${logoCell}</td>
      <td style="font-weight:600">${brand.label}</td>
      <td style="font-size:12px;color:var(--gray-400);font-family:monospace">${key}</td>
      <td>${count} producto${count !== 1 ? 's' : ''}</td>
      <td><span class="badge ${isActive ? 'badge-active' : 'badge-inactive'}">${isActive ? 'Activa' : 'Inactiva'}</span></td>
      <td><div class="action-btns">
        <button class="btn-edit" onclick="openBrandModal('${key}')"><i class="fa-solid fa-pen"></i> Editar</button>
        <button class="btn-del" onclick="confirmDeleteBrand('${key}','${brand.label.replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
}

async function openBrandModal(key) {
  editingBrandKey = key || null;
  document.getElementById('brandModalTitle').textContent = key ? 'Editar Marca' : 'Nueva Marca';
  if (key) {
    const brands = await DB.getBrands();
    const b = brands[key];
    document.getElementById('brandName').value     = b?.label || '';
    document.getElementById('brandLogo').value     = b?.logo  || '';
    document.getElementById('brandIcon').value     = b?.icon  || 'fa-solid fa-certificate';
    document.getElementById('brandActive').checked = b?.active !== false;
  } else {
    document.getElementById('brandName').value     = '';
    document.getElementById('brandLogo').value     = '';
    document.getElementById('brandIcon').value     = 'fa-solid fa-certificate';
    document.getElementById('brandActive').checked = true;
  }
  renderBrandLogoPreview();
  document.getElementById('brandModal').classList.remove('hidden');
}

function closeBrandModal() { document.getElementById('brandModal').classList.add('hidden'); }

function renderBrandLogoPreview() {
  const c = document.getElementById('brandLogoPreview');
  const url = document.getElementById('brandLogo').value.trim();
  c.innerHTML = url
    ? `<img src="${url}" alt="" style="max-height:50px;max-width:160px;object-fit:contain;background:#fff;border:1px solid var(--gray-200);border-radius:6px;padding:4px">`
    : '';
}

async function handleBrandLogoUpload(input) {
  if (!input.files?.length) return;
  showToast('Subiendo logo...');
  try {
    const [data] = await uploadFiles([input.files[0]], 'image');
    document.getElementById('brandLogo').value = data.url;
    renderBrandLogoPreview();
    showToast('Logo agregado');
  } catch (err) {
    showToast(err.message || 'Error al subir el logo', 'error');
  }
  input.value = '';
}

async function saveBrand() {
  const label  = document.getElementById('brandName').value.trim();
  const logo   = document.getElementById('brandLogo').value.trim();
  const icon   = document.getElementById('brandIcon').value.trim() || 'fa-solid fa-certificate';
  const active = document.getElementById('brandActive').checked;
  if (!label) { showToast('El nombre es obligatorio', 'error'); return; }

  try {
    if (editingBrandKey) {
      await DB.updateBrand(editingBrandKey, { label, logo, icon, active });
      showToast('Marca actualizada');
    } else {
      await DB.addBrand({ label, logo, icon, active });
      showToast('Marca creada');
    }
    closeBrandModal();
    await DB.getBrands();
    await loadBrandTable();
    await populateCatFilter();
  } catch (err) {
    showToast(err.message || 'Error al guardar marca', 'error');
  }
}

async function confirmDeleteBrand(key, name) {
  document.getElementById('confirmMsg').textContent = `¿Eliminar la marca "${name}"? Solo se puede si no tiene productos asignados.`;
  document.getElementById('confirmModal').classList.remove('hidden');
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    try {
      await DB.deleteBrand(key);
      closeConfirm();
      showToast('Marca eliminada');
      await DB.getBrands();
      await loadBrandTable();
      await populateCatFilter();
    } catch (err) {
      showToast(err.message || 'Error al eliminar', 'error');
      closeConfirm();
    }
  };
}

// ── ORDERS ──
async function loadOrderStats() {
  const stats = await DB.getOrderStats();
  document.getElementById('orderStats').innerHTML = `
    ${statCard('Total pedidos', stats.total,     'fa-clipboard-list', 'blue')}
    ${statCard('Pendientes',    stats.pending,   'fa-clock',          'amber')}
    ${statCard('Enviados',      stats.shipped,   'fa-truck',          'purple')}
    ${statCard('Entregados',    stats.delivered, 'fa-box-open',       'green')}
    ${statCard('Cancelados',    stats.cancelled, 'fa-xmark',          'red')}`;
}

async function loadOrderTable() {
  const q            = (document.getElementById('orderSearch').value || '').toLowerCase();
  const statusFilter = document.getElementById('orderStatusFilter').value;
  let orders = await DB.getOrders();

  if (q)            orders = orders.filter(o => o.id.toLowerCase().includes(q) || o.userName.toLowerCase().includes(q) || o.userEmail.toLowerCase().includes(q));
  if (statusFilter) orders = orders.filter(o => o.status === statusFilter);

  const tbody = document.getElementById('ordersTableBody');
  const empty = document.getElementById('ordersEmpty');

  if (!orders.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  tbody.innerHTML = orders.map(o => {
    const st = ORDER_STATUSES[o.status] || {};
    return `<tr>
      <td style="font-weight:700;font-size:12px;color:var(--gray-500);white-space:nowrap">${o.id}</td>
      <td>
        <div style="font-weight:600">${esc(o.userName)}</div>
        <div style="font-size:12px;color:var(--gray-400)">${esc(o.userEmail)}</div>
      </td>
      <td style="font-size:13px">${(o.items || []).length} item${o.items?.length !== 1 ? 's' : ''}</td>
      <td style="font-weight:700;color:var(--primary)">${formatPrice(o.total)}
        <div style="font-size:11px;font-weight:600;color:${o.paymentStatus === 'paid' ? '#166534' : 'var(--gray-400)'}">${o.paymentMethod === 'stripe' ? 'Tarjeta' : 'WhatsApp'} · ${PAYMENT_LABELS[o.paymentStatus] || o.paymentStatus}</div>
      </td>
      <td>
        <select class="order-status-select" onchange="changeOrderStatus('${o.id}', this.value)">
          ${Object.entries(ORDER_STATUSES).map(([k, v]) =>
            `<option value="${k}"${o.status === k ? ' selected' : ''}>${v.label}</option>`).join('')}
        </select>
        ${o.delayed ? `<div style="margin-top:4px;font-size:11px;font-weight:700;color:#b45309"><i class="fa-solid fa-triangle-exclamation"></i> Retrasado</div>` : ''}
      </td>
      <td style="font-size:12px;color:var(--gray-500);white-space:nowrap">${formatDate(o.createdAt)}</td>
      <td><button class="btn-edit" onclick="viewOrderDetail('${o.id}')"><i class="fa-solid fa-eye"></i> Ver</button></td>
    </tr>`;
  }).join('');
}

async function changeOrderStatus(id, status) {
  try {
    await DB.updateOrderStatus(id, status);
    showToast('Estado actualizado');
    await loadOrderStats();
  } catch (err) {
    showToast(err.message || 'Error al actualizar', 'error');
  }
}

async function viewOrderDetail(id) {
  const orders = await DB.getOrders();
  const order  = orders.find(o => o.id === id);
  if (!order) return;
  const st = ORDER_STATUSES[order.status] || {};
  document.getElementById('orderDetailContent').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div>
        <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">ID del pedido</div>
        <div style="font-weight:700">${order.id}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Fecha</div>
        <div>${formatDate(order.createdAt)}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Cliente</div>
        <div style="font-weight:600">${esc(order.userName)}</div>
        <div style="font-size:13px;color:var(--gray-400)">${esc(order.userEmail)}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Estado</div>
        <span class="badge badge-${order.status}"><i class="fa-solid ${st.icon}"></i> ${st.label}</span>
      </div>
      ${order.shippingInfo?.phone   ? `<div><div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Teléfono</div><div>${esc(order.shippingInfo.phone)}</div></div>` : ''}
      ${order.shippingInfo?.address ? `<div style="grid-column:1/-1"><div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Dirección</div><div>${esc(order.shippingInfo.address)}${order.shippingInfo.cp ? ' · C.P. ' + esc(order.shippingInfo.cp) : ''}</div></div>` : ''}
    </div>
    <div style="border-top:1px solid var(--gray-200);padding-top:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px">Productos</div>
      ${(order.items || []).map(i => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--gray-100);font-size:14px">
          <div>
            <span style="font-weight:600">${esc(i.productName)}</span>
            ${i.size  ? `<span style="color:var(--gray-400);margin-left:8px">T:${esc(i.size)}</span>`  : ''}
            ${i.color ? `<span style="color:var(--gray-400);margin-left:8px">C:${esc(i.color)}</span>` : ''}
          </div>
          <div style="display:flex;gap:16px">
            <span style="color:var(--gray-500)">x${i.qty}</span>
            <span style="font-weight:700;color:var(--primary)">${formatPrice(i.price * i.qty)}</span>
          </div>
        </div>`).join('')}
      <div style="display:flex;justify-content:flex-end;padding-top:12px;font-size:16px;font-weight:800;color:var(--primary)">
        Total: ${formatPrice(order.total)}
      </div>
    </div>
    ${order.notes ? `<div style="background:var(--gray-50);border-radius:8px;padding:12px;margin-top:14px;font-size:13px"><strong>Notas:</strong> ${esc(order.notes)}</div>` : ''}
    ${order.cancelReason && order.status === 'cancelled' ? `<div style="background:#fef2f2;border-radius:8px;padding:12px;margin-top:14px;font-size:13px;color:#991b1b"><strong>Cancelado:</strong> ${esc(order.cancelReason)}</div>` : ''}
    ${orderPaymentBox(order)}
    ${order.status === 'cancelled' ? '' : `
    <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px;padding:14px;margin-top:14px">
      <div style="font-size:14px;font-weight:700;margin-bottom:10px"><i class="fa-solid fa-truck-fast"></i> Envío y número de guía</div>
      <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:8px">
        <input id="orderCarrier" class="form-input" maxlength="60" list="carrierList" placeholder="Paquetería (Estafeta, DHL...)" value="${esc(order.trackingCarrier)}">
        <input id="orderTracking" class="form-input" maxlength="80" placeholder="Número de guía" value="${esc(order.trackingNumber)}">
      </div>
      <datalist id="carrierList"><option value="Estafeta"><option value="DHL"><option value="FedEx"><option value="Paquetexpress"><option value="J&T Express"><option value="Correos de México"><option value="99 Minutos"><option value="Entrega local"></datalist>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px">
        <span style="font-size:12px;color:var(--gray-500)">Al guardar la guía el pedido pasa a "Enviado" y la clienta recibe un correo con ella.</span>
        <button class="btn-save" onclick="saveOrderTracking('${order.id}')" style="border-radius:8px;padding:9px 18px">Guardar guía</button>
      </div>
    </div>`}
    ${['delivered', 'cancelled'].includes(order.status) ? '' : `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-top:14px">
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#92400e;cursor:pointer">
        <input type="checkbox" id="orderDelayed" ${order.delayed ? 'checked' : ''}>
        <i class="fa-solid fa-triangle-exclamation"></i> Pedido retrasado
      </label>
      <textarea id="orderDelayNote" class="form-input" rows="2" maxlength="255" style="margin-top:10px;width:100%"
        placeholder="Mensaje para el cliente (opcional). Ej.: La paquetería reporta retraso; llega el viernes.">${esc(order.delayNote || '')}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px">
        <span style="font-size:12px;color:#92400e">El cliente lo verá en "Mis pedidos" y recibirá un correo.</span>
        <button class="btn-save" onclick="saveOrderDelay('${order.id}')" style="border-radius:8px;padding:9px 18px">Guardar</button>
      </div>
    </div>`}`;
  document.getElementById('orderDetailModal').classList.remove('hidden');
}

// Pago: los de tarjeta los confirma Stripe (aquí solo se pueden reembolsar);
// los de WhatsApp / transferencia / OXXO se marcan a mano al recibir el dinero.
const PAYMENT_LABELS = { unpaid: 'Sin pagar', paid: 'Pagado', refunded: 'Reembolsado', failed: 'Pago rechazado' };
function orderPaymentBox(order) {
  const label = PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus;
  const color = order.paymentStatus === 'paid' ? '#166534' : order.paymentStatus === 'refunded' ? '#6d28d9' : '#b45309';
  let action = '';
  if (order.paymentMethod === 'stripe') {
    if (order.paymentStatus === 'paid')
      action = `<button class="btn-del" onclick="refundOrder('${order.id}')" style="border-radius:8px;padding:8px 14px"><i class="fa-solid fa-rotate-left"></i> Reembolsar ${formatPrice(order.total)}</button>`;
  } else if (order.paymentStatus !== 'refunded') {
    const paid = order.paymentStatus === 'paid';
    action = `<button class="btn-save" onclick="setOrderPayment('${order.id}', '${paid ? 'unpaid' : 'paid'}')" style="border-radius:8px;padding:8px 14px">${paid ? 'Marcar como no pagado' : '<i class="fa-solid fa-check"></i> Marcar como pagado'}</button>`;
  }
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--gray-200);border-radius:8px;padding:12px 14px;margin-top:14px;font-size:14px">
    <div><i class="fa-solid ${order.paymentMethod === 'stripe' ? 'fa-credit-card' : 'fa-brands fa-whatsapp'}"></i>
      ${order.paymentMethod === 'stripe' ? 'Tarjeta (Stripe)' : 'WhatsApp / transferencia'} ·
      <strong style="color:${color}">${label}</strong></div>
    ${action}
  </div>`;
}

async function setOrderPayment(id, paymentStatus) {
  try {
    await DB.setOrderPayment(id, paymentStatus);
    showToast(paymentStatus === 'paid' ? 'Pago registrado' : 'Pago quitado');
    await viewOrderDetail(id);
    await loadOrderTable();
  } catch (err) {
    showToast(err.message || 'Error al guardar el pago', 'error');
  }
}

async function saveOrderTracking(id) {
  const carrier = document.getElementById('orderCarrier').value.trim();
  const number  = document.getElementById('orderTracking').value.trim();
  if (!number && !carrier) { showToast('Escribe la paquetería y el número de guía', 'error'); return; }
  try {
    await DB.setOrderTracking(id, carrier, number);
    showToast(number ? 'Guía guardada y enviada a la clienta' : 'Guardado');
    closeOrderDetail();
    await loadOrderTable();
    await loadOrderStats();
  } catch (err) {
    showToast(err.message || 'Error al guardar la guía', 'error');
  }
}

function refundOrder(id) {
  document.getElementById('confirmMsg').textContent = `¿Reembolsar el pedido ${id}? Stripe le regresa el dinero a la tarjeta de la clienta y el pedido se cancela (si no se había entregado). No se puede deshacer.`;
  document.querySelector('#confirmModal h3').textContent = '¿Confirmar reembolso?';
  const btn = document.getElementById('confirmDeleteBtn');
  btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Reembolsar';
  document.getElementById('confirmModal').classList.remove('hidden');
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await DB.refundOrder(id);
      closeConfirm();
      showToast('Reembolso enviado a Stripe');
      closeOrderDetail();
      await loadOrderTable();
      await loadOrderStats();
    } catch (err) {
      closeConfirm();
      showToast(err.message || 'Error al reembolsar', 'error');
    } finally {
      btn.disabled = false;
    }
  };
}

async function saveOrderDelay(id) {
  const delayed = document.getElementById('orderDelayed').checked;
  const note    = document.getElementById('orderDelayNote').value.trim();
  try {
    await DB.setOrderDelay(id, delayed, note);
    showToast(delayed ? 'Pedido marcado como retrasado' : 'Retraso quitado');
    closeOrderDetail();
    await loadOrderTable();
  } catch (err) {
    showToast(err.message || 'Error al guardar el retraso', 'error');
  }
}

function closeOrderDetail() { document.getElementById('orderDetailModal').classList.add('hidden'); }

// ── DELETE HELPERS ──
function confirmDeleteProduct(id, name) {
  document.getElementById('confirmMsg').textContent = `¿Eliminar "${name}"? Esta acción no se puede deshacer.`;
  document.getElementById('confirmModal').classList.remove('hidden');
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    try {
      await DB.deleteProduct(id);
      closeConfirm();
      showToast('Producto eliminado');
      await loadProductTable();
      await loadProductStats();
    } catch (err) {
      showToast(err.message || 'Error al eliminar', 'error');
      closeConfirm();
    }
  };
}

function closeConfirm() {
  document.getElementById('confirmModal').classList.add('hidden');
  // El diálogo se comparte: regresa a su texto de "eliminar" por si otra acción lo cambió.
  document.querySelector('#confirmModal h3').textContent = '¿Confirmar eliminación?';
  document.getElementById('confirmDeleteBtn').innerHTML = '<i class="fa-solid fa-trash"></i> Eliminar';
}

// ── EXPENSES ──
async function addExpense() {
  const concept  = document.getElementById('expConcept').value.trim();
  const amount   = Number(document.getElementById('expAmount').value);
  const category = document.getElementById('expCategory').value;
  const date     = document.getElementById('expDate').value;
  const notes    = document.getElementById('expNotes').value.trim();

  if (!concept)            { showToast('El concepto es obligatorio', 'error'); return; }
  if (!amount || amount <= 0){ showToast('Ingresa un monto válido', 'error');  return; }

  try {
    await DB.addExpense(concept, amount, category, date, notes);
    document.getElementById('expConcept').value = '';
    document.getElementById('expAmount').value  = '';
    document.getElementById('expNotes').value   = '';
    showToast('Gasto registrado');
    await loadExpenseTable();
  } catch (err) {
    showToast(err.message || 'Error al guardar gasto', 'error');
  }
}

async function loadExpenseTable() {
  const q         = (document.getElementById('expSearch').value || '').toLowerCase();
  const catFilter = document.getElementById('expCatFilter').value;
  let expenses    = await DB.getExpenses();

  if (q)         expenses = expenses.filter(e => e.concept.toLowerCase().includes(q) || (e.notes || '').toLowerCase().includes(q));
  if (catFilter) expenses = expenses.filter(e => e.category === catFilter);

  const tbody = document.getElementById('expensesTableBody');
  const empty = document.getElementById('expensesEmpty');
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  document.getElementById('expTotalVal').textContent = formatPrice(total);

  if (!expenses.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  tbody.innerHTML = expenses.map(e => `<tr>
    <td style="font-size:13px;color:var(--gray-500);white-space:nowrap">${formatDate(e.date)}</td>
    <td style="font-weight:600">${esc(e.concept)}</td>
    <td><span class="badge" style="background:var(--gray-100);color:var(--gray-600)">${EXPENSE_CATEGORIES[e.category] || e.category}</span></td>
    <td style="font-weight:700;color:var(--danger)">${formatPrice(e.amount)}</td>
    <td style="font-size:13px;color:var(--gray-400)">${esc(e.notes) || '–'}</td>
    <td><button class="btn-del" onclick="deleteExpense('${e.id}')"><i class="fa-solid fa-trash"></i></button></td>
  </tr>`).join('');
}

async function deleteExpense(id) {
  try {
    await DB.deleteExpense(id);
    showToast('Gasto eliminado');
    await loadExpenseTable();
  } catch (err) {
    showToast(err.message || 'Error al eliminar', 'error');
  }
}

// ── OVERVIEW CHARTS ──
let overviewBarChartRef = null, overviewDoughnutRef = null;

async function renderOverviewCharts() {
  const year = new Date().getFullYear();
  const [monthlyData, stats] = await Promise.all([DB.getMonthlyData(year), DB.getOrderStats()]);
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  if (overviewBarChartRef) overviewBarChartRef.destroy();
  const barCtx = document.getElementById('overviewBarChart');
  if (barCtx) {
    overviewBarChartRef = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          { label: 'Ingresos', data: monthlyData.map(m => m.revenue),  backgroundColor: 'rgba(26,92,46,.75)', borderRadius: 4 },
          { label: 'Gastos',   data: monthlyData.map(m => m.expenses), backgroundColor: 'rgba(220,38,38,.6)', borderRadius: 4 },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString('es-MX') } } } }
    });
  }

  if (overviewDoughnutRef) overviewDoughnutRef.destroy();
  const dCtx = document.getElementById('overviewDoughnut');
  if (dCtx) {
    overviewDoughnutRef = new Chart(dCtx, {
      type: 'doughnut',
      data: {
        labels: ['Pendiente','Confirmado','En proceso','Enviado','Entregado','Cancelado'],
        datasets: [{ data: [stats.pending,stats.confirmed,stats.processing,stats.shipped,stats.delivered,stats.cancelled], backgroundColor: ['#f59e0b','#3b82f6','#8b5cf6','#06b6d4','#10b981','#ef4444'], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } }
    });
  }
}

// ── REVIEWS (desde API) ──
async function loadReviewTable() {
  const tbody = document.getElementById('reviewsTableBody');
  const empty = document.getElementById('reviewsEmpty');
  let reviews = [];
  try {
    const r = await fetch('/api/reviews/admin', { credentials: 'include' });
    reviews = await r.json();
  } catch {}
  if (!reviews.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  tbody.innerHTML = reviews.map(r => `<tr>
    <td><div style="width:48px;height:48px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-user" style="color:var(--primary)"></i></div></td>
    <td>
      <div style="font-weight:600">${esc(r.author)}</div>
      <div style="font-size:12px;color:var(--gray-400)">${new Date(r.createdAt).toLocaleDateString('es-MX')}</div>
    </td>
    <td style="color:#f59e0b;font-size:16px">${'★'.repeat(r.rating)}</td>
    <td style="font-size:13px;color:var(--gray-600);max-width:340px">"${esc(r.text)}"</td>
    <td>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;margin-bottom:4px">
        <input type="checkbox" ${r.approved?'checked':''} onchange="toggleReviewField(${r.id},'approved',this.checked)"> Aprobada
      </label>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px">
        <input type="checkbox" ${r.featured?'checked':''} onchange="toggleReviewField(${r.id},'featured',this.checked)"> Destacada
      </label>
    </td>
    <td>
      <button class="btn-del" onclick="deleteReviewEntry(${r.id})" aria-label="Eliminar reseña">
        <i class="fa-solid fa-trash"></i>
      </button>
    </td>
  </tr>`).join('');
}

async function toggleReviewField(id, field, value) {
  await fetch('/api/reviews/' + id, {
    method:'PUT', credentials:'include', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ [field]: value })
  });
  showToast(field === 'approved' ? (value ? 'Reseña aprobada' : 'Reseña ocultada') : (value ? 'Destacada' : 'Quitada de destacadas'));
}

function deleteReviewEntry(id) {
  document.getElementById('confirmMsg').textContent = '¿Eliminar esta reseña? No se puede deshacer.';
  document.getElementById('confirmModal').classList.remove('hidden');
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    await fetch('/api/reviews/' + id, { method: 'DELETE', credentials: 'include' });
    closeConfirm();
    showToast('Reseña eliminada');
    loadReviewTable();
  };
}

// ── TESTIMONIOS (capturas) ────────────────────────────────────────────────────
async function loadTestimonialPanel() {
  const grid = document.getElementById('testimonialsGrid');
  let list = [];
  try { list = await apiFetch('/api/testimonials/admin'); } catch {}
  document.getElementById('testimonialsCount').textContent = `${list.length} captura${list.length !== 1 ? 's' : ''}`;
  if (!list.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;color:var(--gray-400);font-size:14px;text-align:center;padding:24px 0">Aún no hay capturas. Sube la primera arriba.</p>';
    return;
  }
  grid.innerHTML = list.map(t => `
    <div class="test-card${t.active ? '' : ' inactive'}">
      <img src="${esc(t.imageUrl)}" alt="Captura de testimonio" loading="lazy">
      ${t.active ? '' : '<span class="test-badge">Oculta</span>'}
      <div class="test-card-actions">
        <button title="${t.active ? 'Ocultar' : 'Mostrar'}" onclick="toggleTestimonial(${t.id}, ${t.active ? 0 : 1})">
          <i class="fa-solid fa-eye${t.active ? '' : '-slash'}"></i>
        </button>
        <button title="Eliminar" onclick="deleteTestimonial(${t.id})"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`).join('');
}

async function handleTestimonialUpload(input) {
  if (!input.files?.length) return;
  showToast('Subiendo capturas...');
  try {
    const subidas = await uploadFiles(Array.from(input.files).slice(0, 6), 'image');
    for (const { url } of subidas) {
      await apiFetch('/api/testimonials', { method: 'POST', body: JSON.stringify({ imageUrl: url }) });
    }
    showToast('Capturas agregadas');
    await loadTestimonialPanel();
  } catch (err) {
    showToast(err.message || 'Error al subir las capturas', 'error');
  }
  input.value = '';
}

async function toggleTestimonial(id, active) {
  try {
    await apiFetch(`/api/testimonials/${id}`, { method: 'PUT', body: JSON.stringify({ active }) });
    showToast(active ? 'Captura visible' : 'Captura oculta');
    await loadTestimonialPanel();
  } catch (e) { showToast(e.message || 'Error', 'error'); }
}

function deleteTestimonial(id) {
  document.getElementById('confirmMsg').textContent = '¿Eliminar esta captura? No se puede deshacer.';
  document.getElementById('confirmModal').classList.remove('hidden');
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    try {
      await apiFetch(`/api/testimonials/${id}`, { method: 'DELETE' });
      closeConfirm();
      showToast('Captura eliminada');
      await loadTestimonialPanel();
    } catch (e) { showToast(e.message || 'Error al eliminar', 'error'); closeConfirm(); }
  };
}

// ── CUPONES ──────────────────────────────────────────────────────────────────
async function loadCouponTable() {
  const tbody = document.getElementById('couponsTableBody');
  const empty = document.getElementById('couponsEmpty');
  let list = [];
  try {
    const r = await fetch('/api/coupons', { credentials: 'include' });
    list = await r.json();
  } catch {}
  if (!list.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  tbody.innerHTML = list.map(c => {
    const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
    const usedUp  = c.maxUses && c.uses >= c.maxUses;
    const stateLabel = !c.active ? 'Inactivo' : expired ? 'Expirado' : usedUp ? 'Agotado' : 'Activo';
    const stateColor = !c.active || expired || usedUp ? '#9ca3af' : '#10b981';
    const discount = c.discountType === 'percent' ? `${c.discountValue}%`
                   : c.discountType === 'free_shipping' ? 'Envío gratis' : formatPrice(c.discountValue);
    return `<tr>
      <td><strong style="font-family:'DM Sans',sans-serif;letter-spacing:1px;color:#1a5c2e">${esc(c.code)}</strong></td>
      <td style="font-size:13px;color:#4b5563;max-width:280px">${esc(c.description) || '-'}${c.oncePerUser ? '<div style="font-size:11px;color:#6d28d9;font-weight:600">1 uso por clienta</div>' : ''}</td>
      <td style="font-weight:700;color:#1a5c2e">${discount}</td>
      <td>${formatPrice(c.minSubtotal)}</td>
      <td>${c.uses}${c.maxUses ? ' / ' + c.maxUses : ''}</td>
      <td><span style="font-size:11px;padding:3px 10px;border-radius:12px;background:${stateColor}20;color:${stateColor};font-weight:700">${stateLabel}</span></td>
      <td style="white-space:nowrap">
        <button class="btn-edit" onclick="toggleCoupon(${c.id}, ${!c.active})" aria-label="${c.active ? 'Pausar' : 'Activar'}" title="${c.active ? 'Pausar' : 'Activar'}"><i class="fa-solid ${c.active ? 'fa-pause' : 'fa-play'}"></i></button>
        <button class="btn-del" onclick="deleteCoupon(${c.id})" aria-label="Eliminar"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

async function createCoupon() {
  const code = document.getElementById('coupCode').value.trim().toUpperCase();
  const discountType = document.getElementById('coupType').value;
  const discountValue = Number(document.getElementById('coupValue').value);
  const minSubtotal = Number(document.getElementById('coupMin').value || 0);
  const maxUses = document.getElementById('coupMaxUses').value || null;
  const expiresAt = document.getElementById('coupExpires').value || null;
  const description = document.getElementById('coupDesc').value.trim();
  const active = document.getElementById('coupActive').checked;
  const oncePerUser = document.getElementById('coupOncePerUser').checked;
  if (!code) return showToast('Código requerido', 'error');
  if (discountType !== 'free_shipping' && (!discountValue || discountValue <= 0)) return showToast('Valor del descuento requerido', 'error');
  if (discountType === 'percent' && discountValue > 100) return showToast('El % no puede ser mayor a 100', 'error');
  try {
    const r = await fetch('/api/coupons', {
      method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ code, discountType, discountValue, minSubtotal, maxUses, expiresAt, description, active, oncePerUser })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error');
    showToast('Cupón creado');
    document.getElementById('coupCode').value = '';
    document.getElementById('coupValue').value = '';
    document.getElementById('coupMin').value = '';
    document.getElementById('coupMaxUses').value = '';
    document.getElementById('coupExpires').value = '';
    document.getElementById('coupDesc').value = '';
    loadCouponTable();
  } catch (err) { showToast(err.message, 'error'); }
}

async function toggleCoupon(id, active) {
  try {
    const r = await fetch('/api/coupons/' + id, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Error');
    showToast(active ? 'Cupón activado' : 'Cupón pausado');
    loadCouponTable();
  } catch (err) { showToast(err.message, 'error'); }
}

function deleteCoupon(id) {
  document.getElementById('confirmMsg').textContent = '¿Eliminar este cupón? No se puede deshacer.';
  document.getElementById('confirmModal').classList.remove('hidden');
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    await fetch('/api/coupons/' + id, { method:'DELETE', credentials:'include' });
    closeConfirm();
    showToast('Cupón eliminado');
    loadCouponTable();
  };
}

// ── USUARIOS ─────────────────────────────────────────────────────────────────
let _allUsers = [];
let _editingUserId = null;

async function loadUserPanel() {
  _allUsers = await apiFetch('/api/users');

  const admins  = _allUsers.filter(u => u.role === 'admin').length;
  const regular = _allUsers.filter(u => u.role === 'user').length;
  const now     = new Date();
  const thisMonth = _allUsers.filter(u => {
    const d = new Date(u.createdAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  document.getElementById('userStats').innerHTML = `
    ${statCard('Total usuarios',       _allUsers.length, 'fa-users',            'blue')}
    ${statCard('Administradores',      admins,           'fa-user-shield',       'purple')}
    ${statCard('Clientes registrados', regular,          'fa-user',              'green')}
    ${statCard('Nuevos este mes',      thisMonth,        'fa-user-plus',         'amber')}`;

  loadUserTable();
}

function loadUserTable() {
  const q      = (document.getElementById('userSearch').value || '').toLowerCase();
  const role   = document.getElementById('userRoleFilter').value;
  const session = AUTH.getSession();

  let list = _allUsers;
  if (q)    list = list.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  if (role) list = list.filter(u => u.role === role);

  const tbody = document.getElementById('usersTableBody');
  const empty = document.getElementById('usersEmpty');
  if (!list.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  tbody.innerHTML = list.map(u => {
    const initials = u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const addr = u.address ? `${u.address.calle || ''} ${u.address.numero || ''}, ${u.address.colonia || ''}, ${u.address.ciudad || ''}, ${u.address.estado || ''}`.replace(/^[\s,]+|[\s,]+$/g,'') : '—';
    const isMe = session && session.id === u.id;
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:var(--primary);flex-shrink:0">${esc(initials)}</div>
          <div style="font-weight:600">${esc(u.name)}${isMe ? ' <span style="font-size:11px;color:var(--gray-400)">(tú)</span>' : ''}</div>
        </div>
      </td>
      <td style="color:var(--gray-500);font-size:13px">${esc(u.email)}</td>
      <td>
        <span class="badge" style="background:${u.role==='admin'?'#ede9fe':'#dcfce7'};color:${u.role==='admin'?'#6d28d9':'#166534'}">
          <i class="fa-solid ${u.role==='admin'?'fa-user-shield':'fa-user'}"></i>
          ${u.role === 'admin' ? 'Admin' : 'Usuario'}
        </span>
      </td>
      <td style="font-size:13px;color:var(--gray-500)">${u.birthdate ? new Date(u.birthdate).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</td>
      <td style="font-size:12px;color:var(--gray-400);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(addr)}">${esc(addr) || '—'}</td>
      <td style="font-size:12px;color:var(--gray-500)">${formatDate(u.createdAt)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-edit" onclick="openUserModal(${u.id})"><i class="fa-solid fa-pen"></i> Editar</button>
          ${!isMe ? `<button class="btn-del" onclick="confirmDeleteUser(${u.id})"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openUserModal(id) {
  const u = _allUsers.find(u => u.id === id);
  if (!u) return;
  _editingUserId = id;
  document.getElementById('userModalTitle').textContent = `Editar: ${u.name}`;
  document.getElementById('uName').value     = u.name;
  document.getElementById('uEmail').value    = u.email;
  document.getElementById('uRole').value     = u.role;
  document.getElementById('uPassword').value = '';
  document.getElementById('userModal').classList.remove('hidden');
}

function closeUserModal() { document.getElementById('userModal').classList.add('hidden'); }

// Algunos cambios de usuarios (nombrar admin, contraseña de un admin...) piden
// el código de la app. Si el servidor lo pide, se pregunta y se reintenta.
async function withSecondFactor(run) {
  try { return await run(undefined); }
  catch (err) {
    if (!err.data || !err.data.needCode) throw err;
    for (let tries = 0; tries < 3; tries++) {
      const code = prompt((tries ? 'Código incorrecto. ' : '') + 'Escribe el código de 6 dígitos de tu app para confirmar este cambio:');
      if (!code) throw new Error('Cambio cancelado');
      try { return await run(code.trim()); }
      catch (e) { if (!e.data || !e.data.needCode) throw e; }
    }
    throw new Error('Código incorrecto');
  }
}

async function saveUser() {
  const name     = document.getElementById('uName').value.trim();
  const email    = document.getElementById('uEmail').value.trim();
  const role     = document.getElementById('uRole').value;
  const password = document.getElementById('uPassword').value;

  if (!name || !email) { showToast('Nombre y correo son obligatorios', 'error'); return; }
  if (password && password.length < 8) { showToast('La contraseña debe tener al menos 8 caracteres', 'error'); return; }

  try {
    await withSecondFactor(code => apiFetch(`/api/users/${_editingUserId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, email, role, password: password || undefined, code }),
    }));
    showToast('Usuario actualizado');
    closeUserModal();
    await loadUserPanel();
  } catch(err) {
    showToast(err.message || 'Error al guardar', 'error');
  }
}

function confirmDeleteUser(id) {
  const name = _allUsers.find(u => u.id === id)?.name || '';
  document.getElementById('confirmMsg').textContent = `¿Eliminar la cuenta de "${name}"? Esta acción no se puede deshacer.`;
  document.getElementById('confirmModal').classList.remove('hidden');
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    try {
      await withSecondFactor(code => apiFetch(`/api/users/${id}`, { method: 'DELETE', body: JSON.stringify({ code }) }));
      closeConfirm();
      showToast('Usuario eliminado');
      await loadUserPanel();
    } catch(err) {
      showToast(err.message || 'Error al eliminar', 'error');
      closeConfirm();
    }
  };
}

// ── INGRESOS ──────────────────────────────────────────────────────────────────
let _allOrders = [];

async function loadIncomePanel() {
  _allOrders = await DB.getOrders();
  const year = Number(document.getElementById('incomeYear').value);
  const yearOrders = _allOrders.filter(o => new Date(o.createdAt).getFullYear() === year);

  const now         = new Date();
  const monthOrders = yearOrders.filter(o => new Date(o.createdAt).getMonth() === now.getMonth());
  const delivered   = yearOrders.filter(o => o.status === 'delivered');
  const pending     = yearOrders.filter(o => ['pending','confirmed','processing','shipped'].includes(o.status));

  const totalYear   = delivered.reduce((s, o) => s + Number(o.total), 0);
  const totalMonth  = monthOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + Number(o.total), 0);
  const totalPend   = pending.reduce((s, o) => s + Number(o.total), 0);

  document.getElementById('incomeStats').innerHTML = `
    ${statCard('Ingresos ' + year,     formatPrice(totalYear),   'fa-arrow-trend-up',    'green',  'pedidos entregados')}
    ${statCard('Ingresos este mes',    formatPrice(totalMonth),  'fa-calendar-check',    'blue',   new Date().toLocaleString('es-MX',{month:'long'}))}
    ${statCard('Por cobrar',           formatPrice(totalPend),   'fa-clock',             'amber',  `${pending.length} pedidos en curso`)}
    ${statCard('Total pedidos ' + year, yearOrders.length,       'fa-clipboard-list',    'purple', `${delivered.length} entregados`)}`;

  filterIncomeTable();
}

function filterIncomeTable() {
  const q      = (document.getElementById('incomeSearch').value || '').toLowerCase();
  const status = document.getElementById('incomeStatusFilter').value;
  const year   = Number(document.getElementById('incomeYear').value);

  let list = _allOrders.filter(o => new Date(o.createdAt).getFullYear() === year);
  if (q)      list = list.filter(o => o.id.toLowerCase().includes(q) || o.userName.toLowerCase().includes(q) || o.userEmail.toLowerCase().includes(q));
  if (status) list = list.filter(o => o.status === status);

  const total = list.filter(o => o.status === 'delivered').reduce((s, o) => s + Number(o.total), 0);
  document.getElementById('incomeTotalVal').textContent = formatPrice(total);

  const tbody = document.getElementById('incomeTableBody');
  const empty = document.getElementById('incomeEmpty');
  if (!list.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  tbody.innerHTML = list.map(o => {
    const st = ORDER_STATUSES[o.status] || {};
    return `<tr>
      <td style="font-size:12px;color:var(--gray-500);white-space:nowrap">${formatDate(o.createdAt)}</td>
      <td style="font-weight:700;font-size:12px;color:var(--gray-500)">${o.id}</td>
      <td>
        <div style="font-weight:600">${esc(o.userName)}</div>
        <div style="font-size:11px;color:var(--gray-400)">${esc(o.userEmail)}</div>
      </td>
      <td style="font-size:13px">${(o.items||[]).length} item${o.items?.length!==1?'s':''}</td>
      <td><span class="badge badge-${o.status}"><i class="fa-solid ${st.icon}"></i> ${st.label}</span></td>
      <td style="font-weight:800;font-size:15px;color:${o.status==='cancelled'?'var(--danger)':'var(--success)'}">${formatPrice(o.total)}</td>
    </tr>`;
  }).join('');
}

// Cerrar al hacer clic en el fondo.
// El modal de producto NO está aquí a propósito: es un formulario largo (con
// imágenes, tallas y colores) y un clic fuera por accidente borraba todo lo
// capturado. Solo se cierra con Cancelar, con la X, o al guardar el producto.
document.addEventListener('click', e => {
  if (e.target.id === 'confirmModal')     closeConfirm();
  if (e.target.id === 'categoryModal')    closeCategoryModal();
  if (e.target.id === 'brandModal')       closeBrandModal();
  if (e.target.id === 'orderDetailModal') closeOrderDetail();
  if (e.target.id === 'userModal')        closeUserModal();
});

// ── RESILIENCIA DE SESIÓN ────────────────────────────────────────────────────
// Antes: si la cookie de sesión se perdía (expiraba, se limpiaba, o el servidor
// se reiniciaba a media tarea), cualquier acción de admin devolvía un escueto
// "No autenticado" y te dejaba atorado, con riesgo de perder el producto que
// estabas capturando. Ahora, en vez de eso, aparece un modal para volver a
// entrar SIN recargar la página: el formulario a medio llenar queda intacto y
// puedes reintentar el botón donde te quedaste. Además, un chequeo periódico
// detecta la pérdida de sesión antes de que pierdas tiempo llenando datos.
(function sessionResilience() {
  let modalOpen = false;

  function showReloginModal() {
    if (modalOpen || document.getElementById('reloginModal')) return;
    modalOpen = true;
    const email = (typeof AUTH !== 'undefined' && AUTH.getSession && AUTH.getSession()?.email) || '';
    const ov = document.createElement('div');
    ov.id = 'reloginModal';
    ov.className = 'relogin-overlay';
    ov.innerHTML = `
      <div class="relogin-card" role="dialog" aria-modal="true" aria-labelledby="reloginTitle">
        <div class="relogin-icon"><i class="fa-solid fa-lock" aria-hidden="true"></i></div>
        <h3 id="reloginTitle">Tu sesión se cerró</h3>
        <p>Vuelve a iniciar sesión para continuar. <strong>No perderás lo que ya escribiste</strong> — el formulario sigue tal cual.</p>
        <form id="reloginForm" autocomplete="on">
          <input type="email" id="reloginEmail" placeholder="Correo" value="${esc(email)}" required autocomplete="username">
          <input type="password" id="reloginPass" placeholder="Contraseña" required autocomplete="current-password">
          <input type="text" id="reloginCode" placeholder="Código de 6 dígitos de tu app" inputmode="numeric" autocomplete="one-time-code" maxlength="9" hidden>
          <div id="reloginErr" class="relogin-err" role="alert"></div>
          <button type="submit" class="relogin-btn"><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Entrar y continuar</button>
        </form>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('open'));
    (email ? document.getElementById('reloginPass') : document.getElementById('reloginEmail')).focus();

    // Con verificación en dos pasos, tras la contraseña se pide el código de la app.
    let ticket = '';
    const askCode = t => {
      ticket = t;
      ['reloginEmail', 'reloginPass'].forEach(id => { const i = document.getElementById(id); i.hidden = true; i.required = false; });
      const code = document.getElementById('reloginCode');
      code.hidden = false; code.required = true; code.value = ''; code.focus();
    };

    document.getElementById('reloginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = ov.querySelector('.relogin-btn');
      const errEl = document.getElementById('reloginErr');
      btn.disabled = true; errEl.textContent = '';
      const r = ticket
        ? await AUTH.verify2fa(ticket, document.getElementById('reloginCode').value)
        : await AUTH.login(
            document.getElementById('reloginEmail').value.trim(),
            document.getElementById('reloginPass').value
          );
      if (r && r.twoFactor) {
        askCode(r.ticket);
        btn.disabled = false;
        return;
      }
      if (r && r.expired) {
        // Se acabaron los 5 minutos: de vuelta a correo y contraseña.
        ticket = '';
        ['reloginEmail', 'reloginPass'].forEach(id => { const i = document.getElementById(id); i.hidden = false; i.required = true; });
        const code = document.getElementById('reloginCode'); code.hidden = true; code.required = false;
      }
      if (r && r.success) {
        ov.classList.remove('open');
        setTimeout(() => ov.remove(), 200);
        modalOpen = false;
        if (typeof showToast === 'function') showToast('Sesión renovada. Continúa justo donde estabas.', 'success');
      } else {
        errEl.textContent = (r && r.error) || 'No se pudo iniciar sesión';
        btn.disabled = false;
      }
    });
  }

  // Guardamos la fetch original para el chequeo periódico (evita recursión) y
  // para no engancharnos a nuestras propias llamadas de login/heartbeat.
  const _fetch = window.fetch.bind(window);

  // Interceptor global: cualquier 401 de la API abre el modal de re-login.
  window.fetch = async function (...args) {
    const res = await _fetch(...args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      if (res.status === 401 && url.includes('/api/')
          && !url.includes('/api/auth/login') && !url.includes('/api/auth/me')
          && !url.includes('/api/auth/2fa') && !url.includes('/api/users/me/2fa')) {
        showReloginModal();
      }
    } catch {}
    return res;
  };

  // Latido: detecta la pérdida de sesión ANTES de que llenes un producto en vano.
  setInterval(async () => {
    if (modalOpen) return;
    try {
      const r = await _fetch('/api/auth/me', { credentials: 'include' });
      if (r.status === 401) showReloginModal();
    } catch {}
  }, 4 * 60 * 1000);
})();
