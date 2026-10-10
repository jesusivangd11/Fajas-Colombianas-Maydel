const jwt = require('jsonwebtoken');

// El token lleva dentro nombre y correo, así que cualquier ruta que los cambie
// debe volver a firmarlo y reenviar la cookie (si no, la sesión sigue mostrando
// los datos viejos hasta que el usuario cierre y vuelva a iniciar sesión).
const COOKIE_OPTS = () => ({
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000,
});

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// Sesión deslizante: cada petición autenticada vuelve a emitir la cookie con el
// plazo completo. Así, mientras el usuario sigue trabajando (dar de alta
// productos, subir imágenes, etc.), la sesión NUNCA caduca a media tarea; solo
// expira tras varios días de inactividad total. Evita el "No autenticado"
// sorpresivo en sesiones largas de administración.
function refreshCookie(req, res) {
  res.cookie('maydel_token', signToken(req.user), COOKIE_OPTS());
}

function authenticate(req, res, next) {
  const token = req.cookies?.maydel_token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    refreshCookie(req, res);
    next();
  } catch {
    res.clearCookie('maydel_token');
    res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function adminOnly(req, res, next) {
  const token = req.cookies?.maydel_token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
    refreshCookie(req, res);
    next();
  } catch {
    res.clearCookie('maydel_token');
    res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function optionalAuth(req, res, next) {
  const token = req.cookies?.maydel_token;
  if (token) {
    try { req.user = jwt.verify(token, process.env.JWT_SECRET); } catch {}
  }
  next();
}

module.exports = { authenticate, adminOnly, optionalAuth, signToken, COOKIE_OPTS };
