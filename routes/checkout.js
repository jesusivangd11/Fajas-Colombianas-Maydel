const express = require('express');
const router  = express.Router();
const pool    = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const mailer = require('../services/mailer');

const SECRET = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = SECRET && !SECRET.includes('PEGA_AQUI') ? require('stripe')(SECRET) : null;

// GET /api/checkout/config  -> publishable key para el frontend
router.get('/config', (req, res) => {
  const pk = process.env.STRIPE_PUBLIC_KEY || '';
  res.json({
    enabled: !!stripe && !pk.includes('PEGA_AQUI'),
    publicKey: pk.includes('PEGA_AQUI') ? '' : pk,
  });
});

// POST /api/checkout/create-payment-intent  { orderId }
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

    const amount = Math.round(Number(row.total) * 100); // MXN -> centavos
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'mxn',
      automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: row.id,
        userId:  String(row.user_id || ''),
        userEmail: row.user_email,
      },
      receipt_email: row.user_email,
      description: `Pedido ${row.id} - Fajas Maydel`,
    });
    await pool.execute('UPDATE orders SET stripe_intent_id = ?, payment_method = "stripe" WHERE id = ?',
      [intent.id, row.id]);

    res.json({ clientSecret: intent.client_secret, amount });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message || 'Error al crear PaymentIntent' });
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
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;
      if (orderId) {
        await pool.execute(
          'UPDATE orders SET payment_status = "paid", status = "confirmed" WHERE id = ?',
          [orderId]
        );
        const [[row]] = await pool.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
        if (row) {
          const order = {
            id: row.id, userName: row.user_name, userEmail: row.user_email,
            items: row.items || [], subtotal: Number(row.subtotal), shippingCost: Number(row.shipping_cost),
            total: Number(row.total), shippingInfo: row.shipping_info || {}, status: 'confirmed',
            shippingState: row.shipping_state, paymentMethod: 'stripe', paymentStatus: 'paid',
            notes: row.notes || '',
          };
          Promise.allSettled([
            mailer.sendOrderStatusUpdate(order),
            mailer.sendOrderToAdmin(order),
          ]).catch(() => {});
        }
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;
      if (orderId) {
        await pool.execute('UPDATE orders SET payment_status = "failed" WHERE id = ?', [orderId]);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).send('Error procesando evento');
  }
});

module.exports = router;
