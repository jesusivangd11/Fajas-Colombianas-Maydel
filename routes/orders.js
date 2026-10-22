const router = require('express').Router();
const pool   = require('../db/connection');
const { authenticate, adminOnly } = require('../middleware/auth');
const { quoteShipping } = require('../services/shipping');
const { evaluateCoupon } = require('../services/coupons');
const { waitUntil } = require('@vercel/functions');
const stripe = require('../services/stripe');
const {
  parseOrder, releaseOrder, reclaimOrder, expireStaleOrders, logFailures,
} = require('../services/orders');
const mailer = require('../services/mailer');
const telegram = require('../services/telegram');

// Piezas mínimas de un mismo producto (sumando tallas/colores) para precio de mayoreo.
const WHOLESALE_MIN = 6;
// Tope de piezas por renglón del carrito (evita pedidos absurdos que vacían el inventario).
const MAX_QTY_PER_ITEM = 50;
const MAX_ITEMS = 40;

// Recorta texto libre del cliente al tamaño de su columna.
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

// Libera pedidos con tarjeta abandonados. Se llama al crear un pedido (para que
// el stock apartado vuelva a estar disponible) y al abrir el panel; además corre
// una vez al día por el cron de Vercel (/api/checkout/expire-orders).
async function expireQuietly() {
  try { await expireStaleOrders(5); } catch (err) { console.error('[expirar]', err.message); }
}

// GET /api/orders  (admin: todos | user: propios)
router.get('/', authenticate, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      await expireQuietly();
      [rows] = await pool.execute('SELECT * FROM orders ORDER BY created_at DESC');
    } else {
      [rows] = await pool.execute(
        'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
        [req.user.id]
      );
    }
    res.json(rows.map(parseOrder));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener pedidos' });
  }
});

