const pool     = require('../db/connection');
const stripe   = require('./stripe');
const mailer   = require('./mailer');
const telegram = require('./telegram');

// Minutos que un pedido con tarjeta puede quedarse sin pagar apartando
// inventario. Pasado ese tiempo se cancela solo y el stock vuelve a la venta.
const STRIPE_ORDER_TTL_MIN = Math.max(15, Number(process.env.STRIPE_ORDER_TTL_MIN) || 60);

// Deja en el log de Vercel los avisos (correo/Telegram) que fallaron.
const logFailures = label => results => results.forEach(r => {
  if (r.status === 'rejected') console.error(`[avisos] ${label}:`, r.reason?.message || r.reason);
  else if (r.value && r.value.ok === false) console.error(`[avisos] ${label}: telegram`, r.value.description);
});

function parseOrder(row) {
  return {
    id:              row.id,
    userId:          row.user_id,
    userName:        row.user_name,
    userEmail:       row.user_email,
    items:           row.items        || [],
    subtotal:        Number(row.subtotal || 0),
    shippingCost:    Number(row.shipping_cost || 0),
    shippingState:   row.shipping_state || null,
    couponCode:      row.coupon_code || null,
    discountAmount:  Number(row.discount_amount || 0),
    total:           Number(row.total),
    shippingInfo:    row.shipping_info || {},
    notes:           row.notes         || '',
    paymentMethod:   row.payment_method || 'whatsapp',
    paymentStatus:   row.payment_status || 'unpaid',
    stripeIntentId:  row.stripe_intent_id || null,
    status:          row.status,
    delayed:         !!row.is_delayed,
    delayNote:       row.delay_note || '',
    trackingCarrier: row.tracking_carrier || '',
    trackingNumber:  row.tracking_number || '',
    cancelReason:    row.cancel_reason || '',
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

// Ajusta el inventario de un ítem de pedido al cancelar (sign=+1, restaura) o
// des-cancelar (sign=-1, vuelve a descontar). Si el producto lleva inventario por
// talla, ajusta esa talla+color+opción y recalcula el stock total; si no, ajusta
// el stock del producto. Debe llamarse dentro de una transacción con la fila
// del producto ya bloqueable (usa FOR UPDATE).
async function adjustProductStock(conn, item, sign) {
  const [[prod]] = await conn.execute('SELECT id, name, stock, variants FROM products WHERE id = ? FOR UPDATE', [item.productId]);
  if (!prod) return { ok: true }; // producto borrado: nada que ajustar
  const qty = Math.max(0, Number(item.qty || 0));
  const variants = Array.isArray(prod.variants) ? prod.variants : [];
  const isTracked = variants.some(v => Array.isArray(v.sizes) && v.sizes.some(s => s && typeof s === 'object' && s.stock != null));
  if (isTracked) {
    const variant = variants.find(v => (v.color || '') === (item.color || '') && (v.option || '') === (item.option || ''));
    const se = variant && Array.isArray(variant.sizes) ? variant.sizes.find(s => s && typeof s === 'object' && s.size === (item.size || '')) : null;
    if (se && se.stock != null) {
      if (sign < 0 && se.stock < qty) return { ok: false, name: prod.name };
      se.stock = Math.max(0, se.stock + sign * qty);
    }
    let sum = 0;
    for (const v of variants) for (const s of (v.sizes || [])) if (s && typeof s === 'object' && s.stock != null) sum += s.stock;
    await conn.execute('UPDATE products SET variants = ?, stock = ? WHERE id = ?', [JSON.stringify(variants), sum, prod.id]);
  } else {
    const cur = Number(prod.stock) || 0;
    if (sign < 0 && cur < qty) return { ok: false, name: prod.name };
    await conn.execute('UPDATE products SET stock = ? WHERE id = ?', [Math.max(0, cur + sign * qty), prod.id]);
  }
  return { ok: true };
}

// Al cancelar: devuelve el inventario y el uso del cupón. `row` es la fila del
// pedido ya bloqueada (FOR UPDATE) dentro de la transacción de `conn`.
async function releaseOrder(conn, row) {
  for (const it of (row.items || [])) await adjustProductStock(conn, it, +1);
  if (row.coupon_code) await conn.execute('UPDATE coupons SET uses = GREATEST(uses - 1, 0) WHERE code = ?', [row.coupon_code]);
}

// Al des-cancelar: vuelve a apartar el inventario y el cupón. Devuelve false
// (sin dejar nada a medias si el caller hace rollback) si ya no alcanza el stock.
async function reclaimOrder(conn, row) {
  for (const it of (row.items || [])) {
    const r = await adjustProductStock(conn, it, -1);
    if (!r.ok) return false;
  }
  if (row.coupon_code) await conn.execute('UPDATE coupons SET uses = uses + 1 WHERE code = ?', [row.coupon_code]);
  return true;
}

// Marca un pedido como pagado (webhook de Stripe o revisión de un pago que se
// quedó sin aviso) y manda los avisos. Solo la primera vez: si Stripe reintenta
// el evento no se repiten. Si el pedido ya se había cancelado por expirar,
// intenta volver a apartar el inventario; si ya no hay, lo deja cancelado y
// avisa al admin para que reembolse.
async function markOrderPaid(orderId) {
  const conn = await pool.getConnection();
  let row, outOfStock = false;
  try {
    await conn.beginTransaction();
    [[row]] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!row || row.payment_status === 'paid' || row.payment_status === 'refunded') {
      await conn.rollback();
      return null;
    }
    let status = 'confirmed';
    if (row.status === 'cancelled') {
      if (!(await reclaimOrder(conn, row))) {
        await conn.rollback();
        await conn.beginTransaction();
        outOfStock = true;
        status = 'cancelled';
      }
    } else if (row.status !== 'pending') {
      status = row.status; // ya iba más adelante (lo movió el admin): no lo regresamos
    }
    await conn.execute('UPDATE orders SET payment_status = "paid", status = ? WHERE id = ?', [status, orderId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [[fresh]] = await pool.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
  const order = parseOrder(fresh);
  const avisos = outOfStock
    ? [telegram.sendTelegram(`⚠️ <b>PAGO RECIBIDO EN PEDIDO CANCELADO</b> #${order.id}\nEl pedido había expirado y ya no hay inventario para surtirlo. Reembolsa el pago desde el panel o contacta a la clienta.`),
       mailer.sendOrderToAdmin(order)]
    : [mailer.sendOrderToCustomer(order), mailer.sendOrderToAdmin(order), telegram.notifyNewOrder(order)];
  // Se esperan antes de responder: en Vercel la función se congela al responder.
  await Promise.allSettled(avisos).then(logFailures('venta pagada ' + order.id));
  return order;
}

// Cancela los pedidos con tarjeta que nadie pagó dentro del plazo, para que no
// aparten inventario para siempre. Antes de cancelar pregunta a Stripe: si el
// pago sí entró (y el aviso se perdió) lo marca pagado; si sigue procesándose,
// lo deja; si no, cancela el intento de pago para que ya no se pueda cobrar.
async function expireStaleOrders(limit = 10) {
  const [rows] = await pool.execute(
    `SELECT id, stripe_intent_id FROM orders
      WHERE payment_method = 'stripe' AND payment_status IN ('unpaid','failed') AND status = 'pending'
        AND created_at < (NOW() - INTERVAL ${STRIPE_ORDER_TTL_MIN} MINUTE)
      ORDER BY created_at ASC LIMIT ${Math.max(1, Math.min(50, Number(limit) || 10))}`
  );
  const result = { expired: [], paid: [], skipped: [] };
  for (const { id, stripe_intent_id: intentId } of rows) {
    if (intentId && stripe) {
      try {
        const pi = await stripe.paymentIntents.retrieve(intentId);
        if (pi.status === 'succeeded') { await markOrderPaid(id); result.paid.push(id); continue; }
        if (pi.status === 'processing') { result.skipped.push(id); continue; }
        if (pi.status !== 'canceled') await stripe.paymentIntents.cancel(intentId);
      } catch (err) {
        // Sin poder confirmar con Stripe no se cancela: se reintenta la próxima vez.
        console.error('[expirar] stripe', id, err.message);
        result.skipped.push(id);
        continue;
      }
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[row]] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
      if (!row || row.status !== 'pending' || row.payment_status === 'paid') { await conn.rollback(); continue; }
      await releaseOrder(conn, row);
      await conn.execute(
        `UPDATE orders SET status = 'cancelled', cancel_reason = 'Pago con tarjeta no completado a tiempo' WHERE id = ?`, [id]);
      await conn.commit();
      result.expired.push(id);
    } catch (err) {
      await conn.rollback();
      console.error('[expirar]', id, err.message);
    } finally {
      conn.release();
    }
  }
  return result;
}

module.exports = {
  parseOrder, adjustProductStock, releaseOrder, reclaimOrder,
  markOrderPaid, expireStaleOrders, logFailures, STRIPE_ORDER_TTL_MIN,
};
