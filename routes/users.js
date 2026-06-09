const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const pool    = require('../db/connection');
const { adminOnly } = require('../middleware/auth');

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
    if (role === 'user' && req.user.id === id)
      return res.status(400).json({ error: 'No puedes quitarte el rol de administrador' });

    // Verificar email único (excluyendo el propio)
    const [dup] = await pool.execute('SELECT id FROM users WHERE email = ? AND id <> ?', [email.trim().toLowerCase(), id]);
    if (dup.length) return res.status(409).json({ error: 'Ese correo ya está en uso por otro usuario' });

    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 10);
      await pool.execute('UPDATE users SET name=?, email=?, role=?, password_hash=? WHERE id=?',
        [name.trim(), email.trim().toLowerCase(), role || 'user', hash, id]);
    } else {
      await pool.execute('UPDATE users SET name=?, email=?, role=? WHERE id=?',
        [name.trim(), email.trim().toLowerCase(), role || 'user', id]);
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
