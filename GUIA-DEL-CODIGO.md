# 📘 Guía del código — Fajas Colombianas Maydel

Guía práctica para entender la web y saber **dónde tocar cada cosa**. Escrita para
que puedas hacer cambios tú mismo sin romper nada.

> Regla de oro: para cambios de **texto, colores o imágenes** casi nunca hace falta
> reiniciar el servidor. Guardas el archivo y recargas la página con **Ctrl + F5**.
> Solo hay que reiniciar (`node server.js`) si tocas archivos del servidor (`server.js`,
> `routes/`, `db/`).

---

## 🗺️ 1. Mapa del proyecto

```
Fajas Colombianas Maydel/
│
├── *.html                ← Cada archivo es UNA pantalla de la tienda (ver tabla abajo)
│
├── css/                  ← TODO el diseño (colores, tamaños, fondos)
│   ├── styles.css        · Estilo GLOBAL: navbar, footer, botones, tarjetas, colores base
│   ├── index.css         · Estilo SOLO de la página de inicio (incluye el HERO/fondo)
│   ├── tienda.css        · Estilo de la tienda
│   ├── carrito.css       · Estilo del carrito
│   ├── nosotros.css / faq.css / login.css / ...  · Uno por página
│   └── dashboard.css     · Estilo extra del panel de administración
│
├── js/                   ← La LÓGICA del front-end (lo que hace que la web funcione)
│   ├── data.js           · Puente con el servidor + el CARRITO + helpers
│   ├── main.js           · Funciones compartidas: buscador, favoritos, tarjetas de producto
│   ├── auth.js           · Sesión / login / menú de usuario / barra de bienvenida
│   └── analytics.js      · Google Analytics y Meta Pixel (medición)
│
├── assets/               ← Imágenes fijas (el logo va aquí; aquí pondrías la foto del hero)
├── uploads/              ← Fotos de productos subidas desde el panel (NO tocar a mano)
│
├── dashboard/            ← Panel de administración (privado, solo admin)
│   ├── index.html        · La pantalla del panel
│   └── dashboard.js      · Toda la lógica del panel (productos, pedidos, gastos...)
│
├── routes/               ← EL SERVIDOR: cada archivo maneja una parte de la API
│   ├── products.js       · Crear / editar / borrar / listar productos
│   ├── cart.js           · Guardar el carrito del usuario logueado
│   ├── auth.js           · Login, registro, recuperar contraseña
│   ├── orders.js         · Pedidos
│   ├── checkout.js       · Pago con Stripe
│   └── ... (categories, brands, reviews, wishlist, coupons, upload)
│
├── db/                   ← Base de datos
│   ├── connection.js     · Conexión a MySQL
│   └── setup.js          · Crea las tablas y datos iniciales (npm run setup)
│
├── server.js             ← El corazón del servidor (arranca con: node server.js)
└── .env                  ← Claves y configuración PRIVADA (Stripe, correo, contraseñas)
```

---

## 📄 2. Las páginas (qué archivo es cada pantalla)

| Archivo | Es la pantalla de... |
|---|---|
| `index.html` | **Inicio** (el hero "Fajas que moldean tu figura", destacados, marcas) |
| `tienda.html` | **Productos** / catálogo con filtros y búsqueda |
| `producto.html` | Detalle de UN producto (fotos, tallas, colores, "añadir al carrito") |
| `carrito.html` | **Carrito** de compra y resumen del pedido |
| `nosotros.html` | Sobre nosotros |
| `faq.html` | Preguntas frecuentes |
| `login.html` | Iniciar sesión / registrarse |
| `forgot-password.html` / `reset-password.html` | Recuperar contraseña |
| `mis-pedidos.html` | Historial de pedidos del cliente |
| `mis-favoritos.html` | Favoritos del cliente |
| `404.html` | Página de "no encontrado" |
| `dashboard/index.html` | **Panel de administración** (solo admin) |

---

## 🎨 3. Cómo cambiar lo más común

### 🖼️ La imagen de fondo del hero (lo que preguntaste)
**Archivo:** `css/index.css` → arriba del todo, bloque `.hero`.

Ahora el fondo es un **verde oscuro sólido** (`#071a0c`) con dos destellos de luz.
**No hay foto todavía.** Dejé ahí un comentario con instrucciones y un bloque
listo para usar. Para poner una foto:

1. Guarda tu imagen en `assets/` (ej. `assets/hero.jpg`).
2. En `css/index.css`, **comenta** el bloque `.hero` actual y **descomenta** el
   bloque `OPCIÓN CON IMAGEN` (cambia `assets/hero.jpg` por el nombre de tu foto).
3. Guarda y recarga con **Ctrl + F5**.

El velo oscuro (`linear-gradient(rgba(7,26,12,.72)...)`) va encima de la foto para
que el texto blanco siga legible. El `.72` es el nivel de oscuridad: súbelo para
oscurecer más la foto, bájalo para que se vea más.

### ✍️ Los textos del hero ("Fajas que moldean tu figura")
**Archivo:** `index.html`, alrededor de la línea 66.
```html
<h1 class="hero-anim-2">Fajas que<br><span>moldean</span><br>tu figura</h1>
<p class="hero-anim-3">Descubre nuestra colección...</p>
```
La palabra dentro de `<span>` sale en **dorado cursiva**. Los botones de abajo
("Ver colección" / "Colombianas") están justo debajo, en `hero-actions`.

### 🏷️ El logo
**Archivo:** la imagen es `assets/logo.jpeg`. Aparece en el header y el footer de
cada página (`<img src="assets/logo.jpeg">`). Reemplaza ese archivo por tu logo
(mismo nombre) o cambia la ruta.

