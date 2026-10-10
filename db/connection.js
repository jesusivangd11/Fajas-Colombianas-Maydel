const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               Number(process.env.DB_PORT) || 3306,
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'fajas_maydel',
  waitForConnections: true,
  connectionLimit:    10,
  charset:            'utf8mb4',
  timezone:           '+00:00',
  // Los MySQL en la nube (Aiven, TiDB, etc.) exigen conexion cifrada: DB_SSL=true.
  // Si el proveedor usa su propio certificado (Aiven), pegar su CA en DB_SSL_CA.
  ssl:                process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: true, ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}) }
    : undefined,
});

module.exports = pool;
