// Herramientas del panel: avisos de ventas (correo, Telegram, notificaciones
// push al celular) y el "radar" de pedidos nuevos que el panel consulta cada
// pocos segundos mientras está abierto.
const router = require('express').Router();
const pool = require('../db/connection');
const { adminOnly } = require('../middleware/auth');
const settings = require('../services/settings');
const mailer = require('../services/mailer');
const telegram = require('../services/telegram');
const push = require('../services/push');

const fail = (res, err, msg) => {
  console.error('[admin]', msg, err);
  res.status(err.status || 500).json({ error: err.status ? err.message : msg });
};

// GET /api/admin/notify  → a dónde llegan los avisos
router.get('/notify', adminOnly, async (req, res) => {
  try {
    const savedRaw = await settings.get('notify_emails').catch(() => null);
    const [emails, devices] = await Promise.all([
      settings.adminEmails(),
      push.countForUser(req.user.id).catch(() => 0),
    ]);
    res.json({
      emails,
      emailsFrom: savedRaw != null ? 'panel' : 'vercel',
      mail: mailer.mailStatus(),
      telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && !process.env.TELEGRAM_BOT_TOKEN.startsWith('CAMBIAR')),
      pushDevices: devices,
    });
  } catch (err) { fail(res, err, 'No se pudo leer la configuración de avisos'); }
});

// PUT /api/admin/notify/emails  { emails: "a@x.com, b@y.com" }
router.put('/notify/emails', adminOnly, async (req, res) => {
  try {
    const list = String(req.body.emails || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    const bad = list.filter(e => !settings.EMAIL_RE.test(e));
    if (bad.length) return res.status(400).json({ error: 'Correo no válido: ' + bad[0] });
    if (!list.length) return res.status(400).json({ error: 'Escribe al menos un correo' });
    if (list.length > 5) return res.status(400).json({ error: 'Máximo 5 correos' });
    await settings.set('notify_emails', [...new Set(list)].join(','));
    telegram.notifySecurity('Cambiaron los correos de avisos de ventas', [`📧 ${list.join(', ')}`, `👤 ${req.user.email}`], req)
      .catch(() => {});
    res.json({ emails: await settings.adminEmails() });
  } catch (err) { fail(res, err, 'No se pudieron guardar los correos'); }
});

// POST /api/admin/notify/test  → manda una prueba por cada canal y dice qué pasó
router.post('/notify/test', adminOnly, async (req, res) => {
  const out = {};
  const emails = await settings.adminEmails().catch(() => []);
  const [mail, tg, pu] = await Promise.allSettled([
    emails.length ? mailer.sendAdminTest(emails) : Promise.reject(new Error('No hay correo configurado')),
    telegram.sendTelegram('🔔 <b>Prueba de avisos</b>\nAsí te llegará cada venta de la tienda.'),
    push.sendToAdmins({ title: '🔔 Prueba de avisos', body: 'Así te llegará cada venta, aunque el panel esté cerrado.', tag: 'test', url: '/dashboard/?panel=orders' }),
  ]);
  out.email = mail.status === 'fulfilled'
    ? { ok: !mail.value?.simulated, to: emails, note: mail.value?.simulated ? 'SMTP sin configurar (modo simulado)' : '' }
    : { ok: false, to: emails, error: mail.reason?.message || 'Error al enviar' };
  out.telegram = tg.status === 'fulfilled'
    ? (tg.value?.skipped ? { ok: false, error: 'Telegram no está configurado' } : tg.value?.ok ? { ok: true } : { ok: false, error: tg.value?.description || tg.value?.error || 'Telegram rechazó el mensaje' })
    : { ok: false, error: tg.reason?.message };
  out.push = pu.status === 'fulfilled'
    ? { ok: pu.value.sent > 0, sent: pu.value.sent, failed: pu.value.failed, error: pu.value.sent ? '' : 'Ningún celular tiene las notificaciones activadas' }
    : { ok: false, error: pu.reason?.message };
  res.json(out);
});

// GET /api/admin/push/key → llave pública para suscribir el navegador
router.get('/push/key', adminOnly, async (req, res) => {
  try { res.json({ publicKey: await push.publicKey() }); }
  catch (err) { fail(res, err, 'No se pudieron preparar las notificaciones'); }
});

// POST /api/admin/push/subscribe  { subscription, device }
router.post('/push/subscribe', adminOnly, async (req, res) => {
  try {
    await push.subscribe(req.user.id, req.body.subscription, req.body.device);
    res.json({ ok: true, devices: await push.countForUser(req.user.id) });
  } catch (err) { fail(res, err, 'No se pudo activar en este dispositivo'); }
});

// POST /api/admin/push/unsubscribe  { endpoint }
router.post('/push/unsubscribe', adminOnly, async (req, res) => {
  try {
    await push.unsubscribe(req.body.endpoint);
    res.json({ ok: true, devices: await push.countForUser(req.user.id) });
  } catch (err) { fail(res, err, 'No se pudo desactivar'); }
});

// GET /api/admin/orders/feed → últimas ventas "reales" (WhatsApp al crearse,
// tarjeta solo ya pagada) para la alerta en vivo del panel.
router.get('/orders/feed', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, user_name, total, payment_method, payment_status, status, created_at
         FROM orders
        WHERE (payment_method <> 'stripe' OR payment_status = 'paid')
        ORDER BY created_at DESC LIMIT 15`
    );
    const [[{ pending }]] = await pool.execute(
      `SELECT COUNT(*) AS pending FROM orders
        WHERE status IN ('pending','confirmed','processing')
          AND (payment_method <> 'stripe' OR payment_status = 'paid')`
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      pending: Number(pending),
      orders: rows.map(r => ({
        id: r.id, userName: r.user_name, total: Number(r.total), paymentMethod: r.payment_method,
        paymentStatus: r.payment_status, status: r.status, createdAt: r.created_at,
      })),
    });
  } catch (err) { fail(res, err, 'No se pudieron leer los pedidos'); }
});

module.exports = router;
