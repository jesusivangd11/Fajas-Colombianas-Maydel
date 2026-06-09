const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const pool   = require('../db/connection');
const { adminOnly } = require('../middleware/auth');

function parseProduct(row) {
  return {
    id:            row.id,
    name:          row.name,
    description:   row.description || '',
    price:         Number(row.price),
    originalPrice: row.original_price ? Number(row.original_price) : null,
    stock:         row.stock,
    category:      row.category || '',
    brand:         row.brand || '',
    sizes:         row.sizes  || [],
    colors:        row.colors || [],
    images:        row.images || [],
    video:         row.video || '',
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

function isAdminRequest(req) {
  try {
    const token = req.cookies?.maydel_token;
    if (!token) return false;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.role === 'admin';
  } catch { return false; }
}

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const admin = isAdminRequest(req);
    const { q, cat, brand, sort, minPrice, maxPrice, ids, exclude, limit } = req.query;

    // Búsqueda por IDs específicos (para el carrito)
    if (ids) {
      const idList = ids.split(',').map(Number).filter(Boolean);
      if (!idList.length) return res.json([]);
      const placeholders = idList.map(() => '?').join(',');
      const [rows] = await pool.execute(
        `SELECT * FROM products WHERE id IN (${placeholders})`,
        idList
      );
      return res.json(rows.map(parseProduct));
    }

    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (!admin)   { sql += ' AND active = 1'; }
    if (cat)      { sql += ' AND category = ?'; params.push(cat); }
    if (brand)    { sql += ' AND brand = ?'; params.push(brand); }
    if (exclude)  { sql += ' AND id != ?'; params.push(Number(exclude)); }
    if (minPrice) { sql += ' AND price >= ?'; params.push(Number(minPrice)); }
    if (maxPrice) { sql += ' AND price <= ?'; params.push(Number(maxPrice)); }

    const sortMap = {
      'price-asc':  'price ASC',
      'price-desc': 'price DESC',
      'name':       'name ASC',
      'newest':     'created_at DESC',
    };
    sql += ` ORDER BY ${sortMap[sort] || 'created_at DESC'}`;
    if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }

    const [rows] = await pool.execute(sql, params);
    let products = rows.map(parseProduct);

    if (q) {
      const query = q.toLowerCase();
      products = products.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query) ||
        p.tags.some(t => t.toLowerCase().includes(query))
      );
    }

    res.json(products);
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
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(parseProduct(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// POST /api/products
router.post('/', adminOnly, async (req, res) => {
  try {
    const { name, description, price, originalPrice, stock, category, brand, sizes, colors, images, video, material, reference, tags, active, featured, isNew } = req.body;
    if (!name || !price || !category) return res.status(400).json({ error: 'name, price y category son requeridos' });

    const [result] = await pool.execute(
      `INSERT INTO products (name,description,price,original_price,stock,category,brand,sizes,colors,images,video,material,reference,tags,active,featured,is_new)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [name, description || null, Number(price),
       originalPrice ? Number(originalPrice) : null,
       Number(stock) || 0, category, brand || null,
       JSON.stringify(sizes || []), JSON.stringify(colors || []), JSON.stringify(images || []),
       video || null,
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
  try {
    const { name, description, price, originalPrice, stock, category, brand, sizes, colors, images, video, material, reference, tags, active, featured, isNew } = req.body;
    const [exists] = await pool.execute('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if (!exists.length) return res.status(404).json({ error: 'Producto no encontrado' });

    await pool.execute(
      `UPDATE products SET name=?,description=?,price=?,original_price=?,stock=?,category=?,brand=?,
       sizes=?,colors=?,images=?,video=?,material=?,reference=?,tags=?,active=?,featured=?,is_new=?
       WHERE id=?`,
      [name, description || null, Number(price),
       originalPrice ? Number(originalPrice) : null,
       Number(stock) || 0, category, brand || null,
       JSON.stringify(sizes || []), JSON.stringify(colors || []), JSON.stringify(images || []),
       video || null,
       material || null, reference || null, JSON.stringify(tags || []),
       active !== false ? 1 : 0, featured ? 1 : 0, isNew ? 1 : 0, req.params.id]
    );
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    res.json(parseProduct(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar producto' });
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
