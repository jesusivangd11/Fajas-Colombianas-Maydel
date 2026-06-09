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
  else if (name === 'coupons')    loadCouponTable();
  else if (name === 'users')      loadUserPanel();
  else if (name === 'income')     loadIncomePanel();
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
        <td>${o.userName}<br><small style="color:var(--gray-400)">${o.userEmail}</small></td>
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
  const fCat = document.getElementById('f-category');
  if (fCat) {
    fCat.innerHTML = '<option value="">Seleccionar...</option>';
    Object.entries(cats).forEach(([k, v]) => {
      fCat.innerHTML += `<option value="${k}">${v.label}</option>`;
    });
  }
  const brands = await DB.getBrands();
  const fBrand = document.getElementById('f-brand');
  if (fBrand) {
    fBrand.innerHTML = '<option value="">Sin marca</option>';
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
  if (cat) list = list.filter(p => p.category === cat);
  if (status === 'active')   list = list.filter(p => p.active !== false);
  if (status === 'inactive') list = list.filter(p => p.active === false);

  const tbody = document.getElementById('productsTableBody');
  const empty = document.getElementById('tableEmpty');
  if (!list.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  tbody.innerHTML = list.map(p => {
    const img     = p.images?.[0];
    const catInfo = cats[p.category] || {};
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
      <td>${catInfo.icon ? `<i class="${catInfo.icon}" style="color:var(--primary);margin-right:5px"></i>` : ''}${catInfo.label || p.category || '–'}</td>
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
let currentVideo = '';
let currentTags = [];
let selectedSizes = [];
let selectedColors = [];
const MAX_IMAGES = 6;

async function openProductModal(id) {
  editingProductId = id || null;
  currentImages = []; currentVideo = ''; currentTags = []; selectedSizes = []; selectedColors = [];

  document.getElementById('productModalTitle').textContent = id ? 'Editar Producto' : 'Nuevo Producto';
  ['f-name','f-reference','f-price','f-original-price','f-stock','f-material','f-desc'].forEach(f => document.getElementById(f).value = '');
  document.getElementById('f-category').value = '';
  const fBrandEl = document.getElementById('f-brand'); if (fBrandEl) fBrandEl.value = '';
  document.getElementById('f-active').checked = true;
  document.getElementById('f-featured').checked = false;
  document.getElementById('f-isnew').checked = false;

  switchTab('info', document.querySelector('.tab-btn'));
  renderTagsInput(); renderImagePreviews(); renderVideoPreview(); renderSizeCheckboxes(); renderColorSwatches(); renderSelectedColors();
  await populateCatFilter();

  if (id) {
    const p = await DB.getProduct(id);
    if (!p) return;
    document.getElementById('f-name').value          = p.name || '';
    document.getElementById('f-category').value      = p.category || '';
    const fBrandSet = document.getElementById('f-brand'); if (fBrandSet) fBrandSet.value = p.brand || '';
    document.getElementById('f-reference').value     = p.reference || '';
    document.getElementById('f-price').value         = p.price || '';
    document.getElementById('f-original-price').value= p.originalPrice || '';
    document.getElementById('f-stock').value         = p.stock ?? '';
    document.getElementById('f-material').value      = p.material || '';
    document.getElementById('f-desc').value          = p.description || '';
    document.getElementById('f-active').checked      = p.active !== false;
    document.getElementById('f-featured').checked    = !!p.featured;
    document.getElementById('f-isnew').checked       = !!p.isNew;
    currentImages  = [...(p.images  || [])];
    currentVideo   = p.video || '';
    currentTags    = [...(p.tags    || [])];
    selectedSizes  = [...(p.sizes   || [])];
    selectedColors = [...(p.colors  || [])];
    renderTagsInput(); renderImagePreviews(); renderVideoPreview(); renderSizeCheckboxes(); renderColorSwatches(); renderSelectedColors();
  }

  document.getElementById('productModal').classList.remove('hidden');
}

function closeProductModal() { document.getElementById('productModal').classList.add('hidden'); }

async function saveProduct() {
  const name     = document.getElementById('f-name').value.trim();
  const category = document.getElementById('f-category').value;
  const price    = Number(document.getElementById('f-price').value);

  if (!name)            { showToast('El nombre es obligatorio', 'error');    switchTab('info', document.querySelector('.tab-btn')); return; }
  if (!category)        { showToast('Selecciona una categoría', 'error');    switchTab('info', document.querySelector('.tab-btn')); return; }
  if (!price || price <= 0){ showToast('Ingresa un precio válido', 'error'); switchTab('info', document.querySelector('.tab-btn')); return; }

  const data = {
    name, category, price,
    brand:         document.getElementById('f-brand')?.value || '',
    reference:     document.getElementById('f-reference').value.trim(),
    originalPrice: Number(document.getElementById('f-original-price').value) || null,
    stock:         Number(document.getElementById('f-stock').value) || 0,
    material:      document.getElementById('f-material').value.trim(),
    description:   document.getElementById('f-desc').value.trim(),
    active:        document.getElementById('f-active').checked,
    featured:      document.getElementById('f-featured').checked,
    isNew:         document.getElementById('f-isnew').checked,
    images:        [...currentImages],
    video:         currentVideo,
    tags:          [...currentTags],
    sizes:         [...selectedSizes],
    colors:        [...selectedColors],
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
  const formData = new FormData();
  files.forEach(f => formData.append('images', f));
  try {
    const res  = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: formData });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Error al subir imagen', 'error'); return; }
    data.urls.forEach(url => currentImages.push(url));
    renderImagePreviews();
  } catch {
    showToast('Error al subir imagen', 'error');
  }
  input.value = '';
}

function removeImage(i) { currentImages.splice(i, 1); renderImagePreviews(); }

function renderImagePreviews() {
  const c = document.getElementById('imgPreview');
  const counter = document.getElementById('imgCount');
  if (counter) counter.textContent = `(${currentImages.length}/${MAX_IMAGES})`;
  if (!currentImages.length) { c.innerHTML = '<span style="color:var(--gray-400);font-size:13px">Sin imágenes.</span>'; return; }
  c.innerHTML = currentImages.map((src, i) => `
    <div class="img-preview-item">
      <img src="${src}" alt="">
      ${i === 0 ? `<div class="img-label">Principal</div>` : ''}
      <button class="img-remove" onclick="removeImage(${i})"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
}

// ── VIDEO HANDLING ──
function addVideoUrl() {
  const url = document.getElementById('videoUrlInput').value.trim();
  if (!url) return;
  currentVideo = url;
  document.getElementById('videoUrlInput').value = '';
  renderVideoPreview();
}

async function handleVideoUpload(input) {
  if (!input.files?.length) return;
  const formData = new FormData();
  formData.append('video', input.files[0]);
  showToast('Subiendo video...');
  try {
    const res  = await fetch('/api/upload/video', { method: 'POST', credentials: 'include', body: formData });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Error al subir el video', 'error'); return; }
    currentVideo = data.url;
    renderVideoPreview();
    showToast('Video agregado');
  } catch {
    showToast('Error al subir el video', 'error');
  }
  input.value = '';
}

function removeVideo() { currentVideo = ''; renderVideoPreview(); }

function renderVideoPreview() {
  const c = document.getElementById('videoPreview');
  if (!c) return;
  if (!currentVideo) { c.innerHTML = '<span style="color:var(--gray-400);font-size:13px">Sin video.</span>'; return; }
  c.innerHTML = `
    <div class="img-preview-item" style="width:100%;max-width:320px;position:relative">
      <video src="${currentVideo}" controls style="width:100%;border-radius:8px;display:block"></video>
      <button class="img-remove" onclick="removeVideo()"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
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
});

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

// ── CATEGORIES ──
let editingCatKey = null;

async function loadCategoryTable() {
  const [cats, products] = await Promise.all([DB.getCategories(), DB.getProducts()]);
  const tbody = document.getElementById('catTableBody');
  tbody.innerHTML = Object.entries(cats).map(([key, cat]) => {
    const count    = products.filter(p => p.category === key).length;
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
        <button class="btn-del" onclick="confirmDeleteCategory('${key}','${cat.label}')"><i class="fa-solid fa-trash"></i></button>
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

async function confirmDeleteCategory(key, name) {
  document.getElementById('confirmMsg').textContent = `¿Eliminar "${name}"? Solo se puede si no tiene productos asignados.`;
  document.getElementById('confirmModal').classList.remove('hidden');
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    try {
      await DB.deleteCategory(key);
      closeConfirm();
      showToast('Categoría eliminada');
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
  const formData = new FormData();
  formData.append('images', input.files[0]);
  showToast('Subiendo logo...');
  try {
    const res  = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: formData });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'Error al subir el logo', 'error'); return; }
    document.getElementById('brandLogo').value = data.urls[0];
    renderBrandLogoPreview();
    showToast('Logo agregado');
  } catch {
    showToast('Error al subir el logo', 'error');
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
      <td style="font-weight:700;color:var(--primary)">${formatPrice(o.total)}</td>
      <td>
        <select class="order-status-select" onchange="changeOrderStatus('${o.id}', this.value)">
          ${Object.entries(ORDER_STATUSES).map(([k, v]) =>
            `<option value="${k}"${o.status === k ? ' selected' : ''}>${v.label}</option>`).join('')}
        </select>
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
      ${order.shippingInfo?.address ? `<div style="grid-column:1/-1"><div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Dirección</div><div>${esc(order.shippingInfo.address)}</div></div>` : ''}
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
    ${order.notes ? `<div style="background:var(--gray-50);border-radius:8px;padding:12px;margin-top:14px;font-size:13px"><strong>Notas:</strong> ${esc(order.notes)}</div>` : ''}`;
  document.getElementById('orderDetailModal').classList.remove('hidden');
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

function closeConfirm() { document.getElementById('confirmModal').classList.add('hidden'); }

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
    <td style="font-weight:600">${e.concept}</td>
    <td><span class="badge" style="background:var(--gray-100);color:var(--gray-600)">${EXPENSE_CATEGORIES[e.category] || e.category}</span></td>
    <td style="font-weight:700;color:var(--danger)">${formatPrice(e.amount)}</td>
    <td style="font-size:13px;color:var(--gray-400)">${e.notes || '–'}</td>
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
    const discount = c.discountType === 'percent' ? `${c.discountValue}%` : formatPrice(c.discountValue);
    return `<tr>
      <td><strong style="font-family:'DM Sans',sans-serif;letter-spacing:1px;color:#1a5c2e">${c.code}</strong></td>
      <td style="font-size:13px;color:#4b5563;max-width:280px">${c.description || '-'}</td>
      <td style="font-weight:700;color:#1a5c2e">${discount}</td>
      <td>${formatPrice(c.minSubtotal)}</td>
      <td>${c.uses}${c.maxUses ? ' / ' + c.maxUses : ''}</td>
      <td><span style="font-size:11px;padding:3px 10px;border-radius:12px;background:${stateColor}20;color:${stateColor};font-weight:700">${stateLabel}</span></td>
      <td>
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
  if (!code) return showToast('Código requerido', 'error');
  if (!discountValue || discountValue <= 0) return showToast('Valor del descuento requerido', 'error');
  if (discountType === 'percent' && discountValue > 100) return showToast('El % no puede ser mayor a 100', 'error');
  try {
    const r = await fetch('/api/coupons', {
      method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ code, discountType, discountValue, minSubtotal, maxUses, expiresAt, description, active })
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

async function saveUser() {
  const name     = document.getElementById('uName').value.trim();
  const email    = document.getElementById('uEmail').value.trim();
  const role     = document.getElementById('uRole').value;
  const password = document.getElementById('uPassword').value;

  if (!name || !email) { showToast('Nombre y correo son obligatorios', 'error'); return; }
  if (password && password.length < 6) { showToast('La contraseña debe tener al menos 6 caracteres', 'error'); return; }

  try {
    await apiFetch(`/api/users/${_editingUserId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, email, role, password: password || undefined }),
    });
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
      await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
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
        <div style="font-weight:600">${o.userName}</div>
        <div style="font-size:11px;color:var(--gray-400)">${o.userEmail}</div>
      </td>
      <td style="font-size:13px">${(o.items||[]).length} item${o.items?.length!==1?'s':''}</td>
      <td><span class="badge badge-${o.status}"><i class="fa-solid ${st.icon}"></i> ${st.label}</span></td>
      <td style="font-weight:800;font-size:15px;color:${o.status==='cancelled'?'var(--danger)':'var(--success)'}">${formatPrice(o.total)}</td>
    </tr>`;
  }).join('');
}

// backdrop close
document.addEventListener('click', e => {
  if (e.target.id === 'productModal')     closeProductModal();
  if (e.target.id === 'confirmModal')     closeConfirm();
  if (e.target.id === 'categoryModal')    closeCategoryModal();
  if (e.target.id === 'brandModal')       closeBrandModal();
  if (e.target.id === 'orderDetailModal') closeOrderDetail();
  if (e.target.id === 'userModal')        closeUserModal();
});
