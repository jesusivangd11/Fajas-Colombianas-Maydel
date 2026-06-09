const router = require('express').Router();
const pool   = require('../db/connection');
const { authenticate } = require('../middleware/auth');

// GET /api/wishlist
router.get('/', authenticate, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT w.product_id, p.name, p.price, p.original_price, p.images, p.category, p.stock, p.is_new
     FROM wishlist w JOIN products p ON p.id = w.product_id
     WHERE w.user_id = ? AND p.active = 1
     ORDER BY w.created_at DESC`,
    [req.user.id]
  );
  res.json(rows.map(r => ({
    id: r.product_id, name: r.name, price: Number(r.price), originalPrice: r.original_price ? Number(r.original_price) : null,
    images: r.images || [], category: r.category, stock: r.stock, isNew: !!r.is_new,
  })));
});

// POST /api/wishlist  { productId }
router.post('/', authenticate, async (req, res) => {
  const productId = Number(req.body.productId);
  if (!productId) return res.status(400).json({ error: 'productId requerido' });
  try {
    await pool.execute('INSERT INTO wishlist (user_id, product_id) VALUES (?,?)', [req.user.id, productId]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.json({ ok: true });
    if (e.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'Producto no encontrado' });
    console.error(e);
    res.status(500).json({ error: 'Error al guardar' });
  }
});

// DELETE /api/wishlist/:productId
router.delete('/:productId', authenticate, async (req, res) => {
  await pool.execute('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?', [req.user.id, Number(req.params.productId)]);
  res.json({ ok: true });
});

module.exports = router;
