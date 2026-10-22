const pool = require('../db/connection');

/* Almacén de express-rate-limit sobre MySQL.
   En Vercel cada petición puede caer en una instancia distinta de la función,
   así que un contador en memoria casi nunca llega al límite. Este guarda los
   intentos en la tabla rate_limits, compartida por todas las instancias.
   Ventana fija: la llave lleva el número de ventana, así que cada ventana
   empieza en 0 sin tener que comparar fechas. */
let ready = null;
function ensureTable() {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        k          VARCHAR(191) NOT NULL PRIMARY KEY,
        hits       INT NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        INDEX idx_rl_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `).catch(err => { ready = null; throw err; });
  }
  return ready;
}

class MySqlStore {
  constructor(prefix) { this.prefix = prefix; this.localKeys = false; }

  init(options) { this.windowMs = options.windowMs; }

  bucket() {
    const n = Math.floor(Date.now() / this.windowMs);
    return { n, resetTime: new Date((n + 1) * this.windowMs) };
  }

  key(key, n) { return `${this.prefix}:${n}:${key}`.slice(0, 191); }

  async increment(key) {
    await ensureTable();
    const { n, resetTime } = this.bucket();
    const k = this.key(key, n);
    await pool.execute(
      'INSERT INTO rate_limits (k, hits, expires_at) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE hits = hits + 1',
      [k, resetTime]
    );
    const [[row]] = await pool.execute('SELECT hits FROM rate_limits WHERE k = ?', [k]);
    // De vez en cuando se barren las ventanas viejas para que la tabla no crezca.
    if (Math.random() < 0.02) pool.execute('DELETE FROM rate_limits WHERE expires_at < UTC_TIMESTAMP()').catch(() => {});
    return { totalHits: row ? row.hits : 1, resetTime };
  }

  async decrement(key) {
    const { n } = this.bucket();
    await pool.execute('UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE k = ?', [this.key(key, n)]);
  }

  async resetKey(key) {
    const { n } = this.bucket();
    await pool.execute('DELETE FROM rate_limits WHERE k = ?', [this.key(key, n)]);
  }
}

module.exports = { MySqlStore };
