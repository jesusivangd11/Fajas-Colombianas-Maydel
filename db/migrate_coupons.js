// Habilita los cupones de ENVIO GRATIS, crea el cupon de prueba ENVIOGRATIS y
// agrega las columnas para marcar pedidos retrasados.
// Se puede correr varias veces sin problema.
//
//   node db/migrate_coupons.js          -> base de datos local (.env)
//   node db/migrate_coupons.js --prod   -> base de datos en la nube (.env.production)
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

  await conn.query("ALTER TABLE coupons MODIFY discount_type ENUM('percent','fixed','free_shipping') NOT NULL DEFAULT 'percent'");
  console.log('  ✓ cupones: tipo "free_shipping" habilitado');

  for (const alter of [
    'ALTER TABLE orders ADD COLUMN coupon_code VARCHAR(40) DEFAULT NULL',
    'ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0',
    'ALTER TABLE orders ADD COLUMN is_delayed TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE orders ADD COLUMN delay_note VARCHAR(255) DEFAULT NULL',
  ]) { try { await conn.query(alter); } catch (e) { /* ya existe */ } }
  console.log('  ✓ pedidos: columnas coupon_code / discount_amount / is_delayed / delay_note');

  const [r] = await conn.query(
    `INSERT IGNORE INTO coupons (code, description, discount_type, discount_value, min_subtotal, active)
     VALUES ('ENVIOGRATIS', 'Envío gratis', 'free_shipping', 0, 0, 1)`
  );
  console.log(r.affectedRows ? '  ✓ cupón ENVIOGRATIS creado' : '  · cupón ENVIOGRATIS ya existía');
  await conn.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
