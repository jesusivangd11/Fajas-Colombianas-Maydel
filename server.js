require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const app = express();
app.set('trust proxy', 1);

app.use(compression());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // Permite que los popups de login social (Google/Facebook) se comuniquen de vuelta
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth/send-otp', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);

// Stripe webhook necesita RAW body antes de express.json
app.use('/api/checkout/webhook', require('./routes/checkout'));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Config publica que expone IDs de analytics y publicKey de Stripe al frontend
app.get('/config.js', (req, res) => {
  const cfg = {
    gaId:        process.env.GA_MEASUREMENT_ID || '',
    pixelId:     process.env.META_PIXEL_ID || '',
    stripeKey:   (process.env.STRIPE_PUBLIC_KEY || '').includes('PEGA_AQUI') ? '' : (process.env.STRIPE_PUBLIC_KEY || ''),
    publicUrl:   process.env.PUBLIC_URL || '',
    waPhone:     process.env.WHATSAPP_PHONE || '526143716816',
    googleClientId: (process.env.GOOGLE_CLIENT_ID || '').includes('PEGA_AQUI') ? '' : (process.env.GOOGLE_CLIENT_ID || ''),
    facebookAppId:  (process.env.FACEBOOK_APP_ID || '').includes('PEGA_AQUI') ? '' : (process.env.FACEBOOK_APP_ID || ''),
  };
  res.type('application/javascript').send(`window.MAYDEL_CFG = ${JSON.stringify(cfg)};`);
});

// Imagenes subidas: cambian poco y pesan, conviene cachearlas fuerte.
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d' }));

// HTML, CSS y JS: 'no-cache' NO desactiva la cache, obliga a revalidar. El
// navegador sigue reusando el archivo, pero pregunta antes y recibe un 304
// vacio si no cambio. Sin esto, moviles (sobre todo Safari en iOS) se quedan
// con el CSS viejo horas despues de un cambio y la pagina se ve rota.
app.use((req, res, next) => {
  if (/\.(html|css|js)$/i.test(req.path) || req.path === '/') {
    res.set('Cache-Control', 'no-cache');
  }
  next();
});

// Bloquea servir como estaticos los archivos del servidor (codigo fuente, config, BD).
// La comparacion es case-insensitive porque el FS de Windows no distingue mayusculas.
const BLOCKED_STATIC = new Set([
  'routes', 'db', 'services', 'middleware', 'node_modules', '.claude', '.git',
  'server.js', 'package.json', 'package-lock.json', '.env', '.env.example', '.gitignore',
]);
app.use((req, res, next) => {
  const first = (req.path.split('/').filter(Boolean)[0] || '').toLowerCase();
  if (BLOCKED_STATIC.has(first)) return res.status(404).end();
  next();
});

// Rutas API
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/users',      require('./routes/users'));
app.use('/api/products',   require('./routes/products'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/brands',     require('./routes/brands'));
app.use('/api/orders',     require('./routes/orders'));
app.use('/api/expenses',   require('./routes/expenses'));
app.use('/api/finance',    require('./routes/finance'));
app.use('/api/upload',     require('./routes/upload'));
app.use('/api/shipping',   require('./routes/shipping'));
app.use('/api/checkout',   require('./routes/checkout'));
app.use('/api/reviews',    require('./routes/reviews'));
app.use('/api/testimonials', require('./routes/testimonials'));
app.use('/api/cart',       require('./routes/cart'));
app.use('/api/wishlist',   require('./routes/wishlist'));
app.use('/api/coupons',    require('./routes/coupons'));

app.use(express.static(path.join(__dirname), { etag: true, lastModified: true }));

// Fallback: API 404 vs HTML 404
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Ruta no encontrada' });
  }
  const accept = (req.headers.accept || '').toLowerCase();
  // Si pidio un asset (imagen, css), devolver 404 plano
  if (!accept.includes('text/html')) {
    return res.status(404).end();
  }
  // Si la ruta NO es la raíz y no existe, mostrar 404 custom
  if (req.path !== '/' && req.path !== '/index.html') {
    return res.status(404).sendFile(path.join(__dirname, '404.html'));
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// En Vercel la app corre como funcion serverless: Vercel la invoca, no escucha un puerto.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