// GET /api/orders/export.csv  (admin)
router.get('/export.csv', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM orders ORDER BY created_at DESC');
    // Una celda que empieza con = + - @ Excel la ejecuta como fórmula: se antepone ' .
    const esc = v => {
      let s = String(v ?? '').replace(/\r?\n/g, ' ');
      if (/^[=+\-@\t]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ['id','fecha','cliente','email','telefono','estado_envio','direccion','subtotal','descuento','cupon','envio','total','metodo_pago','estado_pago','estado','paqueteria','guia','items'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const items = (r.items || []).map(i => `${i.productName} x${i.qty}${i.size ? ` (${i.size})`:''}`).join(' | ');
      const ship  = r.shipping_info || {};
      lines.push([
        r.id, new Date(r.created_at).toISOString(), r.user_name, r.user_email,
        ship.phone || '', r.shipping_state || '', ship.address || '',
        r.subtotal, r.discount_amount || 0, r.coupon_code || '', r.shipping_cost, r.total,
        r.payment_method, r.payment_status, r.status, r.tracking_carrier || '', r.tracking_number || '', items
      ].map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pedidos_${Date.now()}.csv"`);
    res.send('﻿' + lines.join('\n')); // BOM para Excel
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al exportar pedidos' });
  }
});

// GET /api/orders/stats  (admin)
// Un pedido con tarjeta que no se ha pagado no es venta: no cuenta como ingreso.
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        COUNT(*)                                                     AS total,
        SUM(status = 'pending')                                      AS pending,
        SUM(status = 'confirmed')                                    AS confirmed,
        SUM(status = 'processing')                                   AS processing,
        SUM(status = 'shipped')                                      AS shipped,
        SUM(status = 'delivered')                                    AS delivered,
        SUM(status = 'cancelled')                                    AS cancelled,
        COALESCE(SUM(CASE WHEN status='delivered'  THEN total END),0) AS revenue,
        COALESCE(SUM(CASE WHEN status!='cancelled' AND payment_status <> 'refunded'
                           AND (payment_method <> 'stripe' OR payment_status = 'paid') THEN total END),0) AS allRevenue
      FROM orders
    `);
    const s = rows[0];
    res.json({
      total: Number(s.total), pending: Number(s.pending), confirmed: Number(s.confirmed),
      processing: Number(s.processing), shipped: Number(s.shipped), delivered: Number(s.delivered),
      cancelled: Number(s.cancelled), revenue: Number(s.revenue), allRevenue: Number(s.allRevenue),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener estadisticas' });
  }
});

// POST /api/orders   (crea pedido con descuento atomico de stock)
router.post('/', authenticate, async (req, res) => {
  const { items, shippingInfo, shippingState, notes, paymentMethod, couponCode } = req.body;
  const userName = clip(req.body.userName, 100);
  if (!userName || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Datos del pedido incompletos' });
  if (items.length > MAX_ITEMS) return res.status(400).json({ error: 'Demasiados productos en un solo pedido' });

  // Antes de apartar inventario, soltar el que tengan pedidos con tarjeta abandonados.
  await expireQuietly();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Piezas enteras, entre 1 y el tope (un 1.5 o un 10000 no deben llegar a la BD).
    const qtyOf = it => Math.min(MAX_QTY_PER_ITEM, Math.max(1, Math.floor(Number(it.qty)) || 1));

    // Total de piezas por producto (combinando tallas/colores) para el mayoreo.
    const qtyByProduct = {};
    for (const it of items) {
      const pid = it.productId;
      qtyByProduct[pid] = (qtyByProduct[pid] || 0) + qtyOf(it);
    }

    // Bloquear cada producto UNA vez y guardarlo en memoria. El inventario se
    // descuenta sobre esta copia (por talla si la variante lo maneja, o del stock
    // del producto si no) y al final se escribe de vuelta.
    const prodMap = new Map();
    for (const it of items) {
      if (prodMap.has(it.productId)) continue;
      const [[prod]] = await conn.execute(
        'SELECT id, name, price, wholesale_price, stock, active, variants FROM products WHERE id = ? FOR UPDATE',
        [it.productId]
      );
      if (!prod) throw new Error(`Producto ${it.productId} no encontrado`);
      if (!prod.active) throw new Error(`"${prod.name}" ya no esta disponible`);
      const variants = Array.isArray(prod.variants) ? prod.variants : [];
      // ¿Este producto lleva inventario por talla? (alguna talla con stock numérico)
      const isTracked = variants.some(v => Array.isArray(v.sizes) && v.sizes.some(s => s && typeof s === 'object' && s.stock != null));
      prodMap.set(it.productId, { row: prod, variants, stock: Number(prod.stock) || 0, isTracked, changed: false });
    }

    let subtotal = 0;
    const enriched = [];
    for (const it of items) {
      const entry = prodMap.get(it.productId);
      const prod = entry.row;
      const qty = qtyOf(it);
      const size = clip(it.size, 40), color = clip(it.color, 60), option = clip(it.option, 60);
      const variant = entry.variants.find(v => (v.color || '') === color && (v.option || '') === option);

      // Descontar inventario
      if (entry.isTracked) {
        const sizeEntry = variant && Array.isArray(variant.sizes)
          ? variant.sizes.find(s => s && typeof s === 'object' && s.size === size)
          : null;
        if (!sizeEntry || sizeEntry.stock == null)
          throw new Error(`La combinación de "${prod.name}"${color ? ' · ' + color : ''}${size ? ' talla ' + size : ''} ya no está disponible`);
        if (sizeEntry.stock < qty)
          throw new Error(`"${prod.name}"${color ? ' · ' + color : ''}${size ? ' talla ' + size : ''} solo tiene ${sizeEntry.stock} disponible(s)`);
        sizeEntry.stock -= qty;
        entry.changed = true;
      } else {
        if (entry.stock < qty) throw new Error(`"${prod.name}" solo tiene ${entry.stock} en stock`);
        entry.stock -= qty;
        entry.changed = true;
      }

      // Precio base de la VARIANTE (si tiene precio propio manda sobre el del producto).
      const variantPrice = (variant && variant.price != null && Number(variant.price) > 0) ? Number(variant.price) : null;
      const basePrice = variantPrice != null ? variantPrice : Number(prod.price);
      // Precio de mayoreo si el producto lo maneja y se alcanzan 6+ piezas en total.
      const totalForProduct = qtyByProduct[prod.id] || qty;
      const isWholesale = prod.wholesale_price != null && Number(prod.wholesale_price) > 0 && totalForProduct >= WHOLESALE_MIN;
      const unitPrice = isWholesale ? Number(prod.wholesale_price) : basePrice;
      enriched.push({
        productId: prod.id, productName: prod.name, qty,
        price: unitPrice, regularPrice: basePrice, wholesale: isWholesale,
        size, color, option
      });
      subtotal += unitPrice * qty;
    }

    // Cotizar envio en el servidor (no confiar en el cliente)
    const shipQ = quoteShipping(shippingState);

    // Cupón: se vuelve a validar aquí (el carrito solo muestra el cálculo).
    let coupon = null;
    if (couponCode) {
      coupon = await evaluateCoupon(couponCode, subtotal, conn, true, req.user.id);
      await conn.execute('UPDATE coupons SET uses = uses + 1 WHERE code = ?', [coupon.code]);
    }
    const discount     = coupon ? coupon.discountAmount : 0;
    const shippingCost = coupon && coupon.freeShipping ? 0 : shipQ.cost;
    const total        = Math.round((subtotal - discount + shippingCost) * 100) / 100;

    // Escribir de vuelta el inventario de cada producto.
    for (const [pid, entry] of prodMap) {
      if (!entry.changed) continue;
      if (entry.isTracked) {
        // Stock total = suma del inventario por talla (fuente de verdad: las variantes).
        let sum = 0;
        for (const v of entry.variants) for (const s of (v.sizes || [])) if (s && typeof s === 'object' && s.stock != null) sum += s.stock;
        await conn.execute('UPDATE products SET variants = ?, stock = ? WHERE id = ?', [JSON.stringify(entry.variants), sum, pid]);
      } else {
        await conn.execute('UPDATE products SET stock = ? WHERE id = ?', [entry.stock, pid]);
      }
    }

    // Sufijo aleatorio: dos pedidos en el mismo milisegundo ya no chocan.
    const id = 'ORD-' + Date.now() + String(Math.floor(Math.random() * 900) + 100);
    const method = ['stripe','whatsapp','manual'].includes(paymentMethod) ? paymentMethod : 'whatsapp';
    const ship = shippingInfo && typeof shippingInfo === 'object' ? shippingInfo : {};
    const cleanShip = {
      phone: clip(ship.phone, 30), address: clip(ship.address, 300),
      city: clip(ship.city, 100), state: clip(ship.state, 60),
    };
    // El correo del pedido es SIEMPRE el de la cuenta: si viniera del navegador,
    // cualquiera podría usar la tienda para mandar correos a terceros.
    await conn.execute(
      `INSERT INTO orders
        (id, user_id, user_name, user_email, items, subtotal, shipping_cost, shipping_state,
         total, shipping_info, notes, payment_method, coupon_code, discount_amount, payment_status, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'unpaid', 'pending')`,
      [id, req.user.id, userName, req.user.email,
       JSON.stringify(enriched), subtotal, shippingCost, clip(shippingState, 60) || null,
       total, JSON.stringify(cleanShip), clip(notes, 1000), method,
       coupon ? coupon.code : null, discount]
    );

    await conn.commit();
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [id]);
    const order = parseOrder(rows[0]);

    // Emails y Telegram sin bloquear la respuesta. waitUntil mantiene viva la
    // función de Vercel hasta que terminen (sin él se congelaban y no salían).
    // Con tarjeta no se avisa nada todavía: los avisos (clienta y admin) salen
    // cuando Stripe confirma el pago (services/orders.js → markOrderPaid).
    if (order.paymentMethod !== 'stripe') {
      const avisos = [mailer.sendOrderToCustomer(order), mailer.sendOrderToAdmin(order), telegram.notifyNewOrder(order)];
      waitUntil(Promise.allSettled(avisos).then(logFailures('pedido ' + order.id)));
    }

    res.status(201).json(order);
  } catch (err) {
    await conn.rollback();
    console.error('Error al crear pedido:', err.message);
    res.status(400).json({ error: err.message || 'Error al crear pedido' });
  } finally {
    conn.release();
  }
});

// POST /api/orders/:id/abandon  (la clienta, sobre su propio pedido con tarjeta sin pagar)
// Se usa cuando cambia de opinión en el carrito (p. ej. prefiere pagar por
// WhatsApp): suelta el inventario en vez de esperar a que expire.
router.post('/:id/abandon', authenticate, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute('SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE', [req.params.id, req.user.id]);
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Pedido no encontrado' }); }
    if (row.payment_method !== 'stripe' || row.payment_status === 'paid' || row.status !== 'pending') {
      await conn.rollback(); return res.json({ ok: false });
    }
    if (row.stripe_intent_id && stripe) {
      const pi = await stripe.paymentIntents.retrieve(row.stripe_intent_id);
      if (['succeeded', 'processing'].includes(pi.status)) { await conn.rollback(); return res.json({ ok: false }); }
      if (pi.status !== 'canceled') await stripe.paymentIntents.cancel(pi.id);
    }
    await releaseOrder(conn, row);
    await conn.execute(`UPDATE orders SET status = 'cancelled', cancel_reason = 'La clienta no completó el pago con tarjeta' WHERE id = ?`, [row.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'No se pudo liberar el pedido' });
  } finally {
    conn.release();
  }
});

// PUT /api/orders/:id/status  (admin)
router.put('/:id/status', adminOnly, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { status } = req.body;
    const valid = ['pending','confirmed','processing','shipped','delivered','cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Estado invalido' });

    await conn.beginTransaction();

    const [[prev]] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!prev) { await conn.rollback(); return res.status(404).json({ error: 'Pedido no encontrado' }); }

    // Si se cancela un pedido no entregado, restaurar stock (por talla si aplica) y el cupón
    if (status === 'cancelled' && prev.status !== 'cancelled' && prev.status !== 'delivered') {
      await releaseOrder(conn, prev);
    }
    // Si se "des-cancela" (raro), volver a descontar
    if (prev.status === 'cancelled' && status !== 'cancelled') {
      if (!(await reclaimOrder(conn, prev))) {
        await conn.rollback();
        return res.status(400).json({ error: `Stock insuficiente para restaurar el pedido` });
      }
    }

    // Entregado o cancelado ya no puede ir "retrasado".
    const clearDelay = status === 'delivered' || status === 'cancelled';
    await conn.execute(
      `UPDATE orders SET status = ?${clearDelay ? ', is_delayed = 0, delay_note = NULL' : ''}${status !== 'cancelled' ? ', cancel_reason = NULL' : ''} WHERE id = ?`,
      [status, req.params.id]
    );
    await conn.commit();

    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    const order = parseOrder(rows[0]);
    waitUntil(Promise.allSettled([mailer.sendOrderStatusUpdate(order)]).then(logFailures('estado ' + order.id)));
    res.json(order);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar estado' });
  } finally {
    conn.release();
  }
});

// PUT /api/orders/:id/payment  { paymentStatus }  (admin)
// Para pagos fuera de la página (transferencia, OXXO, efectivo por WhatsApp).
// Los pagos con tarjeta los marca Stripe solo; su reembolso va por /refund.
router.put('/:id/payment', adminOnly, async (req, res) => {
  try {
    const paymentStatus = req.body.paymentStatus;
    if (!['paid', 'unpaid'].includes(paymentStatus)) return res.status(400).json({ error: 'Estado de pago inválido' });
    const [[row]] = await pool.execute('SELECT payment_method, payment_status FROM orders WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (row.payment_method === 'stripe')
      return res.status(400).json({ error: 'Los pagos con tarjeta los confirma Stripe automáticamente' });
    await pool.execute('UPDATE orders SET payment_status = ? WHERE id = ?', [paymentStatus, req.params.id]);
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    res.json(parseOrder(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el pago' });
  }
});

// PUT /api/orders/:id/tracking  { carrier, number }  (admin)
// Guarda la paquetería y el número de guía. Si el pedido aún no estaba enviado
// pasa a "Enviado"; la clienta recibe un correo con la guía.
router.put('/:id/tracking', adminOnly, async (req, res) => {
  try {
    const carrier = clip(req.body.carrier, 60);
    const number  = clip(req.body.number, 80);
    const [[prev]] = await pool.execute('SELECT status FROM orders WHERE id = ?', [req.params.id]);
    if (!prev) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (prev.status === 'cancelled') return res.status(400).json({ error: 'El pedido está cancelado' });
    const markShipped = !!number && ['pending', 'confirmed', 'processing'].includes(prev.status);
    await pool.execute(
      `UPDATE orders SET tracking_carrier = ?, tracking_number = ?${markShipped ? ", status = 'shipped'" : ''} WHERE id = ?`,
      [carrier || null, number || null, req.params.id]
    );
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    const order = parseOrder(rows[0]);
    if (number) waitUntil(Promise.allSettled([mailer.sendOrderStatusUpdate(order)]).then(logFailures('guía ' + order.id)));
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar la guía' });
  }
});

// POST /api/orders/:id/refund  (admin)
// Reembolsa en Stripe el total del pedido pagado con tarjeta. Si el pedido no
// se había entregado, también lo cancela y regresa el inventario.
router.post('/:id/refund', adminOnly, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe no está configurado' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Pedido no encontrado' }); }
    if (row.payment_method !== 'stripe' || row.payment_status !== 'paid' || !row.stripe_intent_id) {
      await conn.rollback();
      return res.status(400).json({ error: 'Solo se pueden reembolsar pedidos pagados con tarjeta' });
    }
    // La clave de idempotencia evita un doble reembolso si se da doble clic.
    await stripe.refunds.create({ payment_intent: row.stripe_intent_id }, { idempotencyKey: 'refund-' + row.id });
    const cancel = row.status !== 'cancelled' && row.status !== 'delivered';
    if (cancel) await releaseOrder(conn, row);
    await conn.execute(
      `UPDATE orders SET payment_status = 'refunded'${cancel ? ", status = 'cancelled', is_delayed = 0, cancel_reason = 'Reembolsado'" : ''} WHERE id = ?`,
      [row.id]
    );
    await conn.commit();
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [row.id]);
    const order = parseOrder(rows[0]);
    waitUntil(Promise.allSettled([mailer.sendOrderStatusUpdate(order)]).then(logFailures('reembolso ' + order.id)));
    res.json(order);
  } catch (err) {
    await conn.rollback();
    console.error('reembolso', err.message);
    res.status(500).json({ error: 'Stripe rechazó el reembolso: ' + (err.message || 'error desconocido') });
  } finally {
    conn.release();
  }
});

// PUT /api/orders/:id/delay  { delayed, note }  (admin)
// Marca/desmarca el pedido como retrasado sin moverlo de etapa; avisa al cliente.
router.put('/:id/delay', adminOnly, async (req, res) => {
  try {
    const delayed = !!req.body.delayed;
    const note = delayed ? String(req.body.note || '').trim().slice(0, 255) || null : null;
    const [r] = await pool.execute('UPDATE orders SET is_delayed = ?, delay_note = ? WHERE id = ?',
      [delayed ? 1 : 0, note, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Pedido no encontrado' });
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    const order = parseOrder(rows[0]);
    waitUntil(Promise.allSettled([mailer.sendOrderDelayUpdate(order)]).then(logFailures('retraso ' + order.id)));
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al marcar el retraso' });
  }
});

module.exports = router;
