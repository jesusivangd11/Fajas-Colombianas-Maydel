# Fajas Colombianas Maydel — Tienda en línea

Tienda en línea de fajas colombianas con catálogo, carrito, cuentas de cliente y un
panel de administración para gestionar productos, pedidos y finanzas. Es un proyecto
real en producción.

**🌐 Sitio en vivo:** [www.fajascolombianasmaydel.com](https://www.fajascolombianasmaydel.com)

---

## Funcionalidades

**Tienda (clientes)**
- Catálogo con búsqueda, filtros por categoría y marca, y orden por precio.
- Ficha de producto con galería de fotos y videos, y variantes por color y talla con stock por talla.
- Carrito persistente: se guarda en el navegador y, con sesión iniciada, en el servidor.
- Favoritos, reseñas de producto y testimonios.
- Cupones de descuento y cálculo de envío local o nacional.
- Pedido por WhatsApp o pago con tarjeta (Stripe).
- Cuenta de cliente: registro, inicio de sesión con correo o Google, recuperación de contraseña por correo o código OTP, historial de pedidos y direcciones.

**Panel de administración (`/dashboard`)**
- Alta y edición de productos, con carga y reordenamiento de fotos y videos.
- Gestión de categorías, marcas, cupones y testimonios.
- Pedidos y sus estados (pendiente → confirmado → enviado → entregado).
- Registro de gastos y reportes de finanzas mensuales.
- Avisos de pedidos nuevos por Telegram.

**Integraciones**
- Catálogo publicado en **TikTok Shop** por carga masiva, con imágenes servidas desde el propio sitio.
- Google Analytics y Meta Pixel.

## Tecnologías

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript (vanilla), con una hoja de estilos por página |
| Backend | Node.js + Express (API REST) |
| Base de datos | MySQL (local) / TiDB Cloud Serverless, compatible con MySQL (producción) |
| Autenticación | JWT en cookie httpOnly, bcrypt, Google Identity Services |
| Pagos | Stripe (Payment Intents) + webhooks |
| Correo | Nodemailer (SMTP) |
| Seguridad | Helmet, express-rate-limit, consultas parametrizadas |
| Pruebas | Playwright (pruebas end-to-end) |
| Despliegue | Vercel (función serverless + archivos estáticos), dominio en Hostinger |

## Arquitectura

```
Navegador ──► Vercel
               ├── Archivos estáticos (HTML, CSS, JS, imágenes)   ← @vercel/static
               └── /api/*  →  server.js (Express, serverless)      ← @vercel/node
                                  └── TiDB Cloud (MySQL, TLS)
```

`vercel.json` sirve los archivos estáticos directamente desde la CDN de Vercel y manda
a Express solo la API y las rutas dinámicas. En local, el mismo `server.js` levanta
todo con `app.listen`.

## Estructura del proyecto

```
├── *.html             Páginas de la tienda (inicio, tienda, producto, carrito, cuenta…)
├── css/               Estilos globales (styles.css) + uno por página
├── js/                Lógica del navegador: API, carrito, sesión, analytics
├── assets/            Logo e imágenes de la marca
├── dashboard/         Panel de administración
├── routes/            Endpoints de la API (/api/products, /api/orders, …)
├── middleware/        Autenticación y control de roles
├── services/          Correo, OTP, envíos, Telegram
├── db/                Conexión, creación de tablas y scripts de migración
├── uploads/           Fotos y videos del catálogo
├── tests/             Pruebas end-to-end con Playwright
├── server.js          Servidor Express
└── vercel.json        Configuración de despliegue
```

## Ejecutar en local

Requisitos: Node.js 18 o superior y MySQL 8.

```bash
git clone https://github.com/jesusivangd11/Fajas-Colombianas-Maydel.git
cd Fajas-Colombianas-Maydel
npm install

cp .env.example .env     # completar con tus datos (BD, JWT_SECRET, SMTP…)
npm run setup            # crea la base de datos, las tablas y el usuario admin
npm run dev              # http://localhost:3000
```

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga automática (nodemon) |
| `npm start` | Servidor en modo normal |
| `npm run setup` | Crea las tablas y el administrador inicial |
| `npm run test:*` | Pruebas end-to-end (imágenes, galería, audio de video, marca) |
| `node db/migrate_to_cloud.js --apply` | Copia la base local a la base en la nube (`.env.production`) |

## Despliegue

Cada push a `main` se publica automáticamente en Vercel. Las credenciales (base de
datos, JWT, SMTP, etc.) se configuran como **variables de entorno en Vercel** y nunca
se guardan en el repositorio; `.env.example` lista las que hacen falta.

## Seguridad

- Ningún secreto está en el código: todo se lee de variables de entorno.
- Contraseñas con bcrypt; sesión con JWT en cookie `httpOnly`.
- Límite de intentos en login, recuperación de contraseña y OTP.
- Las rutas de administración exigen rol `admin` en el servidor.
- El servidor bloquea que se sirvan como estáticos el código fuente y la configuración.

---

Desarrollado por [@jesusivangd11](https://github.com/jesusivangd11).
