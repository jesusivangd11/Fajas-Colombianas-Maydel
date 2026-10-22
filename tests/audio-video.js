/* =============================================================================
   Prueba del SONIDO del video  ·  node tests/audio-video.js
   -----------------------------------------------------------------------------
   Recorre el flujo real: sube un video por "Agregar producto", guarda el
   producto y lo reproduce en producto.html como una clienta.

   No se conforma con mirar la bandera .muted: cuenta los BYTES DE AUDIO
   DECODIFICADOS por el navegador, que es lo único que demuestra que está
   saliendo sonido de verdad. Si algún día algo vuelve a silenciar el video
   (una política del navegador, un atributo, un CSS), esta prueba se pone roja.

   Requisitos: servidor levantado y al menos un .mp4 con audio en uploads/.
   Limpia detrás de sí: admin, producto y archivo subido.
   ============================================================================= */

require('dotenv').config();
const { chromium } = require('playwright');
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');

const BASE  = process.env.PUBLIC_URL || 'http://localhost:3000';
const EMAIL = 'qa.audio@test.local';
const PASS  = 'TestAudio-123';
const PROD  = 'ZZ PRUEBA AUDIO (borrar)';
const UPLOADS = path.join(__dirname, '..', 'uploads');

const db = () => mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

// Misma lectura de cajas MP4 que usa routes/upload.js: 'soun' = pista de audio.
function tieneAudio(archivo) {
  if (!/\.(mp4|mov)$/i.test(archivo)) return false;
  const buf = fs.readFileSync(archivo);
  let i = buf.indexOf('hdlr', 0, 'latin1');
  while (i !== -1) {
    if (buf.toString('latin1', i + 12, i + 16) === 'soun') return true;
    i = buf.indexOf('hdlr', i + 4, 'latin1');
  }
  return false;
}

let fallos = 0;
const check = (nombre, real, esperado) => {
  const ok = String(real) === String(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${nombre.padEnd(46)} ${real}${ok ? '' : `   (esperado ${esperado})`}`);
};

// Radiografía de un <video>: la bandera muted no basta.
const radiografia = el => ({
  muted: el.muted, volume: el.volume, paused: el.paused,
  audioBytes: el.webkitAudioDecodedByteCount ?? -1,
});

(async () => {
  const fuente = fs.readdirSync(UPLOADS)
    .map(f => path.join(UPLOADS, f))
    .find(f => tieneAudio(f));
  if (!fuente) {
    console.log('OMITIDA: no hay ningún .mp4 con audio en uploads/ para usar de muestra.');
    process.exit(0);
  }
  console.log('Video de muestra:', path.basename(fuente));

  const c = await db();
  await c.query('DELETE FROM users WHERE email = ?', [EMAIL]);
  await c.query('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)',
    ['QA Audio', EMAIL, await bcrypt.hash(PASS, 10), 'admin']);

  let subido = null;
  try {
    // La política de autoplay por defecto de Playwright es más laxa que la de un
    // Chrome real; la endurecemos para probar en las mismas condiciones.
    const browser = await chromium.launch({ args: ['--autoplay-policy=document-user-activation-required'] });
    const ctx = await browser.newContext();
    const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASS } });
    if (!login.ok()) throw new Error(`No pude iniciar sesión (${login.status()}). ¿Está el servidor arriba?`);
    const page = await ctx.newPage();

    // ── 1. Subir el video tal como lo hace el admin ─────────────────────────
    console.log('\n1) Subida por "Agregar producto"');
    await page.goto(`${BASE}/dashboard/index.html`);
    await page.evaluate(() => showPanel('products'));
    await page.evaluate(() => openProductModal());
    await page.click('.tab-btn:has-text("Imágenes")');

    const img = (l, col) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="96"><rect width="80" height="96" fill="${col}"/><text x="40" y="58" font-size="40" fill="#fff" text-anchor="middle">${l}</text></svg>`);
    for (const [l, col] of [['A', '#c0392b'], ['B', '#27ae60'], ['C', '#2980b9']]) {
      await page.fill('#imgUrlInput', img(l, col));
      await page.evaluate(() => addImageUrl());
    }

    await page.setInputFiles('#videoFileInput', fuente);
    await page.waitForFunction(() => currentVideos.length > 0 && currentVideos[0].url, { timeout: 60000 });
    subido = path.join(UPLOADS, path.basename(await page.evaluate(() => currentVideos[0].url)));

    // El archivo guardado debe conservar su pista de audio.
    check('el archivo subido conserva el audio', tieneAudio(subido), 'true');

    // La previsualización del dashboard debe sonar.
    await page.waitForSelector('#videoPreview video');
    await page.$eval('#videoPreview video', el => el.play().catch(() => {}));
    await page.waitForTimeout(2500);
    const prev = await page.$eval('#videoPreview video', radiografia);
    check('previsualizacion: no silenciada', prev.muted, 'false');
    check('previsualizacion: sale audio', prev.audioBytes > 0, 'true');

    // La miniatura de la tira SÍ va muda, y es a propósito.
    check('la miniatura de la tira va muda (a proposito)',
      await page.$eval('#imgPreview .is-video video', el => el.muted), 'true');

    // ── 2. Guardar ──────────────────────────────────────────────────────────
    await page.evaluate(() => switchTab('info', document.querySelector('.tab-btn')));
    await page.fill('#f-name', PROD);
    await page.click('#catCheckboxes [data-cat]'); // primera categoría
    await page.selectOption('#f-brand', { index: 1 }); // la marca es obligatoria
    await page.$eval('#f-price', e => { e.value = '999'; }); // el precio vive en otra pestaña del modal
    await page.click('#productModal .modal-footer .btn-save');
    await page.waitForTimeout(1500);

    const lista = await ctx.request.get(`${BASE}/api/products`).then(r => r.json());
    const prod = lista.find(p => p.name === PROD);
    if (!prod) throw new Error('El producto no se guardó');

    // ── 3. Reproducirlo como una clienta ────────────────────────────────────
    console.log('\n2) Reproducción en producto.html');
    await page.goto(`${BASE}/producto.html?id=${prod.id}`);
    await page.waitForSelector('.gallery-thumb');

    const tipos = await page.$$eval('.gallery-thumb', e => e.map(t => t.querySelector('video') ? 'V' : 'I').join(''));
    const thumbs = await page.$$('.gallery-thumb');
    await thumbs[tipos.indexOf('V')].click();   // gesto real: es lo que autoriza el audio
    await page.waitForTimeout(3000);

    const main = await page.$eval('#galleryMain video', radiografia);
    check('el video NO esta silenciado', main.muted, 'false');
    check('el volumen esta al maximo', main.volume, '1');
    check('el video se esta reproduciendo', main.paused, 'false');
    check(`SALE AUDIO DE VERDAD (${main.audioBytes} bytes)`, main.audioBytes > 0, 'true');

    await ctx.request.delete(`${BASE}/api/products/${prod.id}`);
    await browser.close();
  } finally {
    await c.query('DELETE FROM users    WHERE email = ?', [EMAIL]);
    await c.query('DELETE FROM products WHERE name  = ?', [PROD]);
    await c.end();
    if (subido && fs.existsSync(subido)) fs.unlinkSync(subido); // no dejamos basura en uploads/
    console.log('\n(limpieza: admin, producto y video subido eliminados)');
  }

  console.log(fallos === 0 ? '\nTODO CORRECTO: el video suena de punta a punta.' : `\n${fallos} FALLO(S).`);
  process.exit(fallos ? 1 : 0);
})().catch(err => { console.error('\nError:', err.message); process.exit(1); });
