const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const pool    = require('../db/connection');
const QRCode  = require('qrcode');
const { adminOnly, authenticate, signToken, COOKIE_OPTS } = require('../middleware/auth');
const totp    = require('../services/totp');
const telegram = require('../services/telegram');
const { waitUntil } = require('@vercel/functions');

const securityAlert = (req, title, lines) => waitUntil(
  telegram.notifySecurity(title, lines, req).catch(e => console.error('[avisos] seguridad', e.message)));

function mapUser(r) {
  return {
    id:        r.id,
    name:      r.name,
    email:     r.email,
    role:      r.role,
    birthdate: r.birthdate || null,
    address:   r.address ? (typeof r.address === 'string' ? JSON.parse(r.address) : r.address) : null,
    createdAt: r.created_at,
  };
}

/* ── CUENTA PROPIA ───────────────────────────────────────────────────────────
   Cualquier usuario con sesión (incluido el admin) edita aquí sus propios datos.
   Se definen ANTES de "/:id" para que Express no interprete "me" como un id. */

// GET /api/users/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, phone, birthdate, provider, password_hash, totp_enabled, totp_backup, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const u = rows[0];
    res.json({
      id: u.id, name: u.name, email: u.email, role: u.role,
      phone: u.phone || '', birthdate: u.birthdate || null,
      provider: u.provider || 'local',
      // El frontend usa esto para saber si pedir la contraseña actual o no.
      hasPassword: !!u.password_hash,
      twoFactorEnabled: !!u.totp_enabled,
      backupCodesLeft: u.totp_enabled && Array.isArray(u.totp_backup) ? u.totp_backup.length : 0,
      createdAt: u.created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener tu perfil' });
  }
});

// PUT /api/users/me   { name, email, currentPassword? }
router.put('/me', authenticate, async (req, res) => {
  try {
    const name  = String(req.body.name  || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const currentPassword = req.body.currentPassword || '';

    if (!name)  return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (name.length < 2 || name.length > 100)
      return res.status(400).json({ error: 'El nombre debe tener entre 2 y 100 caracteres' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'El correo no es válido' });

    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const me = rows[0];

    // Cambiar el correo es cambiar la llave con la que entras: exige la contraseña
    // actual para que una sesión abierta ajena no pueda secuestrar la cuenta.
    const emailChanged = email !== me.email;
    if (emailChanged && me.password_hash) {
      if (!currentPassword)
        return res.status(400).json({ error: 'Escribe tu contraseña actual para cambiar el correo' });
      if (!(await bcrypt.compare(currentPassword, me.password_hash)))
        return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }

    if (emailChanged) {
      const [dup] = await pool.execute('SELECT id FROM users WHERE email = ? AND id <> ?', [email, me.id]);
      if (dup.length) return res.status(409).json({ error: 'Ese correo ya está en uso por otra cuenta' });
    }

    // Un correo nuevo no está comprobado: si su dueña real entra después con
    // Google, la contraseña puesta aquí se anula (ver findOrCreateOAuthUser).
    await pool.execute(
      `UPDATE users SET name = ?, email = ?${emailChanged ? ', email_verified = 0' : ''} WHERE id = ?`,
      [name, email, me.id]
    );

    // El JWT guarda nombre y correo: hay que volver a firmarlo.
    const updated = { id: me.id, name, email, role: me.role };
    res.cookie('maydel_token', signToken({ ...updated, password_hash: me.password_hash }), COOKIE_OPTS());
    res.json({ ok: true, user: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar tu perfil' });
  }
});

// PUT /api/users/me/password   { currentPassword, newPassword }
router.put('/me/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || String(newPassword).length < 8)
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });

    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const me = rows[0];

    // Quien entró con Google/Facebook aún no tiene contraseña: puede crear una
    // sin pedirle la anterior. Quien ya tiene, debe confirmarla.
    if (me.password_hash) {
      if (!currentPassword)
        return res.status(400).json({ error: 'Escribe tu contraseña actual' });
      if (!(await bcrypt.compare(currentPassword, me.password_hash)))
        return res.status(401).json({ error: 'La contraseña actual no es correcta' });
      if (await bcrypt.compare(newPassword, me.password_hash))
        return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual' });
    }

    const hash = await bcrypt.hash(String(newPassword), 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, me.id]);

    // La contraseña nueva invalida las demás sesiones abiertas; esta se renueva
    // para que quien la cambió no tenga que volver a entrar.
    res.cookie('maydel_token', signToken({ ...me, password_hash: hash }), COOKIE_OPTS());
    res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cambiar la contraseña' });
  }
});

