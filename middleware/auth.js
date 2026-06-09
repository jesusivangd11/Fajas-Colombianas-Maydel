const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const token = req.cookies?.maydel_token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
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

module.exports = { authenticate, adminOnly, optionalAuth };
