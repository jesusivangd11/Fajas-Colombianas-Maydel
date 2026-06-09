const router = require('express').Router();
const pool   = require('../db/connection');
const { authenticate } = require('../middleware/auth');

// GET /api/cart  - obtiene carrito del usuario logueado
router.get('/', authenticate, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT ci.id, ci.product_id, ci.qty, ci.size, ci.color, p.name, p.price, p.images, p.stock
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.user_id = ?`,
    [req.user.id]
  );
  res.json(rows.map(r => ({
    productId: r.product_id, qty: r.qty, size: r.size || '', color: r.color || '',
    product: { id: r.product_id, name: r.name, price: Number(r.price), images: r.images || [], stock: r.stock }
  })));
});

// PUT /api/cart  - sobrescribe el carrito completo
router.put('/', authenticate, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);
    for (const it of items) {
      const qty = Math.max(1, Number(it.qty) || 1);
      try {
        await conn.execute(
          'INSERT INTO cart_items (user_id, product_id, qty, size, color) VALUES (?,?,?,?,?)',
          [req.user.id, Number(it.productId), qty, it.size || '', it.color || '']
        );
      } catch (e) { /* unique violation: ya existe, hacer update */
        await conn.execute(
          'UPDATE cart_items SET qty = ? WHERE user_id=? AND product_id=? AND size=? AND color=?',
          [qty, req.user.id, Number(it.productId), it.size || '', it.color || '']
        );
      }
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback(); console.error(err); res.status(500).json({ error: 'Error al guardar carrito' });
  } finally { conn.release(); }
});

// DELETE /api/cart - vaciar
router.delete('/', authenticate, async (req, res) => {
  await pool.execute('DELETE FROM cart_items WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
