// Ajustes de la tienda que se cambian desde el panel (sin tocar Vercel).
// La tabla se crea sola la primera vez.
const pool = require('../db/connection');

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool.execute(`CREATE TABLE IF NOT EXISTS app_settings (
      name  VARCHAR(64) PRIMARY KEY,
      value TEXT NOT NULL
    )`).catch(err => { tableReady = null; throw err; });
  }
  return tableReady;
}

async function get(name) {
  await ensureTable();
  const [[row]] = await pool.execute('SELECT value FROM app_settings WHERE name = ?', [name]);
  return row ? row.value : null;
}

async function set(name, value) {
  await ensureTable();
  await pool.execute(
    'INSERT INTO app_settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [name, String(value)]
  );
}

// Solo inserta si no existe (dos instancias a la vez se quedan con el primero).
async function setIfMissing(name, value) {
  await ensureTable();
  await pool.execute('INSERT IGNORE INTO app_settings (name, value) VALUES (?, ?)', [name, String(value)]);
}

// Correos que reciben el aviso de cada venta. Si se guardaron desde el panel
// mandan esos; si no, el ADMIN_EMAIL de Vercel.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function adminEmails() {
  let saved = null;
  try { saved = await get('notify_emails'); } catch (err) { console.error('[ajustes] notify_emails', err.message); }
  const list = (saved != null ? saved : (process.env.ADMIN_EMAIL || ''))
    .split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(e => EMAIL_RE.test(e));
  return [...new Set(list)].slice(0, 5);
}

module.exports = { get, set, setIfMissing, adminEmails, EMAIL_RE };
