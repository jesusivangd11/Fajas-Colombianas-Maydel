const router = require('express').Router();
const pool   = require('../db/connection');
const { authenticate, adminOnly } = require('../middleware/auth');
const { quoteShipping } = require('../services/shipping');
const { evaluateCoupon } = require('../services/coupons');
const mailer = require('../services/mailer');
const telegram = require('../services/telegram');

// Piezas mínimas de un mismo producto (sumando tallas/colores) para precio de mayoreo.
const WHOLESALE_MIN = 6;

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
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

// GET /api/orders  (admin: todos | user: propios)
router.get('/', authenticate, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
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
  const [rows] = await pool.execute('SELECT * FROM orders ORDER BY created_at DESC');
  const esc = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const header = ['id','fecha','cliente','email','telefono','estado_envio','direccion','subtotal','envio','total','metodo_pago','estado_pago','estado','items'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const items = (r.items || []).map(i => `${i.productName} x${i.qty}${i.size ? ` (${i.size})`:''}`).join(' | ');
    const ship  = r.shipping_info || {};
    lines.push([
      r.id, new Date(r.created_at).toISOString(), r.user_name, r.user_email,
      ship.phone || '', r.shipping_state || '', ship.address || '',
      r.subtotal, r.shipping_cost, r.total, r.payment_method, r.payment_status, r.status, items
    ].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pedidos_${Date.now()}.csv"`);
  res.send('﻿' + lines.join('\n')); // BOM para Excel
});

// GET /api/orders/stats  (admin)
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
        COALESCE(SUM(CASE WHEN status!='cancelled' THEN total END),0) AS allRevenue
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
  const { userName, userEmail, items, shippingInfo, shippingState, notes, paymentMethod, couponCode } = req.body;
  if (!userName || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Datos del pedido incompletos' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Total de piezas por producto (combinando tallas/colores) para el mayoreo.
    const qtyByProduct = {};
    for (const it of items) {
      const pid = it.productId;
      qtyByProduct[pid] = (qtyByProduct[pid] || 0) + Math.max(1, Number(it.qty) || 1);
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
      const qty = Math.max(1, Number(it.qty) || 1);
      const size = it.size || '', color = it.color || '', option = it.option || '';
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
      coupon = await evaluateCoupon(couponCode, subtotal, conn, true);
      await conn.execute('UPDATE coupons SET uses = uses + 1 WHERE code = ?', [coupon.code]);
    }
    const discount     = coupon ? coupon.discountAmount : 0;
    const shippingCost = coupon && coupon.freeShipping ? 0 : shipQ.cost;
    const total        = subtotal - discount + shippingCost;

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

    const id = 'ORD-' + Date.now();
    const method = ['stripe','whatsapp','manual'].includes(paymentMethod) ? paymentMethod : 'whatsapp';
    await conn.execute(
      `INSERT INTO orders
        (id, user_id, user_name, user_email, items, subtotal, shipping_cost, shipping_state,
         total, shipping_info, notes, payment_method, coupon_code, discount_amount, payment_status, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'unpaid', 'pending')`,
      [id, req.user.id, userName, userEmail || req.user.email,
       JSON.stringify(enriched), subtotal, shippingCost, shippingState || null,
       total, JSON.stringify(shippingInfo || {}), notes || '', method,
       coupon ? coupon.code : null, discount]
    );

    await conn.commit();
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [id]);
    const order = parseOrder(rows[0]);

    // Disparar emails y Telegram sin bloquear la respuesta
    Promise.allSettled([
      mailer.sendOrderToCustomer(order),
      mailer.sendOrderToAdmin(order),
      telegram.notifyNewOrder(order),
    ]).catch(() => {});

    res.status(201).json(order);
  } catch (err) {
    await conn.rollback();
    console.error('Error al crear pedido:', err.message);
    res.status(400).json({ error: err.message || 'Error al crear pedido' });
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

    // Si se cancela un pedido no entregado, restaurar stock (por talla si aplica)
    if (status === 'cancelled' && prev.status !== 'cancelled' && prev.status !== 'delivered') {
      for (const it of (prev.items || [])) await adjustProductStock(conn, it, +1);
    }
    // Si se "des-cancela" (raro), volver a descontar
    if (prev.status === 'cancelled' && status !== 'cancelled') {
      for (const it of (prev.items || [])) {
        const r = await adjustProductStock(conn, it, -1);
        if (!r.ok) {
          await conn.rollback();
          return res.status(400).json({ error: `Stock insuficiente para restaurar el pedido` });
        }
      }
    }

    await conn.execute('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    await conn.commit();

    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    const order = parseOrder(rows[0]);
    mailer.sendOrderStatusUpdate(order).catch(() => {});
    res.json(order);
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar estado' });
  } finally {
    conn.release();
  }
});

module.exports = router;
