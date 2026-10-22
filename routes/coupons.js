const router = require('express').Router();
const pool   = require('../db/connection');
const { adminOnly, optionalAuth } = require('../middleware/auth');
const { evaluateCoupon, COUPON_TYPES } = require('../services/coupons');

function parse(r) {
  return {
    id: r.id, code: r.code, description: r.description,
    discountType: r.discount_type, discountValue: Number(r.discount_value),
    minSubtotal: Number(r.min_subtotal), maxUses: r.max_uses, uses: r.uses,
    expiresAt: r.expires_at, active: !!r.active, oncePerUser: !!r.once_per_user,
  };
}

// POST /api/coupons/validate  { code, subtotal }
router.post('/validate', optionalAuth, async (req, res) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) return res.status(400).json({ error: 'Codigo requerido' });
    res.json(await evaluateCoupon(code, subtotal, undefined, false, req.user?.id || null));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err); res.status(500).json({ error: 'Error al validar' });
  }
});

// ADMIN: CRUD
router.get('/', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json(rows.map(parse));
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al obtener cupones' });
  }
});

router.post('/', adminOnly, async (req, res) => {
  const { code, description, discountType, discountValue, minSubtotal, maxUses, expiresAt, active, oncePerUser } = req.body;
  const type = COUPON_TYPES.includes(discountType) ? discountType : 'percent';
  if (!code || (type !== 'free_shipping' && !discountValue))
    return res.status(400).json({ error: 'Codigo y descuento requeridos' });
  try {
    await pool.execute(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_subtotal, max_uses, expires_at, active, once_per_user)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [String(code).trim().toUpperCase(), description || '', type,
       type === 'free_shipping' ? 0 : Number(discountValue), Number(minSubtotal || 0), maxUses || null, expiresAt || null, active ? 1 : 0,
       oncePerUser ? 1 : 0]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.code === 'ER_DUP_ENTRY' ? 'Cupon ya existe' : e.message });
  }
});

// PUT /api/coupons/:id  { active?, oncePerUser? }  (admin: activar/pausar)
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const fields = [], params = [];
    if (req.body.active !== undefined)      { fields.push('active = ?');        params.push(req.body.active ? 1 : 0); }
    if (req.body.oncePerUser !== undefined) { fields.push('once_per_user = ?'); params.push(req.body.oncePerUser ? 1 : 0); }
    if (!fields.length) return res.status(400).json({ error: 'Nada que actualizar' });
    params.push(req.params.id);
    await pool.execute(`UPDATE coupons SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al actualizar cupón' });
  }
});

router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await pool.execute('DELETE FROM coupons WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Error al eliminar cupón' });
  }
});

module.exports = router;
