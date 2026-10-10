/* =============================================================================
   Prueba de la galería y la posición del video  ·  node tests/galeria-video.js
   -----------------------------------------------------------------------------
   Recorre el flujo completo en un Chromium real:
     1. Dashboard: mete imágenes + video y comprueba que el video entra en 2ª
        posición; luego lo arrastra al frente.
     2. Guarda y verifica que la posición llega a la base de datos.
     3. Abre producto.html y recorre la galería con las flechas y el teclado.

   Requisitos: servidor levantado (npm start) y BD accesible.
   Usa un admin y un producto temporales, y los borra al terminar.
   ============================================================================= */

require('dotenv').config();
const { chromium } = require('playwright');
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const BASE  = process.env.PUBLIC_URL || 'http://localhost:3000';
const EMAIL = 'qa.galeria@test.local';
const PASS  = 'TestGaleria-123';
const PROD  = 'ZZ PRUEBA GALERIA (borrar)';
const VIDEO = 'https://ejemplo.test/video-de-prueba.mp4';

const db = () => mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

const img = (letra, color) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="96">
       <rect width="80" height="96" fill="${color}"/>
       <text x="40" y="58" font-size="40" fill="#fff" text-anchor="middle">${letra}</text>
     </svg>`);

const IMGS = [['A', '#c0392b'], ['B', '#27ae60'], ['C', '#2980b9']].map(([l, c]) => ({ letra: l, url: img(l, c) }));
const letraDe = url => (url === VIDEO ? 'V' : IMGS.find(i => i.url === url)?.letra ?? '?');

let fallos = 0;
const check = (nombre, real, esperado) => {
  const ok = String(real) === String(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${nombre.padEnd(48)} ${real}${ok ? '' : `   (esperado ${esperado})`}`);
};

async function conTemporales(fn) {
  const c = await db();
  const hash = await bcrypt.hash(PASS, 10);
  await c.query('DELETE FROM users WHERE email = ?', [EMAIL]);
  await c.query('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)',
    ['QA Galeria', EMAIL, hash, 'admin']);
  try { return await fn(); }
  finally {
    await c.query('DELETE FROM users    WHERE email = ?', [EMAIL]);
    await c.query('DELETE FROM products WHERE name  = ?', [PROD]);
    await c.end();
    console.log('\n(limpieza: admin y producto de prueba eliminados)');
  }
}

