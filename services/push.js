// Notificaciones push al celular de la administradora (aunque el panel esté
// cerrado). El panel se instala como app (dashboard/manifest.webmanifest) y su
// service worker (dashboard/sw.js) muestra el aviso.
//
// Las llaves VAPID (las que firman cada aviso) se generan solas la primera vez y
// se guardan en la BD (tabla app_settings), así no hay que configurar variables
// en Vercel. Si existen VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en el entorno, mandan
// esas. Las tablas también se crean solas (CREATE TABLE IF NOT EXISTS).
const crypto = require('crypto');
const webpush = require('web-push');
const pool = require('../db/connection');
const settings = require('./settings');

const hashOf = e => crypto.createHash('sha256').update(String(e || '')).digest('hex');
// Apple/Google exigen un contacto https: o mailto: (en local PUBLIC_URL es http).
const PUBLIC_URL = /^https:/.test(process.env.PUBLIC_URL || '') ? process.env.PUBLIC_URL : 'https://www.fajascolombianasmaydel.com';
let ready = null;   // promesa con { publicKey } una vez configurado

async function ensureTables() {
  await pool.execute(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    endpoint_hash CHAR(64) NOT NULL,
    endpoint      VARCHAR(700) NOT NULL,
    p256dh        VARCHAR(255) NOT NULL,
    auth          VARCHAR(255) NOT NULL,
    device        VARCHAR(160) NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_push_endpoint (endpoint_hash)
  )`);
}

function init() {
  if (ready) return ready;
  ready = (async () => {
    await ensureTables();
    let publicKey = process.env.VAPID_PUBLIC_KEY || '';
    let privateKey = process.env.VAPID_PRIVATE_KEY || '';
    if (!publicKey || !privateKey) {
      publicKey = await settings.get('vapid_public');
      privateKey = await settings.get('vapid_private');
      if (!publicKey || !privateKey) {
        // Si dos instancias llegan a la vez, gana la primera y ambas releen las
        // mismas llaves (el par debe ir junto: se guarda como un solo valor).
        const keys = webpush.generateVAPIDKeys();
        await settings.setIfMissing('vapid_pair', JSON.stringify(keys));
        const pair = JSON.parse(await settings.get('vapid_pair'));
        await settings.set('vapid_public', pair.publicKey);
        await settings.set('vapid_private', pair.privateKey);
        publicKey = pair.publicKey; privateKey = pair.privateKey;
      }
    }
    webpush.setVapidDetails(PUBLIC_URL, publicKey, privateKey);
    return { publicKey };
  })().catch(err => { ready = null; throw err; });
  return ready;
}

async function publicKey() {
  return (await init()).publicKey;
}

async function subscribe(userId, sub, device) {
  await init();
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 700 || !p256dh || !auth) {
    throw Object.assign(new Error('Suscripción inválida'), { status: 400 });
  }
  await pool.execute(
    `INSERT INTO push_subscriptions (user_id, endpoint_hash, endpoint, p256dh, auth, device) VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth), device = VALUES(device)`,
    [userId, hashOf(endpoint), endpoint, p256dh.slice(0, 255), auth.slice(0, 255), String(device || '').slice(0, 160) || null]
  );
}

async function unsubscribe(endpoint) {
  await init();
  await pool.execute('DELETE FROM push_subscriptions WHERE endpoint_hash = ?', [hashOf(endpoint)]);
}

async function countForUser(userId) {
  await init();
  const [[row]] = await pool.execute('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', [userId]);
  return Number(row.n);
}

// Manda el aviso a todos los dispositivos de cuentas que SIGUEN siendo admin.
// Devuelve { sent, failed, removed } para el diagnóstico del panel.
async function sendToAdmins(payload) {
  await init();
  const [subs] = await pool.execute(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s
       JOIN users u ON u.id = s.user_id WHERE u.role = 'admin'`
  );
  const body = JSON.stringify(payload);
  const result = { sent: 0, failed: 0, removed: 0, errors: [] };
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 60 * 60 * 24, urgency: 'high' }
      );
      result.sent++;
    } catch (err) {
      // 404/410: el navegador borró la suscripción (desinstaló la app, etc.).
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.execute('DELETE FROM push_subscriptions WHERE id = ?', [s.id]).catch(() => {});
        result.removed++;
      } else {
        result.failed++;
        result.errors.push(String(err.statusCode || '') + ' ' + (err.body || err.message || '').slice(0, 120));
      }
    }
  }));
  if (result.failed) console.error('[push] fallaron', result.failed, result.errors.join(' | '));
  return result;
}

const fmt = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n || 0));

function notifyNewOrder(order) {
  const paid = order.paymentStatus === 'paid';
  const items = (order.items || []).reduce((s, i) => s + Number(i.qty || 0), 0);
  return sendToAdmins({
    title: paid ? `💰 ¡VENTA PAGADA! ${fmt(order.total)}` : `🛍️ ¡NUEVO PEDIDO! ${fmt(order.total)}`,
    body: `#${order.id} · ${order.userName || 'Clienta'} · ${items} pieza${items === 1 ? '' : 's'}` +
          (paid ? ' · Pagado con tarjeta' : ' · Por confirmar pago (WhatsApp)'),
    tag: 'order-' + order.id,
    url: '/dashboard/?panel=orders&order=' + encodeURIComponent(order.id),
  });
}

module.exports = { publicKey, subscribe, unsubscribe, countForUser, sendToAdmins, notifyNewOrder };
