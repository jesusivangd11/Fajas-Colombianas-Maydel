// Columnas para la verificación en dos pasos (services/totp.js).
// Se puede correr varias veces sin problema.
//
//   node db/migrate_v5.js          -> base de datos local (.env)
//   node db/migrate_v5.js --prod   -> base de datos en la nube (.env.production)
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
    ['secreto (cifrado)',          'ALTER TABLE users ADD COLUMN totp_secret VARCHAR(255) DEFAULT NULL'],
    ['secreto pendiente',          'ALTER TABLE users ADD COLUMN totp_pending VARCHAR(255) DEFAULT NULL'],
    ['activa sí/no',               'ALTER TABLE users ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0'],
    ['último código usado',        'ALTER TABLE users ADD COLUMN totp_last_step BIGINT DEFAULT NULL'],
    ['códigos de respaldo',        'ALTER TABLE users ADD COLUMN totp_backup JSON DEFAULT NULL'],
  ];
  for (const [label, sql] of steps) {
    try { await conn.query(sql); console.log('  ✓ 2 pasos:', label); }
    catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') console.log('  · 2 pasos:', label, '(ya existía)');
      else throw e;
    }
  }
  await conn.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
