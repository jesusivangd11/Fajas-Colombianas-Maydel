require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'fajas_maydel',
    charset:  'utf8mb4',
  });

  // Cuenta de comprador SOLO para pruebas locales. La contraseña sale del .env
  // (nunca va escrita aqui: el repo es publico). No correr contra produccion.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed_buyer.js es solo para desarrollo local');
  }
  const email = 'cliente@example.com'; // example.com está reservado: nadie puede recibir ese correo
  const plain = process.env.SEED_BUYER_PASSWORD;
  if (!plain) throw new Error('Define SEED_BUYER_PASSWORD en tu .env');
  const hash  = await bcrypt.hash(plain, 10);
  const address = {
    calle:   'Av. Siempre Viva',
    numero:  '742',
    colonia: 'Centro',
    cp:      '01000',
    ciudad:  'Ciudad de Mexico',
    estado:  'CDMX',
  };

  const [rows] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
  if (rows.length === 0) {
    await conn.query(
      'INSERT INTO users (name, email, password_hash, role, birthdate, address) VALUES (?,?,?,?,?,?)',
      ['Maria Gomez', email, hash, 'user', '1995-06-15', JSON.stringify(address)]
    );
    console.log('Cliente creado:', email);
  } else {
    await conn.query(
      'UPDATE users SET password_hash = ?, role = "user", address = ? WHERE email = ?',
      [hash, JSON.stringify(address), email]
    );
    console.log('Cliente actualizado:', email);
  }

  await conn.end();
})().catch(e => { console.error(e); process.exit(1); });
