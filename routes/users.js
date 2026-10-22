const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const pool    = require('../db/connection');
const { adminOnly, authenticate, signToken, COOKIE_OPTS } = require('../middleware/auth');

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
      'SELECT id, name, email, role, phone, birthdate, provider, password_hash, created_at FROM users WHERE id = ?',
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

    const [rows] = await pool.execute('SELECT id FROM users WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });

    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

module.exports = router;
