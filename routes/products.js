const router = require('express').Router();
const pool   = require('../db/connection');
const { adminOnly, sessionUser } = require('../middleware/auth');

// Orden estándar de tallas: se muestran siempre así (XS, S, M, L, XL...) sin
// importar en qué orden las eligió el admin. Las tallas que no estén en la lista
// (personalizadas) se dejan al final conservando su orden original.
const SIZE_ORDER = ['2XS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','Talla única','Única','Unitalla'];
function sortSizes(sizes) {
  if (!Array.isArray(sizes)) return [];
  const rank = s => { const i = SIZE_ORDER.indexOf(String(s).trim()); return i === -1 ? 999 : i; };
  return [...sizes].sort((a, b) => rank(a) - rank(b)); // sort estable: los "999" quedan en su orden
}

function parseProduct(row) {
  return {
    id:            row.id,
    name:          row.name,
    description:   row.description || '',
    price:         Number(row.price),
    originalPrice: row.original_price ? Number(row.original_price) : null,
    // Precio por pieza al llegar a 6+ de este producto (sumando variantes). null = sin mayoreo.
    wholesalePrice: row.wholesale_price ? Number(row.wholesale_price) : null,
    stock:         row.stock,
    // category = principal (primera); categories = arreglo completo. Si la fila
    // aún no tiene el arreglo (BD vieja), se deriva de la categoría principal.
    category:      row.category || '',
    categories:    Array.isArray(row.categories) && row.categories.length
                     ? row.categories
                     : (row.category ? [row.category] : []),
    brand:         row.brand || '',
    sizes:         sortSizes(row.sizes || []),
    colors:        row.colors || [],
    // Variantes estructuradas: [{ color, option, sizes:[...], price }]. [] = el
    // producto usa el modo simple (tallas/colores planos, todo combina con todo).
    variants:      parseVariants(row.variants),
    images:        row.images || [],
    // Enfoque por imagen: { url: "x% y%" }. Solo el admin lo edita; el front lo
    // aplica como object-position donde la foto se recorta.
    imageFocus:    (row.image_focus && typeof row.image_focus === 'object' && !Array.isArray(row.image_focus)) ? row.image_focus : {},
    // video / videoPosition: PRIMER video, se conservan por compatibilidad.
    video:         row.video || '',
    // Dónde va el video dentro de la galería (0 = primero). null = al final.
    videoPosition: row.video_position === null || row.video_position === undefined
                     ? null : Number(row.video_position),
    // videos: arreglo completo [{ url, position }]. Fuente de verdad para la galería.
    videos:        parseVideos(row),
    material:      row.material  || '',
    reference:     row.reference || '',
    tags:          row.tags || [],
    active:        !!row.active,
    featured:      !!row.featured,
    isNew:         !!row.is_new,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
  };
}

// Tope de variantes por producto y de tallas por variante (evita payloads absurdos).
const MAX_VARIANTS = 60;
const MAX_SIZES_PER_VARIANT = 20;

// Ordena una lista de tallas-con-inventario [{size,stock}] por el orden estándar.
function sortVariantSizes(list) {
  const rank = s => { const i = SIZE_ORDER.indexOf(String(s).trim()); return i === -1 ? 999 : i; };
  return [...list].sort((a, b) => rank(a.size) - rank(b.size));
}

// Normaliza las tallas de una variante a [{ size, stock }]. Acepta el formato
// nuevo ({size,stock}) y el viejo (solo string de talla, sin inventario → stock
// null = "sin control de inventario", disponible sin límite).
function parseVariantSizes(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(), list = [];
  for (const s of raw) {
    let size = '', stock = null;
    if (typeof s === 'string') size = s.trim();
    else if (s && typeof s === 'object') {
      size = String(s.size || '').trim();
      if (s.stock != null && s.stock !== '' && !isNaN(Number(s.stock))) stock = Math.max(0, Math.floor(Number(s.stock)));
    }
    if (!size || seen.has(size)) continue;
    seen.add(size);
    list.push({ size, stock });
    if (list.length >= MAX_SIZES_PER_VARIANT) break;
  }
  return sortVariantSizes(list);
}

