// Aplica SOLO los índices de rendimiento a una base de datos ya existente,
// sin insertar ni modificar datos. Es idempotente: se puede correr varias veces.
//   Uso:  node db/migrate_indexes.js
require('dotenv').config();
const pool = require('./connection');

const INDEXES = [
  'ALTER TABLE products ADD INDEX idx_prod_active     (active)',
  'ALTER TABLE products ADD INDEX idx_prod_category   (category)',
  'ALTER TABLE products ADD INDEX idx_prod_brand      (brand)',
  'ALTER TABLE products ADD INDEX idx_prod_featured   (featured)',
  'ALTER TABLE products ADD INDEX idx_prod_is_new     (is_new)',
  'ALTER TABLE products ADD INDEX idx_prod_active_cat (active, category)',
  'ALTER TABLE products ADD INDEX idx_prod_created    (created_at)',
  'ALTER TABLE orders   ADD INDEX idx_ord_status      (status)',
  'ALTER TABLE orders   ADD INDEX idx_ord_created     (created_at)',
];

(async () => {
  for (const sql of INDEXES) {
    const name = (sql.match(/idx_\w+/) || ['?'])[0];
    try {
      await pool.query(sql);
      console.log('  creado    ' + name);
    } catch (e) {
      if (e.code === 'ER_DUP_KEYNAME') console.log('  ya existe ' + name);
      else console.log('  SKIP (' + e.code + ') ' + name);
    }
  }
  await pool.end();
  console.log('Indices aplicados.');
})().catch(e => { console.error(e); process.exit(1); });
