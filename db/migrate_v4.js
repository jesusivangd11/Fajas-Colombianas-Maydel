// Agrega users.email_verified (¿el correo de la cuenta está comprobado?).
// Las cuentas que ya existen se marcan como comprobadas: son conocidas y así
// nadie pierde su contraseña. Las nuevas nacen en 0 hasta que entren con Google.
// Se puede correr varias veces sin problema.
//
//   node db/migrate_v4.js          -> base de datos local (.env)
//   node db/migrate_v4.js --prod   -> base de datos en la nube (.env.production)
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

  try {
    await conn.query('ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0');
    const [r] = await conn.query('UPDATE users SET email_verified = 1');
    console.log(`  ✓ usuarios: columna email_verified (${r.affectedRows} cuentas existentes marcadas como comprobadas)`);
  } catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    console.log('  · usuarios: email_verified ya existía');
  }
  // Los enlaces de recuperación ahora se guardan como huella SHA-256: los que
  // estaban pendientes (texto plano) ya no sirven, se dan por usados.
  await conn.query('UPDATE password_resets SET used = 1 WHERE used = 0');
  console.log('  ✓ enlaces de recuperación pendientes invalidados');
  await conn.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
