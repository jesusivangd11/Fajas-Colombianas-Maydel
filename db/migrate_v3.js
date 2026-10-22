// Columnas y tablas para: número de guía, motivo de cancelación, cupones de un
// uso por clienta y el limitador de intentos compartido (rate_limits).
// Se puede correr varias veces sin problema.
//
//   node db/migrate_v3.js          -> base de datos local (.env)
//   node db/migrate_v3.js --prod   -> base de datos en la nube (.env.production)
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const PROD = process.argv.includes('--prod');

async function main() {
  const file = path.join(__dirname, '..', PROD ? '.env.production' : '.env');
  if (!fs.existsSync(file)) throw new Error('Falta ' + path.basename(file));
  const env = dotenv.parse(fs.readFileSync(file));
  const conn = await mysql.createConnection({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'fajas_maydel',
    charset: 'utf8mb4',
    ssl: env.DB_SSL === 'true'
      ? { rejectUnauthorized: true, ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) }
      : undefined,
  });
  console.log(`Base de datos: ${env.DB_HOST || 'localhost'}/${env.DB_NAME || 'fajas_maydel'}`);

  const steps = [
    ['pedidos: paquetería',            'ALTER TABLE orders ADD COLUMN tracking_carrier VARCHAR(60) DEFAULT NULL'],
    ['pedidos: número de guía',        'ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(80) DEFAULT NULL'],
    ['pedidos: motivo de cancelación', 'ALTER TABLE orders ADD COLUMN cancel_reason VARCHAR(120) DEFAULT NULL'],
    ['cupones: un uso por clienta',    'ALTER TABLE coupons ADD COLUMN once_per_user TINYINT(1) NOT NULL DEFAULT 0'],
    ['índice pedidos por clienta',     'ALTER TABLE orders ADD INDEX idx_ord_user (user_id)'],
    ['índice pedidos por pago',        'ALTER TABLE orders ADD INDEX idx_ord_pay (payment_method, payment_status, status, created_at)'],
    ['tabla rate_limits', `CREATE TABLE IF NOT EXISTS rate_limits (
        k          VARCHAR(191) NOT NULL PRIMARY KEY,
        hits       INT NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        INDEX idx_rl_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ];
  for (const [label, sql] of steps) {
    try { await conn.query(sql); console.log('  ✓', label); }
    catch (e) {
      if (['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(e.code)) console.log('  ·', label, '(ya existía)');
      else throw e;
    }
  }
  await conn.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