/* ── VERIFICACIÓN EN DOS PASOS ───────────────────────────────────────────────
   1) setup:   genera un secreto (queda "pendiente") y devuelve el QR para la app.
   2) enable:  con el primer código de la app se activa y se entregan 8 códigos
               de respaldo, que solo se muestran esta vez.
   disable / backup-codes piden la contraseña actual y un código: quien robe una
   sesión abierta no puede quitar la protección ni quedarse con los respaldos. */

// Comprueba la contraseña actual si la cuenta tiene (las de Google no).
async function checkPassword(me, currentPassword) {
  if (!me.password_hash) return true;
  return !!currentPassword && bcrypt.compare(String(currentPassword), me.password_hash);
}

// Comprueba un código de la app (o de respaldo) y lo marca como usado.
async function checkSecondFactor(me, code) {
  const step = totp.verify(totp.decrypt(me.totp_secret), code, me.totp_last_step);
  if (step) {
    const [u] = await pool.execute(
      'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)',
      [step, me.id, step]);
    return u.affectedRows > 0;
  }
  const left = totp.useBackupCode(me.totp_backup, code);
  if (!left) return false;
  await pool.execute('UPDATE users SET totp_backup = ? WHERE id = ?', [JSON.stringify(left), me.id]);
  return true;
}

