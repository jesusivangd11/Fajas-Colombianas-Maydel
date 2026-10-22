require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

// Express 4 no atrapa los errores de las rutas async: una consulta que falla
// deja la petición colgada (y en Vercel puede tumbar la función). Esto envuelve
// cada manejador para mandar el error al manejador de errores del final.
for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
  const original = express.Router[method];
  express.Router[method] = function (path, ...handlers) {
    const wrapped = handlers.map(h => (typeof h === 'function' && h.length < 4)
      ? function (req, res, next) {
          try {
            const r = h.call(this, req, res, next);
            if (r && typeof r.catch === 'function') r.catch(next);
          } catch (err) { next(err); }
        }
      : h);
    return original.call(this, path, ...wrapped);
  };
}

const { MySqlStore } = require('./services/rateLimitStore');
const pool = require('./db/connection');

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

// Los contadores viven en la BD (no en memoria) porque en Vercel cada petición
// puede caer en otra instancia. Si la BD falla, se deja pasar (passOnStoreError)
// en vez de bloquear a todas las clientas.
const limiter = (name, windowMin, max, message) => rateLimit({
  windowMs: windowMin * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false,
  store: new MySqlStore(name), passOnStoreError: true,
  message: { error: message || 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
});
const authLimiter = limiter('auth', 15, 20);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/google', authLimiter);
app.use('/api/auth/facebook', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth/send-otp', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);
app.use('/api/auth/register', limiter('register', 60, 10, 'Demasiados registros desde tu conexión. Inténtalo más tarde.'));
app.use('/api/coupons/validate', limiter('coupon', 15, 30));
app.post('/api/orders', limiter('orders', 60, 15, 'Demasiados pedidos seguidos. Escríbenos por WhatsApp si necesitas ayuda.'));
app.post('/api/reviews', limiter('reviews', 60, 10));

// Stripe webhook necesita RAW body antes de express.json: se lee aqui como Buffer
// y express.json lo salta (ya viene leido). La ruta la atiende el router de /api/checkout.
app.use('/api/checkout/webhook', express.raw({ type: 'application/json' }));

// Las imágenes y videos no pasan por aquí (van a /api/upload o directo a Vercel
// Blob), así que el JSON nunca necesita ser grande.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// Además del límite por IP, uno por CUENTA (necesita el body ya leído, por eso va
// aquí): aunque alguien tenga muchas IPs, no puede probar más de 10 contraseñas
// por cuenta cada 15 min. Solo cuentan los intentos FALLIDOS, así que la dueña no
// se bloquea al entrar bien, y Google sigue funcionando aunque esté bloqueado.
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: false, legacyHeaders: false,
  store: new MySqlStore('login-cuenta'), passOnStoreError: true, skipSuccessfulRequests: true,
  keyGenerator: req => String(req.body?.email || '').trim().toLowerCase().slice(0, 150) || 'sin-correo',
  message: { error: 'Demasiados intentos fallidos con esta cuenta. Espera 15 minutos o recupera tu contraseña.' },
}));

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
  '.env.production', '.vercel', '.vscode', 'vercel.json', 'tests', 'graphify-out',
  '.graphify_python', 'guia-del-codigo.md',
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

