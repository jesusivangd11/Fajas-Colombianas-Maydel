const router = require('express').Router();
const pool   = require('../db/connection');
const { authenticate, adminOnly } = require('../middleware/auth');
const { evaluateCoupon, COUPON_TYPES } = require('../services/coupons');

function parse(r) {
  return {
    id: r.id, code: r.code, description: r.description,
    discountType: r.discount_type, discountValue: Number(r.discount_value),
    minSubtotal: Number(r.min_subtotal), maxUses: r.max_uses, uses: r.uses,
    expiresAt: r.expires_at, active: !!r.active,
  };
}

// POST /api/coupons/validate  { code, subtotal }
router.post('/validate', async (req, res) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) return res.status(400).json({ error: 'Codigo requerido' });
    res.json(await evaluateCoupon(code, subtotal));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err); res.status(500).json({ error: 'Error al validar' });
  }
});

// ADMIN: CRUD
router.get('/', adminOnly, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM coupons ORDER BY created_at DESC');
  res.json(rows.map(parse));
});

router.post('/', adminOnly, async (req, res) => {
  const { code, description, discountType, discountValue, minSubtotal, maxUses, expiresAt, active } = req.body;
  const type = COUPON_TYPES.includes(discountType) ? discountType : 'percent';
  if (!code || (type !== 'free_shipping' && !discountValue))
    return res.status(400).json({ error: 'Codigo y descuento requeridos' });
  try {
    await pool.execute(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_subtotal, max_uses, expires_at, active)
       VALUES (?,?,?,?,?,?,?,?)`,
      [String(code).trim().toUpperCase(), description || '', type,
       type === 'free_shipping' ? 0 : Number(discountValue), Number(minSubtotal || 0), maxUses || null, expiresAt || null, active ? 1 : 0]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.code === 'ER_DUP_ENTRY' ? 'Cupon ya existe' : e.message });
  }
});

router.delete('/:id', adminOnly, async (req, res) => {
  await pool.execute('DELETE FROM coupons WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