// Lee las variantes de una fila. Deja solo entradas con forma válida:
//   { color:string, option:string, sizes:[{size,stock}], price:number|null }
function parseVariants(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const color  = typeof v.color  === 'string' ? v.color.trim()  : '';
    const option = typeof v.option === 'string' ? v.option.trim() : '';
    const sizes  = parseVariantSizes(v.sizes);
    let price = null;
    if (v.price != null && v.price !== '' && Number(v.price) > 0) price = Number(v.price);
    // Una variante sin color ni opción ni tallas no aporta nada: se descarta.
    if (!color && !option && !sizes.length) continue;
    out.push({ color, option, sizes, price });
    if (out.length >= MAX_VARIANTS) break;
  }
  return out;
}

// Igual que parseVariants; aquí entra el dato no confiable del admin.
function sanitizeVariants(raw) { return parseVariants(raw); }

// A partir de las variantes deriva la unión de tallas y colores (listas planas que
// alimentan los filtros de la tienda y la guía de tallas) y el STOCK TOTAL (suma
// del inventario por talla). Si ninguna talla lleva inventario numérico (variantes
// viejas sin control), se conserva el stock que traía el producto.
function deriveFromVariants(variants, fallbackSizes, fallbackColors, fallbackStock) {
  const fStock = Number.isFinite(Number(fallbackStock)) ? Math.max(0, Math.floor(Number(fallbackStock))) : 0;
  if (!variants.length) {
    return { sizes: Array.isArray(fallbackSizes) ? fallbackSizes : [],
             colors: Array.isArray(fallbackColors) ? fallbackColors : [], stock: fStock };
  }
  const sizes = new Set(), colors = new Set();
  let anyTracked = false, sum = 0;
  for (const v of variants) {
    if (v.color) colors.add(v.color);
    for (const s of v.sizes) {
      sizes.add(s.size);
      if (s.stock != null) { anyTracked = true; sum += s.stock; }
    }
  }
  return { sizes: sortSizes([...sizes]), colors: [...colors], stock: anyTracked ? sum : fStock };
}

/* El admin edita el inventario sobre lo que había al ABRIR el formulario. Si
   mientras tanto entró una venta (o se canceló un pedido), guardar tal cual
   regresaría el stock al valor viejo. Por eso no se guarda el número del
   formulario sino el CAMBIO que hizo el admin, aplicado al stock actual:
     final = actual + (formulario - base)
   `base*` es lo que el panel cargó al abrir; si no llega (cliente viejo), se
   guarda el formulario tal cual, como antes. */
const sizeKey = (v, s) => `${v.color || ''}\u0000${v.option || ''}\u0000${s.size}`;
function stockMap(variants) {
  const m = new Map();
  for (const v of (Array.isArray(variants) ? variants : [])) {
    for (const s of (Array.isArray(v.sizes) ? v.sizes : [])) {
      if (s && typeof s === 'object' && s.stock != null) m.set(sizeKey(v, s), Number(s.stock) || 0);
    }
  }
  return m;
}
function mergeVariantStock(vars, baseVariants, currentVariants) {
  if (!Array.isArray(baseVariants)) return vars;
  const base = stockMap(parseVariants(baseVariants));
  const cur  = stockMap(parseVariants(currentVariants));
  for (const v of vars) {
    for (const s of v.sizes) {
      const k = sizeKey(v, s);
      if (s.stock == null || !base.has(k) || !cur.has(k)) continue;
      s.stock = Math.max(0, cur.get(k) + (s.stock - base.get(k)));
    }
  }
  return vars;
}
function mergePlainStock(stock, baseStock, currentStock) {
  if (baseStock === undefined || baseStock === null || baseStock === '') return stock;
  const delta = (Number(stock) || 0) - (Number(baseStock) || 0);
  return Math.max(0, (Number(currentStock) || 0) + delta);
}

