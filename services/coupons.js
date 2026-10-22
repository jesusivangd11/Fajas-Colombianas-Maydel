const pool = require('../db/connection');

// Tipos de cupón: 'percent' (% del subtotal), 'fixed' (monto fijo) y
// 'free_shipping' (el envío sale en $0; no descuenta del subtotal).
const COUPON_TYPES = ['percent', 'fixed', 'free_shipping'];

/* Busca un cupón vigente y calcula su efecto sobre `subtotal`.
   Lanza Error (con .status) si no existe, expiró, se agotó o no llega a la compra
   mínima. Dentro de una transacción pasa `db = conn` y `lock = true` para que dos
   pedidos simultáneos no rebasen max_uses. */
async function evaluateCoupon(code, subtotal, db = pool, lock = false) {
  const [rows] = await db.execute(
    `SELECT * FROM coupons WHERE code = ? AND active = 1
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (max_uses IS NULL OR uses < max_uses)${lock ? ' FOR UPDATE' : ''}`,
    [String(code || '').trim().toUpperCase()]
  );
  if (!rows.length) throw Object.assign(new Error('Cupón inválido o expirado'), { status: 404 });
  const c = rows[0];
  const sub = Number(subtotal || 0);
  if (sub < Number(c.min_subtotal)) {
    throw Object.assign(new Error(`Compra mínima de $${Number(c.min_subtotal)} para usar este cupón`), { status: 400 });
  }
  let discount = 0;
  if (c.discount_type === 'percent') discount = Math.round(sub * Number(c.discount_value)) / 100;
  else if (c.discount_type === 'fixed') discount = Number(c.discount_value);
  return {
    ok: true, code: c.code, description: c.description,
    discountType: c.discount_type, discountValue: Number(c.discount_value),
    discountAmount: Math.min(discount, sub),
    freeShipping: c.discount_type === 'free_shipping',
  };
}

module.exports = { evaluateCoupon, COUPON_TYPES };
