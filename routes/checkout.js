const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const stripe  = require('../services/stripe');
const { markOrderPaid, expireStaleOrders } = require('../services/orders');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
// Stripe no acepta cobros menores a $10 MXN.
const STRIPE_MIN_MXN = 10;
// Intentos de pago que todavía se pueden usar para cobrar.
const REUSABLE = ['requires_payment_method', 'requires_confirmation', 'requires_action'];

// GET /api/checkout/config  -> publishable key para el frontend
router.get('/config', (req, res) => {
  const pk = process.env.STRIPE_PUBLIC_KEY || '';
  res.json({
    enabled: !!stripe && !pk.includes('PEGA_AQUI'),
    publicKey: pk.includes('PEGA_AQUI') ? '' : pk,
  });
});

// POST /api/checkout/create-payment-intent  { orderId }
// Si el pedido ya tiene un intento de pago vigente se reutiliza: así abrir y
// cerrar la ventana de pago no crea cobros paralelos para el mismo pedido.
router.post('/create-payment-intent', authenticate, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Pagos no configurados. Faltan claves de Stripe en .env' });
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    const [[row]] = await pool.execute(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [orderId, req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (row.payment_status === 'paid') return res.status(400).json({ error: 'Pedido ya pagado' });
    if (row.status === 'cancelled') return res.status(410).json({ error: 'Este pedido expiró. Vuelve a confirmar tu compra.', expired: true });
    if (Number(row.total) < STRIPE_MIN_MXN)
      return res.status(400).json({ error: `El pago con tarjeta requiere un total mínimo de $${STRIPE_MIN_MXN}. Usa la opción por WhatsApp.` });

    const amount = Math.round(Number(row.total) * 100); // MXN -> centavos

    if (row.stripe_intent_id) {
      const prev = await stripe.paymentIntents.retrieve(row.stripe_intent_id).catch(() => null);
      if (prev && prev.status === 'succeeded') return res.status(400).json({ error: 'Pedido ya pagado' });
      if (prev && prev.status === 'processing') return res.status(409).json({ error: 'Tu pago se está procesando. Revisa "Mis pedidos" en unos minutos.' });
      const cardOnly = prev && prev.payment_method_types.length === 1 && prev.payment_method_types[0] === 'card';
      if (prev && REUSABLE.includes(prev.status) && prev.amount === amount && cardOnly) {
        return res.json({ clientSecret: prev.client_secret, amount });
      }
      // Intento viejo (con Link) o de otro monto: se cancela para que no quede
      // un cobro paralelo vivo, y abajo se crea uno nuevo.
      if (prev && REUSABLE.includes(prev.status)) await stripe.paymentIntents.cancel(prev.id).catch(() => {});
    }

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'mxn',
      // Solo tarjeta: sin Stripe Link, que agregaba un paso de "verifica tu
      // correo" que confundía a las clientas. El comprobante y el seguimiento
      // llegan con el correo de confirmación de la tienda.
      payment_method_types: ['card'],
      metadata: {
        orderId: row.id,
        userId:  String(row.user_id || ''),
        userEmail: row.user_email,
      },
      receipt_email: row.user_email,
      description: `Pedido ${row.id} - Fajas Maydel`,
    }, { idempotencyKey: `intent-${row.id}-${amount}-${row.stripe_intent_id || 'first'}` });
    await pool.execute('UPDATE orders SET stripe_intent_id = ?, payment_method = "stripe" WHERE id = ?',
      [intent.id, row.id]);

    res.json({ clientSecret: intent.client_secret, amount });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'No se pudo iniciar el pago con tarjeta. Intenta de nuevo o paga por WhatsApp.' });
  }
});

// POST /api/checkout/webhook  (Stripe webhook; raw body)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !WEBHOOK_SECRET || WEBHOOK_SECRET.includes('PEGA_AQUI')) {
    return res.status(503).send('Webhook no configurado');
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    const obj = event.data.object;
    if (event.type === 'payment_intent.succeeded') {
      const orderId = obj.metadata?.orderId;
      // Debe ser el intento vigente del pedido y por el monto del pedido.
      if (orderId) {
        const [[row]] = await pool.execute('SELECT total FROM orders WHERE id = ?', [orderId]);
        if (row && Math.round(Number(row.total) * 100) !== obj.amount_received) {
          console.error('[webhook] monto distinto al del pedido', orderId, obj.amount_received);
        }
        await pool.execute('UPDATE orders SET stripe_intent_id = ? WHERE id = ?', [obj.id, orderId]);
        await markOrderPaid(orderId);
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const orderId = obj.metadata?.orderId;
      if (orderId) {
        // Se marca para el panel; el pedido sigue vivo para que la clienta reintente
        // (si no lo logra, expira solo y regresa el inventario).
        await pool.execute(
          'UPDATE orders SET payment_status = "failed" WHERE id = ? AND payment_status = "unpaid"', [orderId]);
      }
    } else if (event.type === 'charge.refunded') {
      // Reembolso hecho desde el panel de Stripe (no desde el de la tienda).
      if (obj.refunded && obj.payment_intent) {
        await pool.execute(
          'UPDATE orders SET payment_status = "refunded" WHERE stripe_intent_id = ?', [obj.payment_intent]);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).send('Error procesando evento');
  }
});

// GET /api/checkout/expire-orders  (cron diario de Vercel)
// Vercel manda "Authorization: Bearer <CRON_SECRET>".
router.get('/expire-orders', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'No autorizado' });
  try {
    res.json(await expireStaleOrders(50));
  } catch (err) {
    console.error('[cron expirar]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