conTemporales(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });

  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASS } });
  if (!login.ok()) throw new Error(`No pude iniciar sesión (${login.status()}). ¿Está el servidor arriba?`);

  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  ERROR DE JS EN LA PÁGINA:', e.message); fallos++; });

  // ── 0. NAVEGACIÓN: logo y "Ver tienda" ────────────────────────────────────
  console.log('\n0) Logo y "Ver tienda"');
  await page.goto(`${BASE}/dashboard/index.html`);

  check('el logo del panel es un enlace',
    await page.$eval('.dash-logo', e => e.tagName), 'A');
  check('el logo apunta al inicio',
    await page.$eval('.dash-logo', e => new URL(e.href).pathname), '/index.html');
  // "Ver tienda" debe ir por encima de la primera sección del menú.
  check('"Ver tienda" esta arriba del todo',
    await page.$eval('.dash-nav', nav => {
      const items = [...nav.children];
      return items.findIndex(e => e.classList.contains('dash-nav-store')) <
             items.findIndex(e => e.classList.contains('dash-nav-section'));
    }), 'true');

  // El logo lleva al inicio de verdad.
  await page.click('.dash-logo');
  await page.waitForLoadState();
  check('al pulsar el logo llega al inicio', new URL(page.url()).pathname, '/index.html');

  // Y en la tienda el logo también.
  check('el logo de la tienda apunta al inicio',
    await page.$eval('.logo-link', e => new URL(e.href).pathname), '/index.html');

  // ── 1. DASHBOARD: colocar el video ────────────────────────────────────────
  console.log('\n1) Dashboard: posición del video');
  await page.goto(`${BASE}/dashboard/index.html`);
  await page.evaluate(() => showPanel('products'));
  await page.evaluate(() => openProductModal());
  await page.click('.tab-btn:has-text("Imágenes")');

  for (const { url } of IMGS) {
    await page.fill('#imgUrlInput', url);
    await page.evaluate(() => addImageUrl());
  }
  await page.fill('#videoUrlInput', VIDEO);
  await page.evaluate(() => addVideoUrl());
  await page.waitForTimeout(150);

  // Cómo se ve la tira: I = imagen, V = video.
  const tira = () => page.$$eval('#imgPreview .img-preview-item',
    els => els.map(e => (e.dataset.kind === 'video' ? 'V' : 'I')).join(''));

  check('el video entra en 2a posicion', await tira(), 'IVII');
  check('videoPosition = 1', await page.evaluate(() => currentVideos[0].position), '1');

  // Arrastrar el video (índice 1) hasta el frente.
  async function arrastrar(desde, hacia, lado) {
    const cajas = await page.$$eval('#imgPreview .img-preview-item',
      els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    const o = cajas[desde], d = cajas[hacia];
    const ox = o.x + o.w / 2, oy = o.y + o.h / 2;
    const dx = lado === 'izq' ? d.x + d.w * 0.15 : d.x + d.w * 0.85;
    await page.mouse.move(ox, oy);
    await page.mouse.down();
    await page.mouse.move(ox + 10, oy, { steps: 3 });
    await page.mouse.move(dx, d.y + d.h / 2, { steps: 25 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }

  await arrastrar(1, 0, 'izq');
  check('el video arrastrado al frente', await tira(), 'VIII');
  check('videoPosition = 0', await page.evaluate(() => currentVideos[0].position), '0');
  check('las imagenes no se descolocaron',
    (await page.evaluate(() => currentImages)).map(letraDe).join(''), 'ABC');

  // ── 2. GUARDAR: ¿llega a la BD? ───────────────────────────────────────────
  console.log('\n2) Guardado en la base de datos');
  await page.evaluate(() => switchTab('info', document.querySelector('.tab-btn')));
  await page.fill('#f-name', PROD);
  await page.selectOption('#f-category', { index: 1 });
  await page.selectOption('#f-brand', { index: 1 }); // la marca es obligatoria
  await page.fill('#f-price', '999');
  await page.click('#productModal .modal-footer .btn-save');
  await page.waitForTimeout(1200);

  const lista = await ctx.request.get(`${BASE}/api/products`).then(r => r.json());
  const prod  = (Array.isArray(lista) ? lista : []).find(p => p.name === PROD);
  if (!prod) { check('el producto se guardo', 'no se encontro', 'encontrado'); }
  else {
    check('videoPosition guardado', prod.videoPosition, 0);
    check('imagenes guardadas', (prod.images || []).map(letraDe).join(''), 'ABC');
    check('el video se guardo', prod.video, VIDEO);
  }

  // ── 3. PÁGINA DE PRODUCTO: la galería ─────────────────────────────────────
  console.log('\n3) Galería en producto.html');
  await page.goto(`${BASE}/producto.html?id=${prod.id}`);
  await page.waitForSelector('.gallery-thumb');

  const tipoPrincipal = () => page.$eval('#galleryMain', e => e.querySelector('video') ? 'V' : (e.querySelector('img') ? 'I' : '-'));
  const contador      = () => page.$eval('#galleryCounter', e => e.textContent.trim());

  check('hay 4 miniaturas (3 fotos + video)', await page.$$eval('.gallery-thumb', e => e.length), 4);
  check('el video abre primero (asi se guardo)', await tipoPrincipal(), 'V');
  check('contador inicial', await contador(), '1 / 4');
  check('las flechas se ven', await page.isVisible('#galleryNext'), 'true');

  // El video NO debe arrancar solo al abrir la página...
  check('el video no se autoreproduce al abrir',
    await page.$eval('#galleryMain video', v => v.paused), 'true');
  // ...pero SÍ debe estar con el sonido puesto (el bug de "se reproduce mudo").
  check('el video NO esta silenciado',
    await page.$eval('#galleryMain video', v => v.muted), 'false');
  check('el volumen esta al maximo',
    await page.$eval('#galleryMain video', v => v.volume), '1');

  await page.click('#galleryNext');
  await page.waitForTimeout(100);
  check('flecha derecha -> 1a imagen', await tipoPrincipal(), 'I');
  check('contador tras avanzar', await contador(), '2 / 4');

  await page.click('#galleryPrev');
  await page.waitForTimeout(100);
  check('flecha izquierda -> vuelve al video', await tipoPrincipal(), 'V');
  check('contador tras retroceder', await contador(), '1 / 4');

  // Da la vuelta: desde la primera, hacia atrás, hasta la última.
  await page.click('#galleryPrev');
  await page.waitForTimeout(100);
  check('desde la 1a hacia atras da la vuelta a la ultima', await contador(), '4 / 4');

  // Teclado.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  check('teclado -> flecha derecha da la vuelta a la 1a', await contador(), '1 / 4');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  check('teclado -> avanza', await contador(), '2 / 4');

  // Deslizar con el dedo (arrastre horizontal sobre la imagen).
  const stage = await page.$eval('#galleryStage', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(stage.x, stage.y);
  await page.mouse.down();
  await page.mouse.move(stage.x - 120, stage.y, { steps: 12 }); // deslizar a la izquierda = siguiente
  await page.mouse.up();
  await page.waitForTimeout(120);
  check('deslizar a la izquierda avanza', await contador(), '3 / 4');

  await page.mouse.move(stage.x, stage.y);
  await page.mouse.down();
  await page.mouse.move(stage.x + 120, stage.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  check('deslizar a la derecha retrocede', await contador(), '2 / 4');

  await ctx.request.delete(`${BASE}/api/products/${prod.id}`);
  await browser.close();
})
  .then(() => {
    console.log(fallos === 0 ? '\nTODO CORRECTO.' : `\n${fallos} FALLO(S).`);
    process.exit(fallos ? 1 : 0);
  })
  .catch(err => { console.error('\nError:', err.message); process.exit(1); });
