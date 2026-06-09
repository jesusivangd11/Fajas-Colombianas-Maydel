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
      this.updateHeaderUI();
      return { success: true, user: data };
    } catch {
      return { success: false, error: 'Error de conexión con el servidor' };
    }
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
    const authArea = document.getElementById('authArea');
    if (!authArea) return;
    const session = this._session;
    const base = window.location.pathname.includes('dashboard') ? '../' : '';
    if (session) {
      authArea.innerHTML = `
        <div class="user-menu">
          <button class="user-menu-btn" onclick="toggleUserMenu(event)">
            <i class="fa-solid fa-circle-user"></i>
            <span>${esc(session.name.split(' ')[0])}</span>
            <i class="fa-solid fa-chevron-down" style="font-size:10px"></i>
          </button>
          <div class="user-dropdown" id="userDropdown">
            <div class="user-dropdown-header">
              <span class="udh-name">${esc(session.name)}</span>
              <span class="udh-email">${esc(session.email)}</span>
            </div>
            ${session.role === 'admin'
              ? `<a href="${base}dashboard/index.html"><i class="fa-solid fa-gauge"></i> Dashboard</a>`
              : ''}
            <a href="${base}mis-pedidos.html"><i class="fa-solid fa-clipboard-list"></i> Mis pedidos</a>
            <a href="${base}mis-favoritos.html"><i class="fa-solid fa-heart"></i> Mis favoritos</a>
            <hr>
            <button onclick="AUTH.logout()">
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
  }
};

function toggleUserMenu(e) {
  e.stopPropagation();
  document.getElementById('userDropdown')?.classList.toggle('open');
}
document.addEventListener('click', () => {
  document.getElementById('userDropdown')?.classList.remove('open');
});
