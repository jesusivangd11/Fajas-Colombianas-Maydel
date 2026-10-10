const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const pool    = require('../db/connection');
const { authenticate, signToken, COOKIE_OPTS } = require('../middleware/auth');
const mailer = require('../services/mailer');
const otp    = require('../services/otp');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña requeridos' });

    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });

    res.cookie('maydel_token', signToken(user), COOKIE_OPTS());
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── LOGIN SOCIAL (Google / Facebook) ─────────────────────────────────────────
// Busca al usuario por correo; si no existe lo crea (sin contraseña). Si existía
// con email/password, vincula el proveedor sin romper su login normal.
async function findOrCreateOAuthUser({ email, name, provider, providerId, avatar }) {
  email = String(email || '').trim().toLowerCase();
  if (!email) throw new Error('Tu cuenta de ' + provider + ' no tiene un correo disponible.');
  name = (name || email.split('@')[0]).trim();

  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
  if (rows.length) {
    const user = rows[0];
    await pool.execute(
      `UPDATE users SET provider_id = COALESCE(provider_id, ?), avatar = COALESCE(avatar, ?),
       provider = CASE WHEN password_hash IS NULL THEN ? ELSE provider END WHERE id = ?`,
      [providerId, avatar || null, provider, user.id]
    );
    return user;
  }
  const [result] = await pool.execute(
    'INSERT INTO users (name, email, role, provider, provider_id, avatar) VALUES (?, ?, ?, ?, ?, ?)',
    [name, email, 'user', provider, providerId, avatar || null]
  );
  return { id: result.insertId, name, email, role: 'user' };
}

// POST /api/auth/google  { credential }  (ID token de Google Identity Services)
router.post('/google', async (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    if (!clientId || clientId.includes('PEGA_AQUI')) return res.status(503).json({ error: 'El inicio de sesión con Google no está configurado.' });

    const credential = req.body.credential;
    if (!credential) return res.status(400).json({ error: 'Falta el token de Google' });

    // Verifica el ID token con Google (endpoint oficial tokeninfo)
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!r.ok) return res.status(401).json({ error: 'Token de Google inválido' });
    const p = await r.json();

    if (p.aud !== clientId) return res.status(401).json({ error: 'Token de Google no corresponde a esta app' });
    if (p.email_verified !== true && p.email_verified !== 'true') return res.status(401).json({ error: 'Tu correo de Google no está verificado' });

    const user = await findOrCreateOAuthUser({
      email: p.email, name: p.name, provider: 'google', providerId: p.sub, avatar: p.picture,
    });
    res.cookie('maydel_token', signToken(user), COOKIE_OPTS());
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    console.error('google login', err);
    res.status(500).json({ error: err.message || 'Error al iniciar sesión con Google' });
  }
});

// POST /api/auth/facebook  { accessToken }  (access token del SDK de Facebook)
router.post('/facebook', async (req, res) => {
  try {
    const appId     = process.env.FACEBOOK_APP_ID || '';
    const appSecret = process.env.FACEBOOK_APP_SECRET || '';
    if (!appId || appId.includes('PEGA_AQUI') || !appSecret) return res.status(503).json({ error: 'El inicio de sesión con Facebook no está configurado.' });

    const accessToken = req.body.accessToken;
    if (!accessToken) return res.status(400).json({ error: 'Falta el token de Facebook' });

    // 1) Verifica que el token pertenece a NUESTRA app
    const appToken = `${appId}|${appSecret}`;
    const dbgRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appToken)}`);
    const dbg = await dbgRes.json();
    if (!dbg.data || !dbg.data.is_valid || String(dbg.data.app_id) !== String(appId)) {
      return res.status(401).json({ error: 'Token de Facebook inválido' });
    }

    // 2) Obtiene el perfil
    const meRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`);
    const me = await meRes.json();
    if (!me.id) return res.status(401).json({ error: 'No se pudo obtener tu perfil de Facebook' });
    if (!me.email) return res.status(400).json({ error: 'Tu cuenta de Facebook no comparte un correo. Usa otro método.' });

    const user = await findOrCreateOAuthUser({
      email: me.email, name: me.name, provider: 'facebook', providerId: me.id, avatar: me.picture?.data?.url,
    });
    res.cookie('maydel_token', signToken(user), COOKIE_OPTS());
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    console.error('facebook login', err);
    res.status(500).json({ error: err.message || 'Error al iniciar sesión con Facebook' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, birthdate, phone, calle, numero, colonia, cp, ciudad, estado } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Todos los campos son requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const normPhone = otp.normalizePhone(phone);
    if (normPhone && normPhone.length < 11) return res.status(400).json({ error: 'El teléfono no parece válido (incluye los 10 dígitos)' });

    const [exists] = await pool.execute('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (exists.length) return res.status(409).json({ error: 'Este correo ya está registrado' });

    const hash = await bcrypt.hash(password, 10);
    const address = { calle: calle || '', numero: numero || '', colonia: colonia || '', cp: cp || '', ciudad: ciudad || '', estado: estado || '' };

    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password_hash, role, birthdate, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), hash, 'user', birthdate || null, normPhone || null, JSON.stringify(address)]
    );
    const user = { id: result.insertId, name: name.trim(), email: email.trim().toLowerCase(), role: 'user' };

    res.cookie('maydel_token', signToken(user), COOKIE_OPTS());
    res.status(201).json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('maydel_token');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const { id, name, email, role } = req.user;
  res.json({ id, name, email, role });
});

