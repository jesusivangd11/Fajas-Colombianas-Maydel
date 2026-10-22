// Emergencia: quita la verificación en dos pasos de una cuenta (por ejemplo, si
// se perdió el celular Y los códigos de respaldo). Después de entrar, vuelve a
// activarla desde "Mi cuenta".
//
//   node db/reset_2fa.js correo@ejemplo.com          -> base de datos local (.env)
//   node db/reset_2fa.js correo@ejemplo.com --prod   -> base de datos en la nube
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const PROD = process.argv.includes('--prod');
const email = (process.argv.slice(2).find(a => a.includes('@')) || '').trim().toLowerCase();

async function main() {
  if (!email) throw new Error('Uso: node db/reset_2fa.js correo@ejemplo.com [--prod]');
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
  const [r] = await conn.query(
    'UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_pending = NULL, totp_backup = NULL, totp_last_step = NULL WHERE email = ?',
    [email]);
  console.log(r.affectedRows ? `✓ Verificación en dos pasos quitada a ${email}` : `No existe la cuenta ${email}`);
  await conn.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