app.use('/api', (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Petición mal formada' });
  if (err.type === 'entity.too.large')    return res.status(413).json({ error: 'La petición es demasiado grande' });
  console.error('[api]', req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

/* ── SEO / vista previa al compartir ─────────────────────────────────────────
   producto.html se arma con JavaScript en el navegador, pero WhatsApp, Facebook
   y TikTok no ejecutan JavaScript al generar la vista previa de un enlace: sin
   esto, todo producto compartido salía con el logo y "Detalle de producto".
   Aquí se le escriben al HTML el título, la descripción, la foto y los datos
   estructurados (Product) del producto pedido en ?id=. */
const SITE_URL = (process.env.PUBLIC_URL && !process.env.PUBLIC_URL.includes('localhost'))
  ? process.env.PUBLIC_URL.replace(/\/$/, '') : 'https://www.fajascolombianasmaydel.com';
const absUrl = u => !u ? `${SITE_URL}/assets/logo.jpeg` : /^https?:\/\//.test(u) ? u : SITE_URL + (u.startsWith('/') ? u : '/' + u);
const htmlEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let productTemplate = null;

app.get('/producto.html', async (req, res, next) => {
  try {
    productTemplate = productTemplate || require('fs').readFileSync(path.join(__dirname, 'producto.html'), 'utf8');
  } catch (err) { return next(); }
  // Sin producto válido se manda la página tal cual (ella muestra "no encontrado").
  const plain = () => res.type('html').send(productTemplate);
  const id = Number(req.query.id);
  if (!id) return plain();
  try {
    const [[p]] = await pool.execute('SELECT id, name, description, price, stock, images, brand, reference, active FROM products WHERE id = ?', [id]);
    if (!p || !p.active) return plain();
    const url   = `${SITE_URL}/producto.html?id=${p.id}`;
    const title = `${p.name} – Fajas Colombianas Maydel`;
    const desc  = String(p.description || `${p.name}. Fajas colombianas originales con envío a todo México.`).replace(/\s+/g, ' ').trim().slice(0, 190);
    const imgs  = (Array.isArray(p.images) ? p.images : []).slice(0, 5).map(absUrl);
    const ld = {
      '@context': 'https://schema.org', '@type': 'Product',
      name: p.name, description: desc, image: imgs.length ? imgs : [absUrl('')], sku: p.reference || String(p.id),
      ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
      offers: {
        '@type': 'Offer', url, priceCurrency: 'MXN', price: Number(p.price).toFixed(2),
        availability: Number(p.stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
      },
    };
    const head = `
  <title>${htmlEsc(title)}</title>
  <meta name="description" content="${htmlEsc(desc)}">
  <link rel="canonical" href="${url}">
  <meta property="og:title" content="${htmlEsc(p.name)}">
  <meta property="og:description" content="${htmlEsc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${htmlEsc(imgs[0] || absUrl(''))}">
  <meta property="product:price:amount" content="${Number(p.price).toFixed(2)}">
  <meta property="product:price:currency" content="MXN">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
`;
    const html = productTemplate
      .replace(/<title>[\s\S]*?<\/title>\s*/, '')
      .replace(/<meta name="description"[^>]*>\s*/, '')
      .replace(/<meta property="og:image"[^>]*>\s*/, '')
      .replace('</head>', head + '</head>');
    res.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.type('html').send(html);
  } catch (err) {
    console.error('[seo producto]', err.message);
    plain();
  }
});

// Sitemap con las páginas fijas y TODOS los productos activos (se actualiza solo).
app.get('/sitemap.xml', async (req, res) => {
  const fixed = [
    ['/', 'weekly', '1.0'], ['/tienda.html', 'daily', '0.9'], ['/nosotros.html', 'monthly', '0.5'],
    ['/faq.html', 'monthly', '0.5'], ['/terminos.html', 'yearly', '0.2'], ['/aviso-de-privacidad.html', 'yearly', '0.2'],
  ];
  let prods = [], cats = [];
  try {
    [prods] = await pool.execute('SELECT id, updated_at FROM products WHERE active = 1 ORDER BY id');
    [cats]  = await pool.execute('SELECT `key` FROM categories WHERE active = 1 ORDER BY sort_order');
  } catch (err) { console.error('[sitemap]', err.message); }
  const u = (loc, freq, pri, mod) => `  <url><loc>${htmlEsc(SITE_URL + loc)}</loc>${mod ? `<lastmod>${new Date(mod).toISOString().slice(0, 10)}</lastmod>` : ''}<changefreq>${freq}</changefreq><priority>${pri}</priority></url>`;
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...fixed.map(([l, f, p]) => u(l, f, p)),
    ...cats.map(c => u(`/tienda.html?cat=${encodeURIComponent(c.key)}`, 'weekly', '0.8')),
    ...prods.map(p => u(`/producto.html?id=${p.id}`, 'weekly', '0.7', p.updated_at)),
    '</urlset>'].join('\n');
  res.set('Cache-Control', 'public, max-age=0, s-maxage=3600');
  res.type('application/xml').send(xml);
});

// dotfiles:'ignore' => nunca sirve archivos/carpetas que empiezan con punto (.env*, .git, .vercel...)
app.use(express.static(path.join(__dirname), { etag: true, lastModified: true, dotfiles: 'ignore' }));

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
