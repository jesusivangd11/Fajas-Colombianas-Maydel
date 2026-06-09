const router = require('express').Router();
const pool   = require('../db/connection');
const { authenticate, adminOnly } = require('../middleware/auth');
const { quoteShipping } = require('../services/shipping');
const mailer = require('../services/mailer');
const telegram = require('../services/telegram');

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
  const { userName, userEmail, items, shippingInfo, shippingState, notes, paymentMethod } = req.body;
  if (!userName || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Datos del pedido incompletos' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Bloquear filas de productos y verificar stock
    let subtotal = 0;
    const enriched = [];
    for (const it of items) {
      const [[prod]] = await conn.execute(
        'SELECT id, name, price, stock, active FROM products WHERE id = ? FOR UPDATE',
        [it.productId]
      );
      if (!prod) throw new Error(`Producto ${it.productId} no encontrado`);
      if (!prod.active) throw new Error(`"${prod.name}" ya no esta disponible`);
      const qty = Math.max(1, Number(it.qty) || 1);
      if (prod.stock < qty) throw new Error(`"${prod.name}" solo tiene ${prod.stock} en stock`);
      enriched.push({
        productId: prod.id, productName: prod.name, qty,
        price: Number(prod.price), size: it.size || '', color: it.color || ''
      });
      subtotal += Number(prod.price) * qty;
    }

    // Cotizar envio en el servidor (no confiar en el cliente)
    const shipQ = quoteShipping(shippingState);
    const total = subtotal + shipQ.cost;

    // Descontar stock
    for (const it of enriched) {
      await conn.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [it.qty, it.productId]);
    }

    const id = 'ORD-' + Date.now();
    const method = ['stripe','whatsapp','manual'].includes(paymentMethod) ? paymentMethod : 'whatsapp';
    await conn.execute(
      `INSERT INTO orders
        (id, user_id, user_name, user_email, items, subtotal, shipping_cost, shipping_state,
         total, shipping_info, notes, payment_method, payment_status, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'unpaid', 'pending')`,
      [id, req.user.id, userName, userEmail || req.user.email,
       JSON.stringify(enriched), subtotal, shipQ.cost, shippingState || null,
       total, JSON.stringify(shippingInfo || {}), notes || '', method]
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

    // Si se cancela un pedido no entregado, restaurar stock
    if (status === 'cancelled' && prev.status !== 'cancelled' && prev.status !== 'delivered') {
      const items = prev.items || [];
      for (const it of items) {
        await conn.execute('UPDATE products SET stock = stock + ? WHERE id = ?', [Number(it.qty || 0), it.productId]);
      }
    }
    // Si se "des-cancela" (raro), volver a descontar
    if (prev.status === 'cancelled' && status !== 'cancelled') {
      const items = prev.items || [];
      for (const it of items) {
        const [[p]] = await conn.execute('SELECT stock FROM products WHERE id = ? FOR UPDATE', [it.productId]);
        if (!p || p.stock < Number(it.qty || 0)) {
          await conn.rollback();
          return res.status(400).json({ error: `Stock insuficiente para restaurar el pedido` });
        }
        await conn.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [Number(it.qty || 0), it.productId]);
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
