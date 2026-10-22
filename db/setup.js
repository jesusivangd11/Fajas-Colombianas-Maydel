require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function setup() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    charset:  'utf8mb4',
  });

  const DB = process.env.DB_NAME || 'fajas_maydel';
  console.log(`Creando base de datos "${DB}"...`);

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${DB}\``);

  // ── TABLAS ──────────────────────────────────────────────────────────────────
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      name          VARCHAR(100) NOT NULL,
      email         VARCHAR(150) NOT NULL UNIQUE,
      password_hash VARCHAR(255) DEFAULT NULL,
      role          ENUM('user','admin') NOT NULL DEFAULT 'user',
      birthdate     DATE DEFAULT NULL,
      phone         VARCHAR(30) DEFAULT NULL,
      phone_verified TINYINT(1) NOT NULL DEFAULT 0,
      provider      VARCHAR(20) NOT NULL DEFAULT 'local',
      provider_id   VARCHAR(100) DEFAULT NULL,
      avatar        VARCHAR(500) DEFAULT NULL,
      address       JSON DEFAULT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migración segura para bases de datos ya existentes
  for (const alter of [
    'ALTER TABLE users ADD COLUMN birthdate DATE DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN phone VARCHAR(30) DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN phone_verified TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN address JSON DEFAULT NULL',
    // Login social: contraseña opcional + datos del proveedor
    'ALTER TABLE users MODIFY password_hash VARCHAR(255) DEFAULT NULL',
    "ALTER TABLE users ADD COLUMN provider VARCHAR(20) NOT NULL DEFAULT 'local'",
    'ALTER TABLE users ADD COLUMN provider_id VARCHAR(100) DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN avatar VARCHAR(500) DEFAULT NULL',
  ]) {
    try { await conn.query(alter); } catch(e) { /* columna ya existe */ }
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      \`key\`    VARCHAR(80)  NOT NULL UNIQUE,
      label      VARCHAR(100) NOT NULL,
      icon       VARCHAR(120) DEFAULT 'fa-solid fa-tag',
      active     TINYINT(1)  NOT NULL DEFAULT 1,
      sort_order INT          DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── MARCAS ──────────────────────────────────────────────────────────────────
  await conn.query(`
    CREATE TABLE IF NOT EXISTS brands (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      \`key\`    VARCHAR(80)  NOT NULL UNIQUE,
      label      VARCHAR(100) NOT NULL,
      logo       VARCHAR(500) DEFAULT NULL,
      icon       VARCHAR(120) DEFAULT 'fa-solid fa-certificate',
      active     TINYINT(1)  NOT NULL DEFAULT 1,
      sort_order INT          DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS products (
      id             INT PRIMARY KEY AUTO_INCREMENT,
      name           VARCHAR(200) NOT NULL,
      description    TEXT,
      price          DECIMAL(10,2) NOT NULL,
      original_price DECIMAL(10,2),
      stock          INT NOT NULL DEFAULT 0,
      category       VARCHAR(80),
      brand          VARCHAR(80) DEFAULT NULL,
      sizes          JSON,
      colors         JSON,
      images         JSON,
      video          VARCHAR(500) DEFAULT NULL,
      material       VARCHAR(200),
      reference      VARCHAR(100),
      tags           JSON,
      active         TINYINT(1) NOT NULL DEFAULT 1,
      featured       TINYINT(1) NOT NULL DEFAULT 0,
      is_new         TINYINT(1) NOT NULL DEFAULT 0,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id              VARCHAR(30) NOT NULL PRIMARY KEY,
      user_id         INT,
      user_name       VARCHAR(100) NOT NULL,
      user_email      VARCHAR(150) NOT NULL,
      items           JSON NOT NULL,
      subtotal        DECIMAL(10,2) NOT NULL DEFAULT 0,
      shipping_cost   DECIMAL(10,2) NOT NULL DEFAULT 0,
      shipping_state  VARCHAR(60) DEFAULT NULL,
      total           DECIMAL(10,2) NOT NULL,
      shipping_info   JSON,
      notes           TEXT,
      payment_method  ENUM('stripe','whatsapp','manual') NOT NULL DEFAULT 'whatsapp',
      payment_status  ENUM('unpaid','paid','refunded','failed') NOT NULL DEFAULT 'unpaid',
      stripe_intent_id VARCHAR(100) DEFAULT NULL,
      status          ENUM('pending','confirmed','processing','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending',
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migracion segura: columna de video en productos
  try { await conn.query('ALTER TABLE products ADD COLUMN video VARCHAR(500) DEFAULT NULL AFTER images'); } catch(e) { /* ya existe */ }
  // Posicion del video dentro de la galeria (0 = primero). NULL = al final,
  // que es como se comportaba antes de que se pudiera reordenar.
  try { await conn.query('ALTER TABLE products ADD COLUMN video_position INT DEFAULT NULL AFTER video'); } catch(e) { /* ya existe */ }
  // Varios videos por producto. `videos` guarda un arreglo JSON de objetos
  // { url, position } (position = nº de imágenes antes del video, o null = al
  // final). Las columnas antiguas `video`/`video_position` se conservan con el
  // PRIMER video por compatibilidad. Backfill: los productos con un solo video
  // heredan ese video como arreglo de un elemento.
  try { await conn.query('ALTER TABLE products ADD COLUMN videos JSON DEFAULT NULL AFTER video_position'); } catch(e) { /* ya existe */ }
  try {
    await conn.query(
      "UPDATE products SET videos = JSON_ARRAY(JSON_OBJECT('url', video, 'position', video_position)) " +
      "WHERE (videos IS NULL OR JSON_LENGTH(videos) = 0) AND video IS NOT NULL AND video <> ''"
    );
  } catch(e) { /* nada que migrar */ }
  // Migracion segura: columna de marca en productos
  try { await conn.query('ALTER TABLE products ADD COLUMN brand VARCHAR(80) DEFAULT NULL AFTER category'); } catch(e) { /* ya existe */ }
  // Precio de mayoreo: se aplica cuando el pedido lleva >= 6 piezas de ese
  // producto (sumando tallas/colores). NULL = el producto no maneja mayoreo.
  try { await conn.query('ALTER TABLE products ADD COLUMN wholesale_price DECIMAL(10,2) DEFAULT NULL AFTER original_price'); } catch(e) { /* ya existe */ }
  // Punto de enfoque por imagen: mapa { urlImagen: "x% y%" } que el admin ajusta
  // para elegir qué parte de la foto queda a la vista cuando se recorta (cover).
  try { await conn.query('ALTER TABLE products ADD COLUMN image_focus JSON DEFAULT NULL AFTER images'); } catch(e) { /* ya existe */ }
  // Variantes estructuradas tipo Mercado Libre: arreglo de
  //   { color, option, sizes: [...], price }
  // Cada variante = un color (+ opcion libre, p.ej. "Con tirantes") con QUE tallas
  // hay en ese color y, opcional, un precio propio (si esa variante cuesta distinto).
  // Las columnas `sizes` y `colors` se siguen llenando (union derivada) para no
  // romper filtros de tienda ni la guia de tallas. NULL = producto sin variantes.
  try { await conn.query('ALTER TABLE products ADD COLUMN variants JSON DEFAULT NULL AFTER colors'); } catch(e) { /* ya existe */ }
  // Multi-categoria: un producto puede pertenecer a varias categorias. La columna
  // `category` se conserva como categoria PRINCIPAL (= primera) por compatibilidad
  // e indices; `categories` guarda el arreglo completo de claves y es la fuente de
  // verdad para filtros. Backfill: los productos existentes heredan [category].
  try { await conn.query('ALTER TABLE products ADD COLUMN categories JSON DEFAULT NULL AFTER category'); } catch(e) { /* ya existe */ }
  try {
    await conn.query(
      "UPDATE products SET categories = JSON_ARRAY(category) " +
      "WHERE (categories IS NULL OR JSON_LENGTH(categories) = 0) AND category IS NOT NULL AND category <> ''"
    );
  } catch(e) { /* nada que migrar */ }

  // Migracion segura para bases existentes
  for (const alter of [
    'ALTER TABLE orders ADD COLUMN subtotal DECIMAL(10,2) NOT NULL DEFAULT 0',
    'ALTER TABLE orders ADD COLUMN shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0',
    'ALTER TABLE orders ADD COLUMN shipping_state VARCHAR(60) DEFAULT NULL',
    "ALTER TABLE orders ADD COLUMN payment_method ENUM('stripe','whatsapp','manual') NOT NULL DEFAULT 'whatsapp'",
    "ALTER TABLE orders ADD COLUMN payment_status ENUM('unpaid','paid','refunded','failed') NOT NULL DEFAULT 'unpaid'",
    'ALTER TABLE orders ADD COLUMN stripe_intent_id VARCHAR(100) DEFAULT NULL',
  ]) {
    try { await conn.query(alter); } catch(e) { /* columna ya existe */ }
  }

  // Tabla de recuperacion de password
  await conn.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      user_id    INT NOT NULL,
      token      VARCHAR(120) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used       TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_token (token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Tabla de codigos OTP (verificacion por SMS / WhatsApp)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      user_id    INT DEFAULT NULL,
      phone      VARCHAR(30) NOT NULL,
      code       VARCHAR(6)  NOT NULL,
      purpose    ENUM('reset','verify') NOT NULL DEFAULT 'reset',
      channel    ENUM('sms','whatsapp') NOT NULL DEFAULT 'sms',
      expires_at DATETIME NOT NULL,
      used       TINYINT(1) NOT NULL DEFAULT 0,
      attempts   INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_phone (phone),
      INDEX idx_lookup (phone, purpose, used)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Tabla de reseñas
  await conn.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      user_id     INT,
      product_id  INT,
      author_name VARCHAR(100) NOT NULL,
      rating      TINYINT NOT NULL DEFAULT 5,
      text        TEXT NOT NULL,
      approved    TINYINT(1) NOT NULL DEFAULT 0,
      featured    TINYINT(1) NOT NULL DEFAULT 0,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
      INDEX idx_approved (approved),
      INDEX idx_product  (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Testimonios: capturas de pantalla reales que el admin sube manualmente
  await conn.query(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      image_url  VARCHAR(255) NOT NULL,
      caption    VARCHAR(255) DEFAULT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      active     TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_active_sort (active, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Carrito persistente
  await conn.query(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      user_id    INT NOT NULL,
      product_id INT NOT NULL,
      qty        INT NOT NULL DEFAULT 1,
      size       VARCHAR(20),
      color      VARCHAR(40),
      \`option\`   VARCHAR(60) NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_user_var (user_id, product_id, size, color, \`option\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // Migración para carritos ya existentes: agrega la opción de variante y amplía
  // la clave única para incluirla (dos variantes que solo difieren en la opción
  // —p.ej. con/sin tirantes— son ítems distintos del carrito).
  try { await conn.query("ALTER TABLE cart_items ADD COLUMN `option` VARCHAR(60) NOT NULL DEFAULT '' AFTER color"); } catch(e) { /* ya existe */ }
  // Reconstruir la clave única para incluir `option`. No se puede soltar la vieja
  // de golpe porque una FK se apoya en ella: primero se crea la nueva (con las 5
  // columnas, también empieza por user_id), luego se suelta la vieja y se renombra.
  const [ci] = await conn.query("SHOW INDEX FROM cart_items WHERE Key_name='uniq_user_var'");
  if (ci.length && ci.length < 5) {
    try { await conn.query('ALTER TABLE cart_items ADD UNIQUE KEY uniq_user_var2 (user_id, product_id, size, color, `option`)'); } catch(e) {}
    try { await conn.query('ALTER TABLE cart_items DROP INDEX uniq_user_var'); } catch(e) {}
    try { await conn.query('ALTER TABLE cart_items RENAME INDEX uniq_user_var2 TO uniq_user_var'); } catch(e) {}
  }

  // Wishlist / favoritos
  await conn.query(`
    CREATE TABLE IF NOT EXISTS wishlist (
      id         INT PRIMARY KEY AUTO_INCREMENT,
      user_id    INT NOT NULL,
      product_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_product (user_id, product_id),
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Cupones
  await conn.query(`
    CREATE TABLE IF NOT EXISTS coupons (
      id              INT PRIMARY KEY AUTO_INCREMENT,
      code            VARCHAR(40) NOT NULL UNIQUE,
      description     VARCHAR(160) DEFAULT '',
      discount_type   ENUM('percent','fixed','free_shipping') NOT NULL DEFAULT 'percent',
      discount_value  DECIMAL(10,2) NOT NULL,
      min_subtotal    DECIMAL(10,2) NOT NULL DEFAULT 0,
      max_uses        INT DEFAULT NULL,
      uses            INT NOT NULL DEFAULT 0,
      expires_at      DATETIME DEFAULT NULL,
      active          TINYINT(1) NOT NULL DEFAULT 1,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migracion para orders (cupon aplicado) y cupones de envio gratis
  for (const alter of [
    "ALTER TABLE coupons MODIFY discount_type ENUM('percent','fixed','free_shipping') NOT NULL DEFAULT 'percent'",
    'ALTER TABLE orders ADD COLUMN coupon_code VARCHAR(40) DEFAULT NULL',
    'ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0',
  ]) { try { await conn.query(alter); } catch(e) {} }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id         VARCHAR(30) NOT NULL PRIMARY KEY,
      concept    VARCHAR(200) NOT NULL,
      amount     DECIMAL(10,2) NOT NULL,
      category   VARCHAR(50),
      date       DATE NOT NULL,
      notes      TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ── ÍNDICES DE RENDIMIENTO ──────────────────────────────────────────────────
  // Evitan full table scans al filtrar catálogo y pedidos cuando crecen los datos.
  console.log('Aplicando índices de rendimiento...');
  for (const idx of [
    'ALTER TABLE products ADD INDEX idx_prod_active     (active)',
    'ALTER TABLE products ADD INDEX idx_prod_category   (category)',
    'ALTER TABLE products ADD INDEX idx_prod_brand      (brand)',
    'ALTER TABLE products ADD INDEX idx_prod_featured   (featured)',
    'ALTER TABLE products ADD INDEX idx_prod_is_new     (is_new)',
    'ALTER TABLE products ADD INDEX idx_prod_active_cat (active, category)',
    'ALTER TABLE products ADD INDEX idx_prod_created    (created_at)',
    'ALTER TABLE orders   ADD INDEX idx_ord_status      (status)',
    'ALTER TABLE orders   ADD INDEX idx_ord_created     (created_at)',
  ]) {
    try { await conn.query(idx); } catch (e) { /* el índice ya existe */ }
  }

  // ── CATEGORÍAS POR DEFECTO ──────────────────────────────────────────────────
  console.log('Insertando categorías...');
  const defaultCats = [
    ['fajas-reductoras',  'Fajas Reductoras',  'fa-solid fa-vest',         1],
    ['fajas-postparto',   'Fajas Postparto',   'fa-solid fa-baby',         2],
    ['fajas-colombianas', 'Fajas Colombianas', 'fa-solid fa-flag',         3],
    ['cinturillas',       'Cinturillas',       'fa-solid fa-ring',         4],
    ['bodis',             'Bodis',             'fa-solid fa-person-dress', 5],
    ['leggins',           'Leggings',          'fa-solid fa-socks',        6],
    ['accesorios',        'Accesorios',        'fa-solid fa-gem',          7],
  ];
  for (const [key, label, icon, order] of defaultCats) {
    await conn.query(
      'INSERT IGNORE INTO categories (`key`, label, icon, sort_order) VALUES (?, ?, ?, ?)',
      [key, label, icon, order]
    );
  }

  // ── MARCAS POR DEFECTO ──────────────────────────────────────────────────────
  console.log('Insertando marcas...');
  const defaultBrands = [
    ['ann-chery',     'Ann Chery',     1],
    ['perfectissima', 'Perfectissima', 2],
    ['myd',           'MYD',           3],
  ];
  for (const [key, label, order] of defaultBrands) {
    await conn.query(
      'INSERT IGNORE INTO brands (`key`, label, sort_order) VALUES (?, ?, ?)',
      [key, label, order]
    );
  }

  // ── USUARIO ADMIN ───────────────────────────────────────────────────────────
  // La contraseña NUNCA se hardcodea: se toma de ADMIN_PASSWORD en el .env.
  const adminEmail    = process.env.ADMIN_LOGIN_EMAIL || 'admin@fajasmaydel.com';
  const adminPassword = process.env.ADMIN_PASSWORD;
  const [adminRows] = await conn.query('SELECT id FROM users WHERE email = ?', [adminEmail]);

  if (adminRows.length === 0) {
    if (!adminPassword) {
      console.warn(`⚠ No existe admin y ADMIN_PASSWORD no está definida en .env. Omitiendo creación del administrador.`);
      console.warn(`  Define ADMIN_PASSWORD en tu .env y vuelve a ejecutar "npm run setup" para crear ${adminEmail}.`);
    } else {
      const adminHash = await bcrypt.hash(adminPassword, 10);
      await conn.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ['Administrador Maydel', adminEmail, adminHash, 'admin']
      );
      console.log(`Admin creado: ${adminEmail} (contraseña tomada de ADMIN_PASSWORD).`);
    }
  } else if (adminPassword) {
    // Solo restablece la contraseña si se proporcionó explícitamente en el .env.
    const adminHash = await bcrypt.hash(adminPassword, 10);
    await conn.query('UPDATE users SET password_hash = ? WHERE email = ?', [adminHash, adminEmail]);
    console.log('Contraseña del admin actualizada desde ADMIN_PASSWORD.');
  } else {
    console.log('Admin ya existe; no se modifica su contraseña (ADMIN_PASSWORD no definida).');
  }

  // ── PRODUCTOS DE EJEMPLO ────────────────────────────────────────────────────
  const [[{ c }]] = await conn.query('SELECT COUNT(*) as c FROM products');
  if (c === 0) {
    console.log('Insertando productos de ejemplo...');
    const samples = [
      ['Faja Reductora Clásica',    'Faja reductora de alta compresión ideal para uso diario. Moldea cintura, abdomen y cadera con total comodidad.', 650.00,  null,    20, 'fajas-reductoras',  '["S","M","L","XL","2XL"]',      '["Negro","Beige","Nude"]',  '[]', 'Nylon / Elastano',    'FR-001',  '["reductora","cintura","abdomen"]',   1, 1, 0],
      ['Faja Postparto Premium',    'Diseñada para recuperación postparto. Brinda soporte lumbar y compresión abdominal suave.',                      890.00,  null,    15, 'fajas-postparto',   '["S","M","L","XL"]',            '["Negro","Beige"]',         '[]', 'Algodón / Elastano',  'FP-001',  '["postparto","maternidad"]',         1, 1, 0],
      ['Faja Colombiana Full Body', 'Control total desde el busto hasta los muslos. Ideal para ocasiones especiales o uso diario intensivo.',         1150.00, 1350.00, 12, 'fajas-colombianas', '["XS","S","M","L","XL","2XL"]', '["Negro","Nude","Cocoa"]',  '[]', 'Powernet colombiano', 'FCB-001', '["colombiana","fullbody","control"]', 1, 1, 1],
      ['Bodi Reductor Sin Espalda', 'Bodi de espalda descubierta, perfecto bajo cualquier ropa. Compresión moderada en abdomen y cadera.',            780.00,  null,    18, 'bodis',             '["XS","S","M","L"]',            '["Negro","Beige","Rosa"]',  '[]', 'Nylon / Spandex',     'BD-001',  '["bodi","reductora"]',               1, 0, 1],
      ['Cinturilla Reductora Wide', 'Cinturilla de 25 cm de alto. Define la cintura y corrige postura con uso constante.',                           450.00,  null,    25, 'cinturillas',       '["S","M","L","XL","2XL","3XL"]','["Negro","Beige"]',         '[]', 'Látex / Algodón',     'CIN-001', '["cinturilla","waist"]',             1, 0, 0],
    ];
    for (const row of samples) {
      await conn.query(
        `INSERT INTO products (name,description,price,original_price,stock,category,sizes,colors,images,material,reference,tags,active,featured,is_new)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        row
      );
    }
  }

  // Seed de reseñas de ejemplo (aprobadas) si no hay ninguna
  const [[{ rc }]] = await conn.query('SELECT COUNT(*) as rc FROM reviews');
  if (rc === 0) {
    console.log('Insertando resenas de ejemplo...');
    const reviewSamples = [
      ['Laura M.',     5, 'Excelente calidad, parece colombiana original. Me ayudaron a elegir la talla por WhatsApp y quede encantada. 100% recomendada.'],
      ['Sofia G.',     5, 'La uso despues de mi cesarea y me siento muy comoda. Me ayudo mucho a recuperar la figura. Buen servicio y rapido envio.'],
      ['Maria Jose H.',5, 'Tienen muy buena variedad de tallas y modelos. La asesoria de tallas es genial. Llego en 3 dias a Monterrey.'],
      ['Carmen R.',    5, 'Compre una faja postparto y otra reductora. Las dos de excelente calidad. Volvere a comprar sin dudar.'],
      ['Adriana P.',   4, 'Buena compresion y se siente comoda todo el dia. El envio tardo un poquito pero llego perfecto.'],
    ];
    for (const r of reviewSamples) {
      await conn.query(
        'INSERT INTO reviews (author_name, rating, text, approved, featured) VALUES (?,?,?,1,1)',
        r
      );
    }
  }

  // Cupon de bienvenida
  const [[{ cc }]] = await conn.query('SELECT COUNT(*) as cc FROM coupons');
  if (cc === 0) {
    await conn.query(
      'INSERT INTO coupons (code, description, discount_type, discount_value, min_subtotal, active) VALUES (?,?,?,?,?,1)',
      ['BIENVENIDA10', '10% de descuento en tu primera compra', 'percent', 10, 500]
    );
    console.log('Cupon BIENVENIDA10 creado.');
  }

  await conn.end();
  console.log('\nBase de datos configurada correctamente.');
  console.log('   Ejecuta: npm start  (o node server.js)');
}

setup().catch(err => {
  console.error('Error en el setup:', err.message);
  process.exit(1);
});
