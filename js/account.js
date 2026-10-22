/* =============================================================================
   account.js  ·  CONFIGURACIÓN DE LA CUENTA (compartido)
   -----------------------------------------------------------------------------
   Los dos formularios ("mis datos" y "cambiar contraseña") que cualquier usuario
   con sesión usa para editarse a sí mismo. Vive aquí una sola vez porque lo
   montan dos pantallas distintas:
     • mi-cuenta.html          → la tienda
     • dashboard (panel-account) → el admin, sin salir de su panel

   Uso:  ACCOUNT.mount(document.getElementById('donde'))
   ============================================================================= */

const ACCOUNT = {
  _profile: null,

  async mount(el) {
    if (!el) return;
    el.innerHTML = `<div class="acct-loading"><i class="fa-solid fa-spinner fa-spin"></i> Cargando tu cuenta...</div>`;
    try {
      const res = await fetch('/api/users/me', { credentials: 'include' });
      if (!res.ok) throw new Error('no-session');
      this._profile = await res.json();
    } catch {
      el.innerHTML = `<div class="acct-loading">No pudimos cargar tu cuenta. <a href="/login.html">Inicia sesión</a>.</div>`;
      return;
    }
    this._render(el);
  },

  _render(el) {
    const p = this._profile;
    // Sin contraseña = entró con Google/Facebook. En ese caso no le pedimos la
    // "actual" (no tiene), sino que le ofrecemos crear una.
    const hasPwd = p.hasPassword;

    el.innerHTML = `
      <div class="acct-grid">

        <section class="acct-card">
          <div class="acct-card-head">
            <span class="acct-icon"><i class="fa-solid fa-id-card"></i></span>
            <div>
              <h2>Mis datos</h2>
              <p>Tu nombre y el correo con el que inicias sesión.</p>
            </div>
          </div>

          <form id="acctProfileForm" class="acct-form" autocomplete="off">
            <label class="acct-field">
              <span>Nombre de usuario</span>
              <input type="text" id="acctName" value="${esc(p.name)}" maxlength="100" required>
            </label>

            <label class="acct-field">
              <span>Correo electrónico</span>
              <input type="email" id="acctEmail" value="${esc(p.email)}" required>
            </label>

            ${hasPwd ? `
            <label class="acct-field" id="acctEmailPwdWrap" hidden>
              <span>Contraseña actual <small>(necesaria para cambiar el correo)</small></span>
              <input type="password" id="acctEmailPwd" autocomplete="current-password">
            </label>` : ''}

            <div class="acct-actions">
              <button type="submit" class="acct-btn acct-btn-primary">
                <i class="fa-solid fa-floppy-disk"></i> Guardar cambios
              </button>
              <span class="acct-msg" id="acctProfileMsg"></span>
            </div>
          </form>
        </section>

        <section class="acct-card">
          <div class="acct-card-head">
            <span class="acct-icon"><i class="fa-solid fa-key"></i></span>
            <div>
              <h2>${hasPwd ? 'Cambiar contraseña' : 'Crear contraseña'}</h2>
              <p>${hasPwd
                    ? 'Usa al menos 8 caracteres.'
                    : `Entraste con ${esc(p.provider)}. Si creas una contraseña también podrás entrar con tu correo.`}</p>
            </div>
          </div>

          <form id="acctPwdForm" class="acct-form" autocomplete="off">
            ${hasPwd ? `
            <label class="acct-field">
              <span>Contraseña actual</span>
              <input type="password" id="acctCurrentPwd" autocomplete="current-password" required>
            </label>` : ''}

            <label class="acct-field">
              <span>Nueva contraseña</span>
              <input type="password" id="acctNewPwd" minlength="8" autocomplete="new-password" required>
            </label>

            <label class="acct-field">
              <span>Confirmar nueva contraseña</span>
              <input type="password" id="acctNewPwd2" minlength="8" autocomplete="new-password" required>
            </label>

            <div class="acct-actions">
              <button type="submit" class="acct-btn acct-btn-primary">
                <i class="fa-solid fa-shield-halved"></i> ${hasPwd ? 'Actualizar contraseña' : 'Crear contraseña'}
              </button>
              <span class="acct-msg" id="acctPwdMsg"></span>
            </div>
          </form>
        </section>

      </div>`;

    // Solo pedimos la contraseña actual si el correo realmente cambió.
    if (hasPwd) {
      const emailInput = el.querySelector('#acctEmail');
      const pwdWrap    = el.querySelector('#acctEmailPwdWrap');
      const original   = p.email;
      emailInput.addEventListener('input', () => {
        pwdWrap.hidden = emailInput.value.trim().toLowerCase() === original;
      });
    }

    el.querySelector('#acctProfileForm').addEventListener('submit', e => this._saveProfile(e, el));
    el.querySelector('#acctPwdForm').addEventListener('submit',     e => this._savePassword(e, el));
  },

  async _saveProfile(e, el) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const msg = el.querySelector('#acctProfileMsg');

    const body = {
      name:  el.querySelector('#acctName').value.trim(),
      email: el.querySelector('#acctEmail').value.trim(),
    };
    const pwdField = el.querySelector('#acctEmailPwd');
    if (pwdField) body.currentPassword = pwdField.value;

    this._busy(btn, true);
    try {
      const res  = await fetch('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return this._say(msg, data.error || 'No se pudo guardar', 'error');

      this._profile = { ...this._profile, name: data.user.name, email: data.user.email };

      // Refresca la cabecera (avatar, nombre) sin recargar la página.
      if (window.AUTH) { AUTH._session = data.user; AUTH.updateHeaderUI(); }
      const dashName  = document.getElementById('dashUserName');
      const dashEmail = document.getElementById('dashUserEmail');
      if (dashName)  dashName.textContent  = data.user.name;
      if (dashEmail) dashEmail.textContent = data.user.email;

      // Vuelve a pintar con los valores nuevos (y oculta el campo de contraseña).
      // El mensaje va después: el _render destruye el <span> anterior.
      this._render(el);
      this._say(el.querySelector('#acctProfileMsg'), 'Datos actualizados', 'ok');
      return;
    } catch {
      this._say(msg, 'Error de conexión con el servidor', 'error');
    } finally {
      this._busy(btn, false);
    }
  },

  async _savePassword(e, el) {
    e.preventDefault();
    const btn  = e.target.querySelector('button[type=submit]');
    const msg  = el.querySelector('#acctPwdMsg');
    const cur  = el.querySelector('#acctCurrentPwd');
    const nw   = el.querySelector('#acctNewPwd').value;
    const nw2  = el.querySelector('#acctNewPwd2').value;

    if (nw !== nw2) return this._say(msg, 'Las contraseñas nuevas no coinciden', 'error');
    if (nw.length < 8) return this._say(msg, 'Mínimo 8 caracteres', 'error');

    this._busy(btn, true);
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword: cur ? cur.value : undefined, newPassword: nw }),
      });
      const data = await res.json();
      if (!res.ok) return this._say(msg, data.error || 'No se pudo cambiar', 'error');

      this._profile.hasPassword = true;
      this._render(el); // limpia los campos; el mensaje va sobre el <span> nuevo
      this._say(el.querySelector('#acctPwdMsg'), 'Contraseña actualizada', 'ok');
      return;
    } catch {
      this._say(msg, 'Error de conexión con el servidor', 'error');
    } finally {
      this._busy(btn, false);
    }
  },

  _busy(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle('is-busy', on);
  },

  _say(el, text, kind) {
    if (typeof showToast === 'function') showToast(text, kind === 'ok' ? 'success' : 'error');
    if (!el) return;
    el.textContent = text;
    el.className = `acct-msg acct-msg-${kind}`;
    if (kind === 'ok') setTimeout(() => { el.textContent = ''; el.className = 'acct-msg'; }, 4000);
  },
};
