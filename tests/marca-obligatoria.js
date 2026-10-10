/* =============================================================================
   La marca es obligatoria y filtra  ·  node tests/marca-obligatoria.js
   -----------------------------------------------------------------------------
   Comprueba que:
     1. El modal de producto no deja guardar sin marca.
     2. La API tampoco lo permite (la validación de verdad, no solo la del form).
     3. Un producto con marca aparece en el filtro de marcas de la tienda.
     4. El buscador encuentra por marca, escribiendo su NOMBRE ("Ann Chery"),
        no solo su clave interna ("ann-chery").
   Crea admin y productos temporales, y los borra al terminar.
   ============================================================================= */

require('dotenv').config();
const { chromium } = require('playwright');
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const BASE  = process.env.PUBLIC_URL || 'http://localhost:3000';
const EMAIL = 'qa.marca@test.local';
const PASS  = 'TestMarca-123';
const PROD  = 'ZZ PRUEBA MARCA (borrar)';

const db = () => mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

let fallos = 0;
const check = (nombre, real, esperado) => {
  const ok = String(real) === String(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${nombre.padEnd(50)} ${real}${ok ? '' : `   (esperado ${esperado})`}`);
};

(async () => {
  const c = await db();
  await c.query('DELETE FROM users WHERE email = ?', [EMAIL]);
  await c.query('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)',
    ['QA Marca', EMAIL, await bcrypt.hash(PASS, 10), 'admin']);

  // Marca real de la tienda con la que probar.
  const [[marca]] = await c.query('SELECT `key`, label FROM brands WHERE active = 1 ORDER BY sort_order LIMIT 1');

  try {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASS } });
    if (!login.ok()) throw new Error(`No pude iniciar sesión (${login.status()}). ¿Está el servidor arriba?`);
    const page = await ctx.newPage();

    // ── 1. El formulario exige marca ──────────────────────────────────────
    console.log('\n1) El modal no deja guardar sin marca');
    await page.goto(`${BASE}/dashboard/index.html`);
    await page.evaluate(() => showPanel('products'));
    await page.evaluate(() => openProductModal());

    check('el selector ya no ofrece "Sin marca"',
      await page.$eval('#f-brand option', o => o.textContent.trim()), 'Seleccionar...');
    check('la etiqueta marca el campo como obligatorio',
      await page.$$eval('.form-label', ls => ls.some(l => l.textContent.trim() === 'Marca *')), 'true');

    // Relleno todo MENOS la marca y guardo: no debe crearse nada.
    await page.fill('#f-name', PROD);
    await page.selectOption('#f-category', { index: 1 });
    await page.fill('#f-price', '999');
    await page.click('#productModal .modal-footer .btn-save');
    await page.waitForTimeout(800);

    const tras = await ctx.request.get(`${BASE}/api/products`).then(r => r.json());
    check('sin marca NO se creo el producto', tras.some(p => p.name === PROD), 'false');
    check('el modal sigue abierto',
      await page.$eval('#productModal', e => !e.classList.contains('hidden')), 'true');

    // ── 2. La API tampoco lo permite ──────────────────────────────────────
    console.log('\n2) La API rechaza el producto sin marca');
    const sinMarca = await ctx.request.post(`${BASE}/api/products`, {
      data: { name: PROD, category: 'fajas-reductoras', price: 999 },
    });
    check('POST sin marca -> 400', sinMarca.status(), 400);

    // ── 3. Con marca sí se guarda ─────────────────────────────────────────
    console.log('\n3) Con marca se guarda y sirve de filtro');
    await page.selectOption('#f-brand', marca.key);
    await page.click('#productModal .modal-footer .btn-save');
    await page.waitForTimeout(1200);

    const lista = await ctx.request.get(`${BASE}/api/products`).then(r => r.json());
    const prod  = lista.find(p => p.name === PROD);
    if (!prod) throw new Error('El producto con marca no se guardó');
    check('el producto se guardo con su marca', prod.brand, marca.key);

    // Filtrar por marca en la API (es lo que usa la barra lateral de la tienda).
    const porMarca = await ctx.request.get(`${BASE}/api/products?brand=${marca.key}`).then(r => r.json());
    check('el filtro por marca lo devuelve', porMarca.some(p => p.id === prod.id), 'true');

    // ── 4. El buscador encuentra por NOMBRE de marca ──────────────────────
    console.log('\n4) El buscador encuentra por marca');
    const porNombre = await ctx.request
      .get(`${BASE}/api/products?q=${encodeURIComponent(marca.label)}`).then(r => r.json());
    check(`buscar "${marca.label}" lo encuentra`, porNombre.some(p => p.id === prod.id), 'true');

    // Y la tienda muestra la marca en su barra lateral.
    await page.goto(`${BASE}/tienda.html?brand=${marca.key}`);
    await page.waitForTimeout(1200);
    check('la tienda muestra el filtro de marcas',
      await page.isVisible('#brandFilterCard'), 'true');

    // La ficha del producto enseña la marca, enlazada al filtro.
    await page.goto(`${BASE}/producto.html?id=${prod.id}`);
    await page.waitForSelector('#productMeta .meta-row');
    check('la ficha muestra la marca',
      await page.$eval('#productMeta', (e, label) => e.textContent.includes(label), marca.label), 'true');
    check('la marca enlaza al filtro de la tienda',
      await page.$eval(`#productMeta a[href*="brand="]`, a => a.getAttribute('href')),
      `tienda.html?brand=${encodeURIComponent(marca.key)}`);

    await ctx.request.delete(`${BASE}/api/products/${prod.id}`);
    await browser.close();
  } finally {
    await c.query('DELETE FROM users    WHERE email = ?', [EMAIL]);
    await c.query('DELETE FROM products WHERE name  = ?', [PROD]);
    await c.end();
    console.log('\n(limpieza: admin y producto de prueba eliminados)');
  }

  console.log(fallos === 0 ? '\nTODO CORRECTO.' : `\n${fallos} FALLO(S).`);
  process.exit(fallos ? 1 : 0);
})().catch(err => { console.error('\nError:', err.message); process.exit(1); });
