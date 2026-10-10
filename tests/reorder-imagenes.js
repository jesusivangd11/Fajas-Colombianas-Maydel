/* =============================================================================
   Prueba de arrastre de imágenes  ·  node tests/reorder-imagenes.js
   -----------------------------------------------------------------------------
   Abre el dashboard en un Chromium real y arrastra las miniaturas del modal de
   producto con el ratón de verdad (pointerdown / pointermove / pointerup), que
   es la única forma de comprobar esto: la lógica depende de elementFromPoint y
   de cómo el navegador reparte los eventos, y eso no se puede simular a mano.

   Requisitos: el servidor levantado (npm start) y la BD accesible.
   Crea un admin temporal para no tocar la cuenta real, y lo borra al terminar.
   ============================================================================= */

require('dotenv').config();
const { chromium } = require('playwright');
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const BASE  = process.env.PUBLIC_URL || 'http://localhost:3000';
const EMAIL = 'qa.drag@test.local';
const PASS  = 'TestDrag-123';
const PROD  = 'ZZ PRUEBA ARRASTRE (borrar)';

const db = () => mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

// Imágenes de verdad (SVG en data URI) para que el layout sea el real.
const img = (letra, color) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="96">
       <rect width="80" height="96" fill="${color}"/>
       <text x="40" y="58" font-size="40" fill="#fff" text-anchor="middle">${letra}</text>
     </svg>`);

const IMGS = [['A', '#c0392b'], ['B', '#27ae60'], ['C', '#2980b9'], ['D', '#8e44ad']]
  .map(([l, c]) => ({ letra: l, url: img(l, c) }));
const letraDe = url => IMGS.find(i => i.url === url)?.letra ?? '?';

let fallos = 0;
const check = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${nombre.padEnd(46)} ${real}${ok ? '' : `   (esperado ${esperado})`}`);
};

async function conAdminTemporal(fn) {
  const c = await db();
  const hash = await bcrypt.hash(PASS, 10);
  await c.query('DELETE FROM users WHERE email = ?', [EMAIL]);
  await c.query('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)',
    ['QA Arrastre', EMAIL, hash, 'admin']);
  try {
    return await fn();
  } finally {
    await c.query('DELETE FROM users WHERE email = ?', [EMAIL]);
    await c.query('DELETE FROM products WHERE name = ?', [PROD]);
    await c.end();
    console.log('\n(limpieza: admin temporal y producto de prueba eliminados)');
  }
}

conAdminTemporal(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });

  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASS } });
  if (!login.ok()) throw new Error(`No pude iniciar sesión (${login.status()}). ¿Está el servidor arriba?`);

  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  ERROR DE JS EN LA PÁGINA:', e.message); fallos++; });

  await page.goto(`${BASE}/dashboard/index.html`);
  await page.evaluate(() => showPanel('products'));
  await page.evaluate(() => openProductModal());
  await page.click('.tab-btn:has-text("Imágenes")');

  for (const { url } of IMGS) {
    await page.fill('#imgUrlInput', url);
    await page.evaluate(() => addImageUrl());
  }
  await page.waitForSelector('#imgPreview .img-preview-item');

  const orden        = async () => (await page.evaluate(() => currentImages)).map(letraDe).join('');
  const ordenVisible = async () => (await page.$$eval('#imgPreview .img-preview-item img', e => e.map(i => i.src))).map(letraDe).join('');

  // Arrastre con ratón real. `lado` decide si soltamos antes o después de la
  // miniatura de destino: hay que cruzar su mitad para que el hueco se mueva.
  async function arrastrar(desdeIdx, haciaIdx, lado /* 'izq' | 'der' */) {
    const cajas = await page.$$eval('#imgPreview .img-preview-item',
      els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    const o = cajas[desdeIdx], d = cajas[haciaIdx];
    const ox = o.x + o.w / 2, oy = o.y + o.h / 2;
    const dx = lado === 'izq' ? d.x + d.w * 0.15 : d.x + d.w * 0.85;

    await page.mouse.move(ox, oy);
    await page.mouse.down();
    await page.mouse.move(ox + 10, oy, { steps: 3 });          // supera el umbral de 6px
    await page.mouse.move(dx, d.y + d.h / 2, { steps: 25 });   // recorrido gradual
    await page.mouse.up();
    await page.waitForTimeout(120);
  }

  console.log('\nEstado inicial:', await orden());
  check('orden inicial', await orden(), 'ABCD');

  // El caso que fallaba con setPointerCapture: insertBefore saca el nodo del DOM
  // y eso libera la captura, matando el arrastre a mitad de camino.
  await arrastrar(3, 0, 'izq');
  check('ULTIMA -> PRIMERA (el caso que fallaba)', await orden(), 'DABC');
  check('  ...lo que se ve coincide con lo guardado', await ordenVisible(), await orden());
  check('  ...la nueva portada es la D',
    letraDe(await page.$eval('#imgPreview .img-preview-item:first-child img', e => e.src)), 'D');

  await arrastrar(0, 3, 'der');
  check('PRIMERA -> ULTIMA', await orden(), 'ABCD');
  await arrastrar(1, 2, 'der');
  check('vecina a la derecha', await orden(), 'ACBD');
  await arrastrar(2, 0, 'izq');
  check('del medio a la primera', await orden(), 'BACD');

  // Un clic suelto no debe reordenar (umbral de 6 px).
  const antes = await orden();
  const caja = await page.$eval('#imgPreview .img-preview-item',
    e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(caja.x, caja.y);
  await page.waitForTimeout(80);
  check('un clic simple no reordena', await orden(), antes);

  // La X sigue siendo un botón, no un tirador.
  const nAntes = (await page.evaluate(() => currentImages)).length;
  await page.click('#imgPreview .img-preview-item:first-child .img-remove');
  await page.waitForTimeout(80);
  check('la X sigue borrando',
    String((await page.evaluate(() => currentImages)).length), String(nAntes - 1));

  check('no quedan fantasmas en el DOM',
    String(await page.$$eval('.img-ghost', e => e.length)), '0');

  // Lo que de verdad importa: que el orden llegue a la BD.
  const ordenAlGuardar = await orden();
  await page.evaluate(() => switchTab('info', document.querySelector('.tab-btn')));
  await page.fill('#f-name', PROD);
  await page.selectOption('#f-category', { index: 1 });
  await page.selectOption('#f-brand', { index: 1 }); // la marca es obligatoria
  await page.fill('#f-price', '999');
  await page.click('#productModal .modal-footer .btn-save');
  await page.waitForTimeout(1200);

  const lista = await ctx.request.get(`${BASE}/api/products`).then(r => r.json());
  const prod = (Array.isArray(lista) ? lista : lista.products || []).find(p => p.name === PROD);
  if (!prod) check('el producto se guardo', 'no se encontro', 'encontrado');
  else       check('el orden llega intacto a la BASE DE DATOS', (prod.images || []).map(letraDe).join(''), ordenAlGuardar);

  await browser.close();
})
  .then(() => {
    console.log(fallos === 0 ? '\nTODO CORRECTO.' : `\n${fallos} FALLO(S).`);
    process.exit(fallos ? 1 : 0);
  })
  .catch(err => { console.error('\nError:', err.message); process.exit(1); });
