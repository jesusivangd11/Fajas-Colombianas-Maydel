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

        ${p.role === 'admin' || p.twoFactorEnabled ? this._twoFactorCard(p) : ''}

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
    const tf = el.querySelector('#acct2faForm');
    if (tf) tf.addEventListener('submit', e => this._twoFactorSubmit(e, el));
  },

  /* ── Verificación en dos pasos ──────────────────────────────────────────────
     Apagada: contraseña → "Activar" → QR + primer código → códigos de respaldo.
     Encendida: con contraseña + código se pueden pedir respaldos nuevos o apagarla. */
  _twoFactorCard(p) {
    const pwdField = p.hasPassword ? `
            <label class="acct-field">
              <span>Contraseña actual</span>
              <input type="password" id="acct2faPwd" autocomplete="current-password" required>
            </label>` : '';
    const head = `
          <div class="acct-card-head">
            <span class="acct-icon"><i class="fa-solid fa-mobile-screen-button"></i></span>
            <div>
              <h2>Verificación en dos pasos ${p.twoFactorEnabled ? '<span class="acct-badge-on">Activa</span>' : ''}</h2>
              <p>${p.twoFactorEnabled
                    ? 'Al entrar se pide la contraseña y además el código de tu app. Te quedan <strong>' + Number(p.backupCodesLeft) + '</strong> códigos de respaldo.'
                    : 'Protege el panel: aunque alguien tenga tu contraseña o entre a tu correo, sin tu celular no puede entrar. Usa Google Authenticator o Microsoft Authenticator.'}</p>
            </div>
          </div>`;
    if (!p.twoFactorEnabled) {
      return `
        <section class="acct-card" id="acct2faCard">${head}
          <form id="acct2faForm" class="acct-form" data-mode="setup" autocomplete="off">
            ${pwdField}
            <div id="acct2faSetup" hidden>
              <ol class="acct-2fa-steps">
                <li>Instala <strong>Google Authenticator</strong> o <strong>Microsoft Authenticator</strong> en tu celular.</li>
                <li>En la app toca <strong>+</strong> y escanea este código:</li>
              </ol>
              <img id="acct2faQr" alt="Código QR para la app de verificación" width="200" height="200" style="display:block;margin:6px auto 4px;border-radius:8px">
              <p style="font-size:12.5px;color:var(--gray-500);text-align:center;margin:0 0 10px">¿No puedes escanear? Escribe esta clave: <code id="acct2faSecret" style="user-select:all"></code></p>
              <label class="acct-field">
                <span>3. Escribe el código de 6 dígitos que muestra la app</span>
                <input type="text" id="acct2faCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
              </label>
            </div>
            <div class="acct-actions">
              <button type="submit" class="acct-btn acct-btn-primary"><i class="fa-solid fa-shield-halved"></i> <span id="acct2faBtnText">Activar</span></button>
              <span class="acct-msg" id="acct2faMsg"></span>
            </div>
            <div id="acct2faBackup"></div>
          </form>
        </section>`;
    }
    return `
        <section class="acct-card" id="acct2faCard">${head}
          <form id="acct2faForm" class="acct-form" data-mode="manage" autocomplete="off">
            ${pwdField}
            <label class="acct-field">
              <span>Código de tu app (o uno de respaldo)</span>
              <input type="text" id="acct2faCode" inputmode="numeric" autocomplete="one-time-code" maxlength="9" required>
            </label>
            <div class="acct-actions">
              <button type="submit" class="acct-btn acct-btn-primary" data-action="backup-codes"><i class="fa-solid fa-key"></i> Nuevos códigos de respaldo</button>
              <button type="submit" class="acct-btn" data-action="disable" style="background:#fee2e2;color:#991b1b"><i class="fa-solid fa-lock-open"></i> Desactivar</button>
              <span class="acct-msg" id="acct2faMsg"></span>
            </div>
            <div id="acct2faBackup"></div>
          </form>
        </section>`;
  },

  // Lista de códigos de respaldo + botón para descargarlos. Solo se ven esta vez.
  _showBackupCodes(el, codes) {
    const box = el.querySelector('#acct2faBackup');
    box.innerHTML = `
      <div class="acct-2fa-backup">
        <strong><i class="fa-solid fa-triangle-exclamation"></i> Guarda estos códigos de respaldo</strong>
        <p>Cada uno sirve <strong>una sola vez</strong> si pierdes tu celular. No los volverás a ver: descárgalos o anótalos en un lugar seguro.</p>
        <div class="acct-2fa-codes">${codes.map(c => `<code>${esc(c)}</code>`).join('')}</div>
        <button type="button" class="acct-btn acct-btn-primary" id="acct2faDownload"><i class="fa-solid fa-download"></i> Descargar códigos</button>
      </div>`;
    box.querySelector('#acct2faDownload').addEventListener('click', () => {
      const text = 'Fajas Maydel – códigos de respaldo de verificación en dos pasos\n' +
        'Cuenta: ' + this._profile.email + '\nCada código sirve una sola vez.\n\n' + codes.join('\n') + '\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = 'codigos-respaldo-maydel.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  },

  async _twoFactorSubmit(e, el) {
    e.preventDefault();
    const form = e.target;
    const btn  = e.submitter || form.querySelector('button[type=submit]');
    const msg  = el.querySelector('#acct2faMsg');
    const pwd  = el.querySelector('#acct2faPwd');
    const code = el.querySelector('#acct2faCode');
    const post = async (url, body) => {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo completar');
      return data;
    };

    this._busy(btn, true);
    try {
      if (form.dataset.mode === 'setup') {
        // Paso 1: pedir el QR.  Paso 2: confirmar con el primer código.
        const setup = el.querySelector('#acct2faSetup');
        if (setup.hidden) {
          const d = await post('/api/users/me/2fa/setup', { currentPassword: pwd ? pwd.value : undefined });
          el.querySelector('#acct2faQr').src = d.qr;
          el.querySelector('#acct2faSecret').textContent = d.secret;
          setup.hidden = false;
          if (pwd) pwd.closest('.acct-field').hidden = true;
          code.required = true;
          code.focus();
          el.querySelector('#acct2faBtnText').textContent = 'Confirmar y activar';
          return;
        }
        const d = await post('/api/users/me/2fa/enable', { code: code.value });
        this._profile.twoFactorEnabled = true;
        this._profile.backupCodesLeft = d.backupCodes.length;
        this._render(el);
        this._showBackupCodes(el, d.backupCodes);
        this._say(el.querySelector('#acct2faMsg'), 'Verificación en dos pasos activada', 'ok');
        return;
      }

      const action = btn.dataset.action;
      const body = { currentPassword: pwd ? pwd.value : undefined, code: code.value };
      if (action === 'disable') {
        if (!confirm('¿Desactivar la verificación en dos pasos? Tu panel quedará protegido solo con la contraseña.')) return;
        await post('/api/users/me/2fa/disable', body);
        this._profile.twoFactorEnabled = false;
        this._render(el);
        this._say(el.querySelector('#acct2faMsg'), 'Verificación en dos pasos desactivada', 'ok');
      } else {
        const d = await post('/api/users/me/2fa/backup-codes', body);
        this._profile.backupCodesLeft = d.backupCodes.length;
        this._render(el);
        this._showBackupCodes(el, d.backupCodes);
        this._say(el.querySelector('#acct2faMsg'), 'Códigos nuevos generados; los anteriores ya no sirven', 'ok');
      }
    } catch (err) {
      this._say(msg, err.message || 'Error de conexión con el servidor', 'error');
    } finally {
      this._busy(btn, false);
    }
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
