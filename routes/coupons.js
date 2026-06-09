const router = require('express').Router();
const pool   = require('../db/connection');
const { authenticate, adminOnly } = require('../middleware/auth');

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
    const [rows] = await pool.execute(
      `SELECT * FROM coupons WHERE code = ? AND active = 1
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (max_uses IS NULL OR uses < max_uses)`,
      [String(code).trim().toUpperCase()]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cupon invalido o expirado' });
    const c = rows[0];
    const sub = Number(subtotal || 0);
    if (sub < Number(c.min_subtotal)) {
      return res.status(400).json({ error: `Compra minima de $${c.min_subtotal} para usar este cupon` });
    }
    const discount = c.discount_type === 'percent'
      ? Math.round((sub * Number(c.discount_value) / 100) * 100) / 100
      : Number(c.discount_value);
    res.json({
      ok: true, code: c.code, description: c.description,
      discountType: c.discount_type, discountValue: Number(c.discount_value),
      discountAmount: Math.min(discount, sub),
    });
  } catch (err) {
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
  if (!code || !discountValue) return res.status(400).json({ error: 'Codigo y descuento requeridos' });
  try {
    await pool.execute(
      `INSERT INTO coupons (code, description, discount_type, discount_value, min_subtotal, max_uses, expires_at, active)
       VALUES (?,?,?,?,?,?,?,?)`,
      [String(code).trim().toUpperCase(), description || '', discountType || 'percent',
       Number(discountValue), Number(minSubtotal || 0), maxUses || null, expiresAt || null, active ? 1 : 0]
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
