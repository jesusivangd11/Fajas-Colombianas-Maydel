// Copia la base de datos local (credenciales en .env) a la base de datos en la
// nube (credenciales en .env.production): estructura de tablas + datos.
//
//   node db/migrate_to_cloud.js            -> solo muestra que se copiaria
//   node db/migrate_to_cloud.js --apply    -> copia (reemplaza las tablas destino)
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
// Tokens temporales: se crea la tabla pero no se copian sus filas.
const SKIP_DATA = new Set(['otp_codes', 'password_resets']);

function cfg(env) {
  return {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'fajas_maydel',
    charset: 'utf8mb4',
    timezone: '+00:00',
    ssl: env.DB_SSL === 'true'
      ? { rejectUnauthorized: true, ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) }
      : undefined,
  };
}

async function main() {
  const root = path.join(__dirname, '..');
  const prodFile = path.join(root, '.env.production');
  if (!fs.existsSync(prodFile)) throw new Error('Falta .env.production con los datos de la BD en la nube');
  const src = await mysql.createConnection(cfg(dotenv.parse(fs.readFileSync(path.join(root, '.env')))));
  const dstCfg = cfg(dotenv.parse(fs.readFileSync(prodFile)));
  const dst = await mysql.createConnection(dstCfg);
  console.log(`Origen: local  ->  Destino: ${dstCfg.host}/${dstCfg.database}`);

  const [tables] = await src.query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');
  const names = tables.map(t => Object.values(t)[0]);

  if (APPLY) await dst.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of names) {
    const [[{ 'Create Table': ddl }]] = await src.query(`SHOW CREATE TABLE \`${t}\``);
    const [rows] = SKIP_DATA.has(t) ? [[]] : await src.query(`SELECT * FROM \`${t}\``);
    console.log(`${t.padEnd(20)} ${String(rows.length).padStart(5)} filas`);
    if (!APPLY) continue;

    await dst.query(`DROP TABLE IF EXISTS \`${t}\``);
    await dst.query(ddl);
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    const colList = cols.map(c => `\`${c}\``).join(',');
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map(r => cols.map(c => {
        const v = r[c];
        // Las columnas JSON llegan como objeto: se vuelven a guardar como texto JSON.
        return v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) ? JSON.stringify(v) : v;
      }));
      await dst.query(`INSERT INTO \`${t}\` (${colList}) VALUES ?`, [chunk]);
    }
  }
  if (APPLY) await dst.query('SET FOREIGN_KEY_CHECKS = 1');

  console.log(APPLY ? 'Listo: base de datos copiada.' : 'Simulacion. Ejecuta con --apply para copiar.');
  await src.end(); await dst.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
