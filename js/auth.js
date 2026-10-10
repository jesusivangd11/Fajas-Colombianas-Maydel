/* =============================================================================
   auth.js  ·  SESION / LOGIN / MENU DE USUARIO
   -----------------------------------------------------------------------------
   Maneja quien esta conectado y como se ve la cabecera segun eso. Aqui vive:
     • AUTH.init()          → pregunta al servidor si hay sesion (llamar en cada
                              pagina). Tambien fusiona el carrito guardado.
     • AUTH.login/register/logout → entrar, registrarse y salir.
     • AUTH.isAdmin()       → true si el usuario es administrador (para el panel).
     • updateHeaderUI()     → dibuja el boton "Iniciar sesion" o el menu del
                              usuario (avatar + Dashboard/Pedidos/Favoritos).
     • _renderWelcomeBar()  → la barra dorada "Sesion iniciada — ¡hola de nuevo!"
                              que se ve arriba cuando ya iniciaste sesion.
   ============================================================================= */

// Escapa contenido de usuario antes de insertarlo con innerHTML (anti-XSS).
// Definido aquí para que auth.js sea autosuficiente (login.html no carga main.js).
if (typeof window.esc !== 'function') {
  window.esc = function (s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
}

const AUTH = {
  _session: null,

  // Carga la sesión desde el servidor (llamar en cada página con await)
  async init() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      this._session = res.ok ? await res.json() : null;
    } catch {
      this._session = null;
    }
    this.updateHeaderUI();
    // Aviso de bienvenida (una sola vez) tras iniciar sesión
    try {
      const welcome = sessionStorage.getItem('maydel_welcome');
      if (welcome && this._session && typeof showToast === 'function') {
        showToast(`¡Hola, ${welcome.split(' ')[0]}! Iniciaste sesión correctamente`, 'success');
        sessionStorage.removeItem('maydel_welcome');
      }
    } catch {}
    if (this._session && window.DB?.syncCartFromServer) {
      DB.syncCartFromServer().catch(() => {});
    }
    return this._session;
  },

  getSession()  { return this._session; },
  isLoggedIn()  { return !!this._session; },
  isAdmin()     { return this._session?.role === 'admin'; },

  requireAdmin() {
    if (!this.isAdmin()) {
      const base = window.location.pathname.includes('dashboard') ? '../' : '';
      window.location.href = base + 'login.html?redirect=dashboard';
    }
  },

  async login(email, password) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error };
      this._session = data;
      try { sessionStorage.setItem('maydel_welcome', data.name || ''); } catch {}
      this.updateHeaderUI();
      return { success: true, user: data };
    } catch {
      return { success: false, error: 'Error de conexión con el servidor' };
    }
  },

  async register(name, email, password, extra = {}) {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, password, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error };
      this._session = data;
      try { sessionStorage.setItem('maydel_welcome', data.name || ''); } catch {}
      this.updateHeaderUI();
      return { success: true, user: data };
    } catch {
      return { success: false, error: 'Error de conexión con el servidor' };
    }
  },

  // Pide confirmación antes de cerrar sesión (modal con el estilo del sitio).
  confirmLogout(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (document.getElementById('logoutConfirm')) return;

    const name = this._session && this._session.name ? esc(this._session.name.split(' ')[0]) : '';
    const overlay = document.createElement('div');
    overlay.className = 'logout-confirm';
    overlay.id = 'logoutConfirm';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'logoutConfirmTitle');
    overlay.innerHTML = `
      <div class="lc-card" role="document">
        <div class="lc-icon"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i></div>
        <h3 class="lc-title" id="logoutConfirmTitle">¿Cerrar sesión?</h3>
        <p class="lc-text">${name ? `${name}, ¿s` : '¿S'}eguro que quieres salir de tu cuenta?</p>
        <div class="lc-actions">
          <button type="button" class="lc-btn lc-cancel">Cancelar</button>
          <button type="button" class="lc-btn lc-confirm"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Sí, cerrar sesión</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => overlay.classList.add('open'));

    const close = () => {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      setTimeout(() => overlay.remove(), 220);
    };
    const onKey = ev => { if (ev.key === 'Escape') close(); };

    overlay.querySelector('.lc-cancel').addEventListener('click', close);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.lc-confirm').addEventListener('click', () => {
      overlay.querySelector('.lc-confirm').disabled = true;
      this.logout();
    });
    overlay.querySelector('.lc-confirm').focus();
  },

  async logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    this._session = null;
    const base = window.location.pathname.includes('dashboard') ? '../' : '';
    window.location.href = base + 'index.html';
  },

  updateHeaderUI() {
    const session = this._session;
    // Clase global en <body> para diferenciar TODA la interfaz según la sesión
    if (document.body) {
      document.body.classList.toggle('maydel-auth', !!session);
      document.body.classList.toggle('maydel-guest', !session);
    }
    this._renderWelcomeBar(session);

    const authArea = document.getElementById('authArea');
    if (!authArea) return;
    const base = window.location.pathname.includes('dashboard') ? '../' : '';
    if (session) {
      const first   = esc(session.name.split(' ')[0]);
      const initial = esc((session.name.trim()[0] || 'U').toUpperCase());
      authArea.innerHTML = `
        <div class="user-menu">
          <button class="user-menu-btn is-auth" onclick="toggleUserMenu(event)">
            <span class="user-avatar">${initial}<span class="user-online-dot"></span></span>
            <span class="user-menu-name">${first}</span>
            <i class="fa-solid fa-chevron-down" style="font-size:12px"></i>
          </button>
          <div class="user-dropdown" id="userDropdown">
            <div class="user-dropdown-header">
              <span class="udh-hi"><i class="fa-solid fa-circle-check"></i> Sesión iniciada</span>
              <span class="udh-name">${esc(session.name)}</span>
              <span class="udh-email">${esc(session.email)}</span>
            </div>
            ${session.role === 'admin'
              ? `<a href="${base}dashboard/index.html"><i class="fa-solid fa-gauge"></i> Dashboard</a>`
              : ''}
            <a href="${base}mis-pedidos.html"><i class="fa-solid fa-clipboard-list"></i> Mis pedidos</a>
            <a href="${base}mis-favoritos.html"><i class="fa-solid fa-heart"></i> Mis favoritos</a>
            <a href="${base}mi-cuenta.html"><i class="fa-solid fa-gear"></i> Configuración</a>
            <hr>
            <button onclick="AUTH.confirmLogout(event)">
              <i class="fa-solid fa-right-from-bracket"></i> Cerrar sesión
            </button>
          </div>
        </div>`;
    } else {
      authArea.innerHTML = `
        <a href="${base}login.html" class="header-login-btn">
          <i class="fa-solid fa-right-to-bracket"></i>
          <span>Iniciar sesión</span>
        </a>`;
    }
  },

  // Barra de bienvenida: visible SOLO con sesión iniciada, en páginas de tienda.
  _renderWelcomeBar(session) {
    const existing = document.getElementById('welcomeBar');
    const header = document.querySelector('header');
    if (!header || window.location.pathname.includes('dashboard') || !session) {
      if (existing) existing.remove();
      return;
    }
    const first = esc(session.name.split(' ')[0]);
    const inner = `
      <div class="welcome-bar-inner">
        <span class="wb-hi"><i class="fa-solid fa-circle-check"></i>
          <span>Sesión iniciada — ¡hola de nuevo, <strong>${first}</strong>!</span>
        </span>
        <span class="wb-links">
          <a href="mis-pedidos.html"><i class="fa-solid fa-clipboard-list"></i> Mis pedidos</a>
          <a href="mis-favoritos.html"><i class="fa-solid fa-heart"></i> Favoritos</a>
          <a href="#" class="wb-out" onclick="AUTH.confirmLogout(event);return false"><i class="fa-solid fa-right-from-bracket"></i> Salir</a>
        </span>
      </div>`;
    if (existing) { existing.innerHTML = inner; return; }
    const bar = document.createElement('div');
    bar.id = 'welcomeBar';
    bar.className = 'welcome-bar';
    bar.innerHTML = inner;
    header.insertAdjacentElement('afterend', bar);
  }
};

function toggleUserMenu(e) {
  e.stopPropagation();
  document.getElementById('userDropdown')?.classList.toggle('open');
}
document.addEventListener('click', () => {
  document.getElementById('userDropdown')?.classList.remove('open');
});