// POST /api/auth/forgot-password  { email }
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Correo requerido' });

    const [rows] = await pool.execute('SELECT id, name, email FROM users WHERE email = ?', [email]);
    // Respuesta uniforme para no revelar si el correo existe
    if (rows.length) {
      const user = rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
      await pool.execute(
        'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
        [user.id, token, expires]
      );
      const base = process.env.PUBLIC_URL || 'http://localhost:3000';
      const resetUrl = `${base}/reset-password.html?token=${token}`;
      mailer.sendPasswordReset({ to: user.email, name: user.name, resetUrl }).catch(e => console.error('mail err', e.message));
    }
    res.json({ ok: true, message: 'Si el correo esta registrado, te enviamos un enlace para restablecer tu contrasena.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/reset-password  { token, password }
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token y contrasena requeridos' });
    if (String(password).length < 6) return res.status(400).json({ error: 'La contrasena debe tener al menos 6 caracteres' });

    const [rows] = await pool.execute(
      'SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Token invalido o expirado' });

    const reset = rows[0];
    const hash = await bcrypt.hash(password, 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, reset.user_id]);
    await pool.execute('UPDATE password_resets SET used = 1 WHERE id = ?', [reset.id]);

    res.json({ ok: true, message: 'Contrasena actualizada. Ya puedes iniciar sesion.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/send-otp  { phone, channel }  -> envia codigo de 6 digitos
router.post('/send-otp', async (req, res) => {
  try {
    const phone   = otp.normalizePhone(req.body.phone);
    const channel = req.body.channel === 'whatsapp' ? 'whatsapp' : 'sms';
    if (!phone || phone.length < 11) return res.status(400).json({ error: 'Número de teléfono inválido' });

    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE phone = ? LIMIT 1', [phone]
    );

    let simulated = false, devCode = null;
    if (rows.length) {
      const userId = rows[0].id;
      const code   = otp.generateCode();
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

      // Invalida codigos previos sin usar para este telefono
      await pool.execute(
        "UPDATE otp_codes SET used = 1 WHERE phone = ? AND purpose = 'reset' AND used = 0", [phone]
      );
      await pool.execute(
        'INSERT INTO otp_codes (user_id, phone, code, purpose, channel, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, phone, code, 'reset', channel, expires]
      );
      const result = await otp.sendCode({ phone, code, channel }).catch(e => {
        console.error('otp send err', e.message); return { simulated: false, error: true };
      });
      simulated = !!result.simulated;
      if (simulated) devCode = code; // modo demo: lo mostramos para poder probar
    }

    // Respuesta uniforme: no revelamos si el telefono existe
    const payload = { ok: true, message: 'Si el teléfono está registrado, recibirás un código en unos segundos.' };
    if (simulated) { payload.demo = true; payload.devCode = devCode; }
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/verify-otp  { phone, code }  -> valida codigo y entrega token de reset
router.post('/verify-otp', async (req, res) => {
  try {
    const phone = otp.normalizePhone(req.body.phone);
    const code  = String(req.body.code || '').trim();
    if (!phone || !code) return res.status(400).json({ error: 'Teléfono y código requeridos' });

    const [rows] = await pool.execute(
      "SELECT * FROM otp_codes WHERE phone = ? AND purpose = 'reset' AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
      [phone]
    );
    if (!rows.length) return res.status(400).json({ error: 'El código expiró o no existe. Solicita uno nuevo.' });

    const row = rows[0];
    if (row.attempts >= 5) {
      await pool.execute('UPDATE otp_codes SET used = 1 WHERE id = ?', [row.id]);
      return res.status(429).json({ error: 'Demasiados intentos. Solicita un código nuevo.' });
    }
    if (row.code !== code) {
      await pool.execute('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      return res.status(400).json({ error: 'Código incorrecto' });
    }

    // Codigo correcto: lo marcamos usado y emitimos un token de reset (reutiliza el flujo de email)
    await pool.execute('UPDATE otp_codes SET used = 1 WHERE id = ?', [row.id]);
    await pool.execute('UPDATE users SET phone_verified = 1 WHERE id = ?', [row.user_id]);

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos para cambiar la contrasena
    await pool.execute(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
      [row.user_id, token, expires]
    );
    res.json({ ok: true, resetToken: token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/auth/reset-password/validate?token=...
router.get('/reset-password/validate', async (req, res) => {
  const token = req.query.token || '';
  if (!token) return res.json({ valid: false });
  const [rows] = await pool.execute(
    'SELECT id FROM password_resets WHERE token = ? AND used = 0 AND expires_at > NOW()',
    [token]
  );
  res.json({ valid: rows.length > 0 });
});

module.exports = router;