// La posición de un video debe caer dentro de la galería: con N imágenes, los
// huecos válidos van de 0 (antes de la primera) a N (al final). Fuera de ahí, o
// si no es entero, se trata como "al final" (null).
function normalizePos(pos, max) {
  // null / undefined / '' significan "al final": no los tratamos como 0, porque
  // Number(null) === 0 los mandaría al frente por error.
  if (pos === null || pos === undefined || pos === '') return null;
  const n = Number(pos);
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

// Máximo razonable de videos por producto (el front permite hasta 6).
const MAX_VIDEOS = 12;

// Deja pasar solo enfoques válidos: clave = una imagen del producto, valor =
// "x% y%" (0–100). Se inyecta como CSS object-position, así que filtramos
// cualquier cosa que no calce el patrón para no permitir CSS arbitrario.
function sanitizeImageFocus(focus, images) {
  const out = {};
  if (!focus || typeof focus !== 'object') return out;
  const imgs = new Set(Array.isArray(images) ? images : []);
  for (const [url, val] of Object.entries(focus)) {
    if (imgs.has(url) && typeof val === 'string' && /^\d{1,3}% \d{1,3}%$/.test(val)) {
      const [x, y] = val.split(' ').map(s => parseInt(s, 10));
      if (x <= 100 && y <= 100) out[url] = `${x}% ${y}%`;
    }
  }
  return out;
}

// Lee los videos de una fila. Prioriza el arreglo `videos`; si la fila es vieja
// y solo tiene la columna `video`, la envuelve en un arreglo de un elemento.
function parseVideos(row) {
  if (Array.isArray(row.videos) && row.videos.length) {
    return row.videos
      .filter(v => v && v.url)
      .map(v => ({ url: String(v.url), position: v.position == null ? null : Number(v.position) }));
  }
  if (row.video) return [{ url: row.video, position: row.video_position == null ? null : Number(row.video_position) }];
  return [];
}

// Normaliza el arreglo de videos del body. Acepta strings (solo URL) u objetos
// { url, position }. Devuelve [{ url, position }] con la posición encajada en la
// galería (0..nº de imágenes) o null (= al final). Cae de vuelta al viejo
// `video`/`videoPosition` si no llega `videos`.
function normalizeVideos(videos, video, videoPosition, images) {
  let list = Array.isArray(videos) ? videos : [];
  if (!list.length && video) list = [{ url: video, position: videoPosition }];
  const max = (images || []).length;
  const out = [];
  for (const v of list) {
    const url = (typeof v === 'string' ? v : v && v.url) || '';
    if (!url.trim()) continue;
    const pos = normalizePos(typeof v === 'object' && v ? v.position : null, max);
    out.push({ url: url.trim(), position: pos });
    if (out.length >= MAX_VIDEOS) break;
  }
  return out;
}

// Normaliza las categorías del body: acepta `categories` (arreglo) y/o el viejo
// `category` (una sola). Devuelve { list, primary } sin claves vacías ni repetidas.
function normalizeCategories(categories, category) {
  let list = Array.isArray(categories) ? categories : (categories ? [categories] : []);
  if (!list.length && category) list = [category];
  list = [...new Set(list.map(c => String(c || '').trim()).filter(Boolean))];
  return { list, primary: list[0] || '' };
}

async function isAdminRequest(req) {
  try {
    const user = await sessionUser(req);
    return !!user && user.role === 'admin';
  } catch { return false; }
}

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const admin = await isAdminRequest(req);
    const { q, cat, brand, sort, minPrice, maxPrice, ids, exclude, limit } = req.query;

    // Búsqueda por IDs específicos (para el carrito)
    if (ids) {
      const idList = [...new Set(String(ids).split(',').map(Number).filter(Boolean))].slice(0, 100);
      if (!idList.length) return res.json([]);
      const placeholders = idList.map(() => '?').join(',');
      // Los desactivados (borradores, descontinuados) solo los ve el admin.
      const [rows] = await pool.execute(
        `SELECT * FROM products WHERE id IN (${placeholders})${admin ? '' : ' AND active = 1'}`,
        idList
      );
      return res.json(rows.map(parseProduct));
    }

    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (!admin)   { sql += ' AND active = 1'; }
    // Un producto pertenece a la categoría si está en su arreglo `categories`
    // (o, para filas viejas sin arreglo, si es su categoría principal).
    if (cat)      { sql += ' AND (JSON_CONTAINS(categories, ?) OR category = ?)'; params.push(JSON.stringify(cat), cat); }
    if (brand)    { sql += ' AND brand = ?'; params.push(brand); }
    if (exclude)  { sql += ' AND id != ?'; params.push(Number(exclude)); }
    if (minPrice) { sql += ' AND price >= ?'; params.push(Number(minPrice)); }
    if (maxPrice) { sql += ' AND price <= ?'; params.push(Number(maxPrice)); }
    if (q) {
      // Búsqueda en SQL: evita traer toda la tabla a memoria y filtrarla en Node.
      // Marca y categoría se guardan por CLAVE ("ann-chery"), no por etiqueta
      // ("Ann Chery"), así que buscarlas con un LIKE directo no encontraría nada
      // en cuanto la clienta escriba el nombre con espacios. Por eso se busca
      // también contra la etiqueta de las tablas brands y categories.
      sql += ` AND (
        name LIKE ? OR description LIKE ? OR tags LIKE ?
        OR category LIKE ? OR category IN (SELECT \`key\` FROM categories WHERE label LIKE ?)
        OR EXISTS (SELECT 1 FROM categories c WHERE c.label LIKE ? AND JSON_CONTAINS(products.categories, JSON_QUOTE(c.\`key\`)))
        OR brand    LIKE ? OR brand    IN (SELECT \`key\` FROM brands     WHERE label LIKE ?)
      )`;
      const like = `%${String(q).slice(0, 100)}%`;
      params.push(like, like, like, like, like, like, like, like);
    }

    const sortMap = {
      'price-asc':  'price ASC',
      'price-desc': 'price DESC',
      'name':       'name ASC',
      'newest':     'created_at DESC',
    };
    sql += ` ORDER BY ${sortMap[sort] || 'created_at DESC'}`;
    // MySQL no acepta LIMIT como parámetro de una sentencia preparada: con
    // "LIMIT ?" el driver revienta con ER_WRONG_ARGUMENTS y la consulta entera
    // falla (era lo que dejaba vacíos los "Productos Relacionados"). Lo pasamos
    // interpolado, pero forzado antes a entero, así que no es inyectable.
    if (limit) {
      const n = Math.min(Math.max(parseInt(limit, 10) || 0, 1), 100);
      sql += ` LIMIT ${n}`;
    }

    const [rows] = await pool.execute(sql, params);
    res.json(rows.map(parseProduct));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// GET /api/products/stats
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const [stock] = await pool.execute(
      'SELECT COALESCE(SUM(stock),0) as total, SUM(CASE WHEN stock < 5 THEN 1 ELSE 0 END) as low FROM products'
    );
    res.json({ total: Number(stock[0].total), low: Number(stock[0].low) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (!rows.length || (!rows[0].active && !(await isAdminRequest(req))))
      return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(parseProduct(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// POST /api/products
router.post('/', adminOnly, async (req, res) => {
  try {
    const { name, description, price, originalPrice, wholesalePrice, stock, category, categories, brand, sizes, colors, variants, images, imageFocus, video, videoPosition, videos, material, reference, tags, active, featured, isNew } = req.body;
    const cat = normalizeCategories(categories, category);
    // La marca es obligatoria: sin ella el producto no sale en el filtro de
    // marcas de la tienda, así que no dejamos que entre a medias en la BD.
    if (!name || !price || !cat.primary || !brand)
      return res.status(400).json({ error: 'name, price, al menos una categoría y brand son requeridos' });

    const vids = normalizeVideos(videos, video, videoPosition, images);
    const focus = sanitizeImageFocus(imageFocus, images);
    const vars = sanitizeVariants(variants);
    const der  = deriveFromVariants(vars, sizes, colors, stock);

    const [result] = await pool.execute(
      `INSERT INTO products (name,description,price,original_price,wholesale_price,stock,category,categories,brand,sizes,colors,variants,images,image_focus,video,video_position,videos,material,reference,tags,active,featured,is_new)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [name, description || null, Number(price),
       originalPrice ? Number(originalPrice) : null,
       wholesalePrice ? Number(wholesalePrice) : null,
       der.stock, cat.primary, JSON.stringify(cat.list), brand || null,
       JSON.stringify(der.sizes), JSON.stringify(der.colors), JSON.stringify(vars), JSON.stringify(images || []),
       JSON.stringify(focus),
       vids[0]?.url || null, vids[0] ? vids[0].position : null, JSON.stringify(vids),
       material || null, reference || null, JSON.stringify(tags || []),
       active !== false ? 1 : 0, featured ? 1 : 0, isNew ? 1 : 0]
    );
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [result.insertId]);
    res.status(201).json(parseProduct(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// PUT /api/products/:id
router.put('/:id', adminOnly, async (req, res) => {
  const { name, description, price, originalPrice, wholesalePrice, stock, category, categories, brand, sizes, colors, variants, images, imageFocus, video, videoPosition, videos, material, reference, tags, active, featured, isNew, baseVariants, baseStock } = req.body;
  const cat = normalizeCategories(categories, category);
  if (!name || !price || !cat.primary || !brand)
    return res.status(400).json({ error: 'name, price, al menos una categoría y brand son requeridos' });

  // Transacción con la fila bloqueada: un pedido no puede descontar stock entre
  // que se lee el inventario actual y se guarda el nuevo.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[current]] = await conn.execute('SELECT id, stock, variants FROM products WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!current) { await conn.rollback(); return res.status(404).json({ error: 'Producto no encontrado' }); }

    const vids = normalizeVideos(videos, video, videoPosition, images);
    const focus = sanitizeImageFocus(imageFocus, images);
    const vars = mergeVariantStock(sanitizeVariants(variants), baseVariants, current.variants);
    const der  = deriveFromVariants(vars, sizes, colors, mergePlainStock(stock, baseStock, current.stock));

    await conn.execute(
      `UPDATE products SET name=?,description=?,price=?,original_price=?,wholesale_price=?,stock=?,category=?,categories=?,brand=?,
       sizes=?,colors=?,variants=?,images=?,image_focus=?,video=?,video_position=?,videos=?,material=?,reference=?,tags=?,active=?,featured=?,is_new=?
       WHERE id=?`,
      [name, description || null, Number(price),
       originalPrice ? Number(originalPrice) : null,
       wholesalePrice ? Number(wholesalePrice) : null,
       der.stock, cat.primary, JSON.stringify(cat.list), brand || null,
       JSON.stringify(der.sizes), JSON.stringify(der.colors), JSON.stringify(vars), JSON.stringify(images || []),
       JSON.stringify(focus),
       vids[0]?.url || null, vids[0] ? vids[0].position : null, JSON.stringify(vids),
       material || null, reference || null, JSON.stringify(tags || []),
       active !== false ? 1 : 0, featured ? 1 : 0, isNew ? 1 : 0, req.params.id]
    );
    await conn.commit();
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    res.json(parseProduct(rows[0]));
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar producto' });
  } finally {
    conn.release();
  }
});

// DELETE /api/products/:id
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const [exists] = await pool.execute('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if (!exists.length) return res.status(404).json({ error: 'Producto no encontrado' });
    await pool.execute('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

module.exports = router;