### 🎨 Los colores de la marca
**Archivo:** `css/styles.css`, arriba del todo (bloque `:root`). Cambiando estas
variables cambia el color en TODA la web:

| Variable | Color actual | Es... |
|---|---|---|
| `--primary` | `#1a5c2e` 🟢 | Verde principal (navbar, botones) |
| `--primary-dark` | `#0d3d1a` | Verde oscuro |
| `--accent` | `#c9a96e` 🟡 | Dorado (detalles, resaltados) |
| `--danger` `--success` `--warning` | rojo / verde / ámbar | Avisos y estados |

### 🔗 Los enlaces del menú (Inicio, Productos, Sobre nosotros, FAQ)
**Archivo:** dentro de cada `.html`, en `<nav class="nav-bar">` (index.html ~línea 46).

### 💬 El botón flotante de WhatsApp
El número sale de `.env` (`WHATSAPP_PHONE`) y lo expone `server.js` en `/config.js`.
Cámbialo en `.env` y reinicia el servidor.

---

## 🛒 4. El CARRITO — cómo funciona

El carrito **no vive en el servidor**, vive en el navegador del cliente
(`localStorage`) y solo se sincroniza con la base de datos si el usuario inició sesión.

**Toda su lógica está en `js/data.js`** (busca el bloque `── CART ──`):

| Función | Qué hace |
|---|---|
| `DB.getCart()` | Lee el carrito guardado en el navegador |
| `DB.addToCart(id, cantidad, talla, color)` | Agrega un producto |
| `DB.removeFromCart(key)` | Quita un producto |
| `DB.updateCartQty(key, cantidad)` | Cambia la cantidad |
| `DB.getCartCount()` | Cuántos artículos hay (para el numerito) |
| `DB.getCartItems()` | Trae el carrito con los datos completos de cada producto |
| `DB.clearCart()` | Vacía el carrito |
| `DB._saveCart()` | Guarda + avisa a la web + sincroniza con la BD si hay sesión |

**Piezas visuales del carrito:**
- **Ícono del carrito** (header, arriba a la derecha): en cada `.html`, busca
  `<a href="carrito.html" class="header-icon-btn">` (index.html ~línea 38).
- **El numerito rojo** (contador): la clase `cart-badge-count`. Lo actualiza la
  función `updateCartBadge()` en `js/data.js`.
- **La página del carrito completa:** `carrito.html`.
- **Botón "Añadir" de cada tarjeta:** `quickAddToCart()` en `js/main.js`.
- **Guardar carrito en BD del usuario logueado:** `routes/cart.js` (servidor).

---

## ⚙️ 5. Las funciones de la web en general

### Front-end (lo que corre en el navegador — carpeta `js/`)
- **`data.js`** — El "puente" con el servidor. Todas las llamadas a la API viven
  en el objeto `DB` (productos, categorías, marcas, pedidos, gastos) + el carrito +
  helpers como `formatPrice()`, `showToast()` (los avisos verdes/rojos) y las
  animaciones al hacer scroll.
- **`main.js`** — Funciones que se usan en todas las páginas: el **buscador**, los
  **favoritos** (corazón), el **menú hamburguesa** en celular, los **sellos de
  confianza** del footer y `renderProductCard()` que **dibuja cada tarjeta de
  producto** (aquí se cambia el diseño de las tarjetas).
- **`auth.js`** — Todo lo de **sesión**: iniciar/cerrar sesión, registrarse, saber
  si es admin, dibujar el menú del usuario y la **barra dorada de bienvenida**
  ("Sesión iniciada — ¡hola de nuevo, Jesus!").
- **`analytics.js`** — Google Analytics + Meta Pixel (medición de visitas).

### Back-end (lo que corre en el servidor — carpeta `routes/`)
Cada archivo es una parte de la API (`/api/...`). Los que crean/editan/borran
exigen ser **admin**:

| Ruta | Maneja |
|---|---|
| `routes/products.js` | Productos (listar, crear, editar, borrar, stats) |
| `routes/categories.js` · `brands.js` | Categorías y marcas |
| `routes/auth.js` | Login, registro, recuperar contraseña, OTP |
| `routes/cart.js` | Guardar el carrito del usuario logueado |
| `routes/orders.js` | Pedidos y sus estados |
| `routes/checkout.js` | Pago con Stripe (+ webhook) |
| `routes/wishlist.js` | Favoritos |
| `routes/reviews.js` · `testimonials.js` | Reseñas / testimonios |
| `routes/coupons.js` | Cupones de descuento |
| `routes/expenses.js` · `finance.js` | Gastos y finanzas (para el panel) |
| `routes/upload.js` | Subida de fotos y videos de productos |

`server.js` conecta todo: aplica seguridad (Helmet, rate-limit), sirve los archivos
y enruta cada `/api/...` a su archivo de `routes/`.

---

## 🚀 6. Arrancar y ver cambios

```bash
# En la carpeta del proyecto:
node server.js            # arranca el servidor → http://localhost:3000
```

- **Cambios de CSS o texto en HTML** → solo recarga la página (Ctrl + F5).
- **Cambios en `routes/`, `server.js` o `.env`** → detén el servidor (Ctrl + C) y
  vuelve a hacer `node server.js`.
- **Ver todo lo que cambiaste** → `git diff` (o `git status`) en la carpeta.

---

*Guía generada para navegar el código. Si cambias mucho la estructura, vale la pena
actualizar este archivo para que siga siendo fiel.*
