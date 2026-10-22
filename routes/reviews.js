const router = require('express').Router();
const pool   = require('../db/connection');
const { authenticate, adminOnly, optionalAuth } = require('../middleware/auth');

function parseReview(r) {
  return {
    id: r.id, userId: r.user_id, productId: r.product_id,
    author: r.author_name, rating: r.rating, text: r.text,
    approved: !!r.approved, featured: !!r.featured, createdAt: r.created_at,
  };
}

// GET /api/reviews?featured=1|product=N|all=1 (all requiere admin)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { featured, product } = req.query;
    // Las reseñas sin aprobar solo las ve el admin.
    const all = req.user?.role === 'admin' ? req.query.all : undefined;
    let where = 'WHERE approved = 1';
    const params = [];
    if (featured) where += ' AND featured = 1';
    if (product)  { where += ' AND product_id = ?'; params.push(Number(product)); }
    if (all === '1') where = '';
    const [rows] = await pool.execute(`SELECT * FROM reviews ${where} ORDER BY featured DESC, created_at DESC LIMIT 50`, params);
    res.json(rows.map(parseReview));
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al obtener reseñas' });
  }
});

// GET /api/reviews/admin (todas, para moderación)
router.get('/admin', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM reviews ORDER BY created_at DESC');
    res.json(rows.map(parseReview));
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al obtener reseñas' });
  }
});

// ¿La clienta compró este producto? Cuenta un pedido pagado o que la tienda ya
// confirmó/envió/entregó. Así "reseñas verificadas" es literalmente cierto.
async function boughtProduct(userId, productId) {
  const [orders] = await pool.execute(
    `SELECT items FROM orders WHERE user_id = ? AND status <> 'cancelled'
       AND (payment_status = 'paid' OR status IN ('confirmed','processing','shipped','delivered'))`,
    [userId]
  );
  return orders.some(o => (o.items || []).some(i => Number(i.productId) === Number(productId)));
}

// GET /api/reviews/can-review?product=N  -> ¿puede reseñarlo la clienta con sesión?
router.get('/can-review', authenticate, async (req, res) => {
  try {
    const productId = Number(req.query.product);
    if (!productId) return res.json({ canReview: false, reason: 'Producto inválido' });
    const [mine] = await pool.execute('SELECT id FROM reviews WHERE user_id = ? AND product_id = ? LIMIT 1', [req.user.id, productId]);
    if (mine.length) return res.json({ canReview: false, reason: 'Ya dejaste tu reseña de este producto. ¡Gracias!' });
    if (!(await boughtProduct(req.user.id, productId)))
      return res.json({ canReview: false, reason: 'Solo las clientas que compraron este producto pueden reseñarlo.' });
    res.json({ canReview: true });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al verificar' });
  }
});

// POST /api/reviews   (clienta con sesión que compró el producto)
router.post('/', authenticate, async (req, res) => {
  try {
    const { rating, text } = req.body;
    const productId = Number(req.body.productId);
    if (!productId) return res.status(400).json({ error: 'Producto requerido' });
    const r = Math.max(1, Math.min(5, Math.round(Number(rating)) || 5));
    if (!text || String(text).trim().length < 10) return res.status(400).json({ error: 'La reseña debe tener al menos 10 caracteres' });
    const [mine] = await pool.execute('SELECT id FROM reviews WHERE user_id = ? AND product_id = ? LIMIT 1', [req.user.id, productId]);
    if (mine.length) return res.status(409).json({ error: 'Ya dejaste tu reseña de este producto' });
    if (!(await boughtProduct(req.user.id, productId)))
      return res.status(403).json({ error: 'Solo las clientas que compraron este producto pueden reseñarlo' });
    await pool.execute(
      'INSERT INTO reviews (user_id, product_id, author_name, rating, text, approved) VALUES (?,?,?,?,?,0)',
      [req.user.id, productId, req.user.name, r, String(text).trim().slice(0, 1000)]
    );
    res.status(201).json({ ok: true, message: 'Gracias! Tu reseña esta pendiente de aprobacion.' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al guardar reseña' });
  }
});

// PUT /api/reviews/:id (admin: aprobar / destacar / editar)
router.put('/:id', adminOnly, async (req, res) => {
  const { approved, featured, text, rating } = req.body;
  const fields = []; const params = [];
  if (approved !== undefined) { fields.push('approved = ?'); params.push(approved ? 1 : 0); }
  if (featured !== undefined) { fields.push('featured = ?'); params.push(featured ? 1 : 0); }
  if (text)   { fields.push('text = ?');   params.push(String(text).slice(0,1000)); }
  if (rating) { fields.push('rating = ?'); params.push(Math.max(1,Math.min(5,Number(rating)))); }
  if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
  params.push(req.params.id);
  try {
    await pool.execute(`UPDATE reviews SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al actualizar reseña' });
  }
});

// DELETE /api/reviews/:id
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await pool.execute('DELETE FROM reviews WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al eliminar reseña' });
  }
});

module.exports = router;
