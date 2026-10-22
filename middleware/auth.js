const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const pool   = require('../db/connection');

// El token lleva dentro nombre y correo, así que cualquier ruta que los cambie
// debe volver a firmarlo y reenviar la cookie (si no, la sesión sigue mostrando
// los datos viejos hasta que el usuario cierre y vuelva a iniciar sesión).
const COOKIE_OPTS = () => ({
  httpOnly: true,
  // En Vercel siempre es HTTPS, aunque NODE_ENV no diga "production".
  secure:   process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000,
});

// Huella de la contraseña guardada. Va dentro del token: si la contraseña
// cambia (o la restablecen), la huella ya no coincide y todas las sesiones
// abiertas antes del cambio dejan de valer.
function passwordStamp(hash) {
  return crypto.createHash('sha256')
    .update(String(hash || '') + '|' + (process.env.JWT_SECRET || ''))
    .digest('hex').slice(0, 16);
}

// `user` debe ser la fila de la BD (o traer password_hash) para que la huella
// corresponda a su contraseña actual.
function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, pv: passwordStamp(user.password_hash) },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// Lee la sesión de la cookie y la contrasta con la BD: un usuario borrado, al
// que le cambiaron el rol o la contraseña, no puede seguir entrando con un
// token viejo. Devuelve la fila del usuario o null.
async function sessionUser(req) {
  const token = req.cookies?.maydel_token;
  if (!token) return null;
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); } catch { return null; }
  const [rows] = await pool.execute(
    'SELECT id, name, email, role, password_hash FROM users WHERE id = ?', [decoded.id]
  );
  const row = rows[0];
  if (!row || decoded.pv !== passwordStamp(row.password_hash)) return null;
  return row;
}

// Sesión deslizante: cada petición autenticada vuelve a emitir la cookie con el
// plazo completo. Así, mientras el usuario sigue trabajando (dar de alta
// productos, subir imágenes, etc.), la sesión NUNCA caduca a media tarea; solo
// expira tras varios días de inactividad total. Evita el "No autenticado"
// sorpresivo en sesiones largas de administración.
function startSession(req, res, row) {
  req.user = { id: row.id, name: row.name, email: row.email, role: row.role };
  res.cookie('maydel_token', signToken(row), COOKIE_OPTS());
}

function guard(requireAdmin) {
  return async (req, res, next) => {
    if (!req.cookies?.maydel_token) return res.status(401).json({ error: 'No autenticado' });
    let row;
    try { row = await sessionUser(req); } catch (err) {
      console.error('auth', err.message);
      return res.status(500).json({ error: 'Error al verificar la sesión' });
    }
    if (!row) {
      res.clearCookie('maydel_token');
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }
    if (requireAdmin && row.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
    startSession(req, res, row);
    next();
  };
}

const authenticate = guard(false);
const adminOnly    = guard(true);

async function optionalAuth(req, res, next) {
  try {
    const row = await sessionUser(req);
    if (row) req.user = { id: row.id, name: row.name, email: row.email, role: row.role };
  } catch {}
  next();
}

module.exports = { authenticate, adminOnly, optionalAuth, signToken, sessionUser, COOKIE_OPTS };