// POST /api/users/me/2fa/setup  { currentPassword }
router.post('/me/2fa/setup', authenticate, async (req, res) => {
  try {
    const [[me]] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (me.totp_enabled) return res.status(400).json({ error: 'La verificación en dos pasos ya está activa' });
    if (!(await checkPassword(me, req.body.currentPassword)))
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    const secret = totp.generateSecret();
    await pool.execute('UPDATE users SET totp_pending = ? WHERE id = ?', [totp.encrypt(secret), me.id]);
    const url = totp.otpauthUrl(secret, me.email);
    res.json({ secret: secret.match(/.{1,4}/g).join(' '), qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo preparar la verificación' });
  }
});

// POST /api/users/me/2fa/enable  { code }
router.post('/me/2fa/enable', authenticate, async (req, res) => {
  try {
    const [[me]] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (me.totp_enabled) return res.status(400).json({ error: 'La verificación en dos pasos ya está activa' });
    if (!me.totp_pending) return res.status(400).json({ error: 'Primero genera el código QR' });
    const step = totp.verify(totp.decrypt(me.totp_pending), req.body.code);
    if (!step) return res.status(400).json({ error: 'Código incorrecto. Revisa que la hora de tu celular sea automática.' });
    const backup = totp.generateBackupCodes();
    await pool.execute(
      'UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1, totp_last_step = ?, totp_backup = ? WHERE id = ?',
      [step, JSON.stringify(backup.hashes), me.id]);
    securityAlert(req, 'Verificación en dos pasos ACTIVADA', [`👤 ${me.email}`]);
    res.json({ ok: true, backupCodes: backup.codes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo activar la verificación' });
  }
});

// POST /api/users/me/2fa/disable  { currentPassword, code }
router.post('/me/2fa/disable', authenticate, async (req, res) => {
  try {
    const [[me]] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!me.totp_enabled) return res.json({ ok: true });
    if (!(await checkPassword(me, req.body.currentPassword)))
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    if (!(await checkSecondFactor(me, req.body.code)))
      return res.status(401).json({ error: 'Código incorrecto' });
    await pool.execute(
      'UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_pending = NULL, totp_backup = NULL, totp_last_step = NULL WHERE id = ?',
      [me.id]);
    securityAlert(req, '⚠️ Verificación en dos pasos DESACTIVADA', [`👤 ${me.email}`]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo desactivar la verificación' });
  }
});

// POST /api/users/me/2fa/backup-codes  { currentPassword, code }  -> 8 códigos nuevos
router.post('/me/2fa/backup-codes', authenticate, async (req, res) => {
  try {
    const [[me]] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!me.totp_enabled) return res.status(400).json({ error: 'La verificación en dos pasos no está activa' });
    if (!(await checkPassword(me, req.body.currentPassword)))
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    if (!(await checkSecondFactor(me, req.body.code)))
      return res.status(401).json({ error: 'Código incorrecto' });
    const backup = totp.generateBackupCodes();
    await pool.execute('UPDATE users SET totp_backup = ? WHERE id = ?', [JSON.stringify(backup.hashes), me.id]);
    res.json({ ok: true, backupCodes: backup.codes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron generar los códigos' });
  }
});

/* Confirmación con código para acciones que dan o cambian acceso al panel
   (nombrar admin, cambiar contraseña/correo de un admin, borrar un admin). Así,
   aunque alguien robe una sesión abierta, no puede crear un admin de respaldo
   sin el celular. Si quien actúa no tiene la verificación activa, no se pide.
   Devuelve true si se puede continuar; si no, ya respondió. */
async function confirmWithCode(req, res) {
  const [[me]] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!me.totp_enabled) return true;
  if (!req.body.code) {
    res.status(403).json({ error: 'Escribe el código de tu app para confirmar este cambio', needCode: true });
    return false;
  }
  if (!(await checkSecondFactor(me, req.body.code))) {
    res.status(403).json({ error: 'Código incorrecto', needCode: true });
    return false;
  }
  return true;
}

// GET /api/users
router.get('/', adminOnly, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, birthdate, address, created_at FROM users ORDER BY id ASC'
    );
    res.json(rows.map(mapUser));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// PUT /api/users/:id
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, email, role, password } = req.body;

    if (!name || !email) return res.status(400).json({ error: 'Nombre y correo son obligatorios' });
    if (role && !['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
    if (role === 'user' && req.user.id === id)
      return res.status(400).json({ error: 'No puedes quitarte el rol de administrador' });

    const [[target]] = await pool.execute('SELECT id, email, role FROM users WHERE id = ?', [id]);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    const makesAdmin   = role === 'admin' && target.role !== 'admin';
    const setsPassword = !!(password && password.length >= 8);
    const changesEmail = email.trim().toLowerCase() !== target.email;
    if (makesAdmin || ((setsPassword || changesEmail) && target.role === 'admin')) {
      const gate = await confirmWithCode(req, res);
      if (!gate) return;
    }

    // Verificar email único (excluyendo el propio)
    const [dup] = await pool.execute('SELECT id FROM users WHERE email = ? AND id <> ?', [email.trim().toLowerCase(), id]);
    if (dup.length) return res.status(409).json({ error: 'Ese correo ya está en uso por otro usuario' });

    // email_verified va primero: MySQL evalúa el SET en orden, así compara contra
    // el correo anterior. Si el admin cambia el correo, deja de estar comprobado.
    const newEmail = email.trim().toLowerCase();
    if (password && password.length >= 8) {
      const hash = await bcrypt.hash(password, 10);
      await pool.execute('UPDATE users SET email_verified = IF(email = ?, email_verified, 0), name=?, email=?, role=?, password_hash=? WHERE id=?',
        [newEmail, name.trim(), newEmail, role || 'user', hash, id]);
    } else {
      await pool.execute('UPDATE users SET email_verified = IF(email = ?, email_verified, 0), name=?, email=?, role=? WHERE id=?',
        [newEmail, name.trim(), newEmail, role || 'user', id]);
    }
    if (makesAdmin) securityAlert(req, 'Nuevo ADMINISTRADOR', [`👤 ${newEmail}`, `✍️ lo nombró ${req.user.email}`]);
    else if (setsPassword && target.role === 'admin') securityAlert(req, 'Cambiaron la contraseña de un admin', [`👤 ${newEmail}`, `✍️ ${req.user.email}`]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (req.user.id === id)
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });

    const [rows] = await pool.execute('SELECT id, email, role FROM users WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (rows[0].role === 'admin') {
      const gate = await confirmWithCode(req, res);
      if (!gate) return;
      securityAlert(req, 'Se eliminó una cuenta de admin', [`👤 ${rows[0].email}`, `✍️ ${req.user.email}`]);
    }

    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

module.exports = router;
