// ── Panel en el celular + avisos de ventas en vivo ────────────────────────────
// MOBILE: cajón del menú lateral en pantallas chicas.
// LIVE:   revisa cada pocos segundos si hay ventas nuevas (alerta con sonido,
//         vibración y notificación), mantiene la insignia de "por atender" y
//         maneja la sección "Avisos de ventas" (correos, prueba, push).

const MOBILE = {
  openDrawer()  { document.body.classList.add('m-drawer-open'); },
  closeDrawer() { document.body.classList.remove('m-drawer-open'); },
};

const LIVE = (() => {
  const SEEN_KEY = 'maydel_seen_orders';
  const SOUND_KEY = 'maydel_sale_sound';
  const POLL_VISIBLE = 20000, POLL_HIDDEN = 60000;
  let seen = null;               // ids ya vistos (null = primera carga)
  let timer = null, ringing = null, audioCtx = null, titleBlink = null;
  const baseTitle = document.title;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const soundOn = () => store.get(SOUND_KEY, true);
  const money = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n || 0));
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  // ── Sonido (el navegador solo deja sonar después de que tocaste la página) ──
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch {}
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, unlockAudio, { passive: true }));

  function chime() {
    if (!audioCtx || !soundOn()) return;
    const t0 = audioCtx.currentTime;
    [880, 1175, 1568, 1175, 1568].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      const t = t0 + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g).connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.16);
    });
  }

  // ── Alerta urgente: suena cada 6 s hasta que la cierren o abran el pedido ──
  function alarm(order, count) {
    const box = document.getElementById('saleAlert');
    const paid = order.paymentStatus === 'paid';
    document.getElementById('saleAlertTitle').textContent =
      count > 1 ? `¡${count} VENTAS NUEVAS!` : paid ? '💰 ¡VENTA PAGADA!' : '🛍️ ¡NUEVO PEDIDO!';
    document.getElementById('saleAlertBody').textContent =
      `${money(order.total)} · ${order.userName || 'Clienta'} · #${order.id}` + (paid ? '' : ' · por confirmar pago');
    document.getElementById('saleAlertOpen').onclick = () => {
      dismiss();
      showPanelByName('orders').then(() => viewOrderDetail(order.id));
    };
    box.hidden = false;
    chime();
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 600]);
    clearInterval(ringing);
    ringing = setInterval(() => { chime(); if (navigator.vibrate) navigator.vibrate([300, 120, 300]); }, 6000);
    clearInterval(titleBlink);
    let on = false;
    titleBlink = setInterval(() => { document.title = (on = !on) ? '🔔 ¡NUEVA VENTA!' : baseTitle; }, 1000);
  }

  function dismiss() {
    document.getElementById('saleAlert').hidden = true;
    clearInterval(ringing); ringing = null;
    clearInterval(titleBlink); titleBlink = null;
    document.title = baseTitle;
  }

  async function systemNotify(order) {
    // Si el push ya está activo, el service worker muestra la notificación.
    if (!pushSupported || Notification.permission !== 'granted' || !document.hidden) return;
    if (await currentSubscription()) return;
    const reg = await navigator.serviceWorker.getRegistration('/dashboard/');
    const title = order.paymentStatus === 'paid' ? `💰 ¡VENTA PAGADA! ${money(order.total)}` : `🛍️ ¡NUEVO PEDIDO! ${money(order.total)}`;
    const opts = { body: `#${order.id} · ${order.userName || ''}`, icon: '/dashboard/icon-192.png', tag: 'order-' + order.id, requireInteraction: true, data: { url: '/dashboard/?panel=orders&order=' + order.id } };
    if (reg) reg.showNotification(title, opts); else new Notification(title, opts);
  }

  function setBadge(n) {
    document.querySelectorAll('[data-pending-badge]').forEach(b => { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; });
    if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }

  // ── Radar de pedidos ──
  async function poll() {
    clearTimeout(timer);
    try {
      const feed = await apiFetch('/api/admin/orders/feed');
      setBadge(feed.pending);
      const ids = feed.orders.map(o => o.id);
      if (seen === null) {
        // Primera carga: lo que ya existía no suena (salvo lo que llegó desde la última visita).
        const stored = store.get(SEEN_KEY, null);
        seen = new Set(stored || ids);
      }
      const fresh = feed.orders.filter(o => !seen.has(o.id));
      ids.forEach(id => seen.add(id));
      store.set(SEEN_KEY, [...seen].slice(-60));
      if (fresh.length) {
        alarm(fresh[0], fresh.length);
        systemNotify(fresh[0]);
        const panel = document.getElementById('panel-orders');
        if (panel && panel.style.display !== 'none') { loadOrderStats(); loadOrderTable(); }
        else if (document.getElementById('panel-overview')?.style.display !== 'none' && typeof renderOverview === 'function') renderOverview();
      }
    } catch (err) {
      if (err.status === 401 || err.status === 403) return;   // sesión vencida: el panel ya pide volver a entrar
    }
    timer = setTimeout(poll, document.hidden ? POLL_HIDDEN : POLL_VISIBLE);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  // ── Push (notificaciones con el panel cerrado) ──
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.register('/dashboard/sw.js', { scope: '/dashboard/' }); }
    catch (err) { console.warn('[push] service worker', err); return null; }
  }
  async function currentSubscription() {
    if (!pushSupported) return null;
    const reg = await navigator.serviceWorker.getRegistration('/dashboard/');
    return reg ? reg.pushManager.getSubscription() : null;
  }
  const b64ToBytes = b64 => {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  };
  function deviceName() {
    const ua = navigator.userAgent;
    const os = /Android/.test(ua) ? 'Android' : isIOS ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Otro';
    const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Navegador';
    return `${os} · ${br}`;
  }
  async function enablePush() {
    unlockAudio();
    if (!pushSupported) throw new Error(isIOS && !standalone
      ? 'En iPhone primero agrega el panel a tu pantalla de inicio (abajo están los pasos) y ábrelo desde ese ícono.'
      : 'Este navegador no permite notificaciones. Usa Chrome.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Bloqueaste las notificaciones. Actívalas en los ajustes del navegador para este sitio y vuelve a intentar.');
    const reg = (await registerSW()) || (await navigator.serviceWorker.ready);
    await navigator.serviceWorker.ready;
    const { publicKey } = await apiFetch('/api/admin/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    return apiFetch('/api/admin/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), device: deviceName() }) });
  }
  async function disablePush() {
    const sub = await currentSubscription();
    if (!sub) return;
    await apiFetch('/api/admin/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe();
  }

  // Mensaje del service worker (push recibido con el panel abierto)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'maydel-push') poll(); });
  }

  // ── Sección "Avisos de ventas" ──
  const row = (ok, title, detail) => `<div class="al-row">
      <span class="al-dot ${ok === true ? 'ok' : ok === false ? 'bad' : ''}"><i class="fa-solid ${ok === true ? 'fa-check' : ok === false ? 'fa-xmark' : 'fa-minus'}"></i></span>
      <div><strong>${title}</strong>${detail ? `<div class="al-detail">${detail}</div>` : ''}</div></div>`;

  async function renderAlerts(root) {
    root.innerHTML = '<div class="section-panel">Cargando…</div>';
    let info;
    try { info = await apiFetch('/api/admin/notify'); }
    catch (err) { root.innerHTML = `<div class="section-panel">No se pudo cargar: ${esc(err.message)}</div>`; return; }
    const sub = await currentSubscription().catch(() => null);
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';

    root.innerHTML = `
      <div class="section-panel al-card al-push">
        <div class="al-head"><i class="fa-solid fa-mobile-screen-button"></i><div>
          <h3>Notificación en este celular</h3>
          <p>Suena y aparece en la pantalla con cada venta, <b>aunque el panel esté cerrado</b>.</p></div></div>
        <div class="al-state">${sub
          ? row(true, 'Activada en este dispositivo', `${info.pushDevices} dispositivo${info.pushDevices === 1 ? '' : 's'} recibiendo avisos`)
          : row(false, 'Desactivada en este dispositivo', perm === 'denied' ? 'Las bloqueaste en el navegador: actívalas en Ajustes del sitio → Notificaciones.' : info.pushDevices ? `Ya llegan a ${info.pushDevices} dispositivo${info.pushDevices === 1 ? '' : 's'}, pero no a este.` : 'Ningún dispositivo recibe avisos todavía.')}</div>
        ${sub
          ? `<button class="al-btn al-btn-ghost" id="alPushOff"><i class="fa-solid fa-bell-slash"></i> Desactivar en este dispositivo</button>`
          : `<button class="al-btn al-btn-main" id="alPushOn"><i class="fa-solid fa-bell"></i> Activar notificaciones</button>`}
        ${isIOS && !standalone ? `<div class="al-tip"><b>iPhone:</b> Apple solo permite avisos si el panel está en tu pantalla de inicio:
          <ol><li>Abre esta página en <b>Safari</b>.</li><li>Toca <i class="fa-solid fa-arrow-up-from-bracket"></i> <b>Compartir</b> → <b>Agregar a inicio</b>.</li><li>Abre <b>Maydel Admin</b> desde el nuevo ícono y toca "Activar notificaciones".</li></ol></div>`
          : !standalone ? `<div class="al-tip"><b>Tip:</b> en Chrome toca <b>⋮ → Agregar a pantalla principal / Instalar app</b> para tener el panel como app, con su ícono.</div>` : ''}
      </div>

      <div class="section-panel al-card">
        <div class="al-head"><i class="fa-solid fa-envelope"></i><div>
          <h3>Correo de cada venta</h3>
          <p>A estos correos llega el aviso de cada venta${info.emailsFrom === 'vercel' ? ' (hoy vienen de la configuración de Vercel)' : ''}.</p></div></div>
        ${info.mail.configured ? '' : row(false, 'El servidor de correo no está configurado', 'Los correos no salen hasta configurar SMTP en Vercel.')}
        <label class="form-label" for="alEmails">Correos (sepáralos con coma, máx. 5)</label>
        <input class="form-input" id="alEmails" type="text" inputmode="email" autocomplete="email" value="${esc(info.emails.join(', '))}" placeholder="tucorreo@gmail.com">
        <div class="al-hint">Se envían desde <b>${esc(info.mail.from || '—')}</b>. Si no los ves, revisa <b>Spam / Correo no deseado</b> y márcalo como "No es spam".</div>
        <button class="al-btn al-btn-ghost" id="alSaveEmails"><i class="fa-solid fa-floppy-disk"></i> Guardar correos</button>
      </div>

      <div class="section-panel al-card">
        <div class="al-head"><i class="fa-solid fa-volume-high"></i><div>
          <h3>Alarma con el panel abierto</h3>
          <p>Mientras tengas el panel abierto revisa cada 20 segundos: si entra una venta suena una alarma que se repite hasta que la veas.</p></div></div>
        <label class="al-switch"><input type="checkbox" id="alSound" ${soundOn() ? 'checked' : ''}> Sonido de alarma activado</label>
        <button class="al-btn al-btn-ghost" id="alHear"><i class="fa-solid fa-play"></i> Escuchar la alarma</button>
      </div>

      <div class="section-panel al-card">
        <div class="al-head"><i class="fa-solid fa-paper-plane"></i><div>
          <h3>Probar los avisos</h3>
          <p>Manda un aviso de prueba por correo${info.telegram ? ', Telegram' : ''} y a los celulares activados.</p></div></div>
        <button class="al-btn al-btn-main" id="alTest"><i class="fa-solid fa-paper-plane"></i> Mandar prueba</button>
        <div id="alTestResult"></div>
      </div>`;

    const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle('loading', on); };
    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = async () => { busy(b, true); try { await fn(b); } finally { busy(b, false); } }; };

    on('alPushOn', async () => {
      try { await enablePush(); showToast('¡Listo! Este celular recibirá cada venta'); renderAlerts(root); }
      catch (err) { showToast(err.message, 'error'); }
    });
    on('alPushOff', async () => { await disablePush(); showToast('Notificaciones desactivadas aquí'); renderAlerts(root); });
    on('alSaveEmails', async () => {
      try {
        const r = await apiFetch('/api/admin/notify/emails', { method: 'PUT', body: JSON.stringify({ emails: document.getElementById('alEmails').value }) });
        document.getElementById('alEmails').value = r.emails.join(', ');
        showToast('Correos guardados');
      } catch (err) { showToast(err.message, 'error'); }
    });
    document.getElementById('alSound').onchange = e => { store.set(SOUND_KEY, e.target.checked); };
    on('alHear', async () => { unlockAudio(); const prev = soundOn(); store.set(SOUND_KEY, true); chime(); store.set(SOUND_KEY, prev); if (navigator.vibrate) navigator.vibrate([400, 150, 400]); });
    on('alTest', async () => {
      const out = document.getElementById('alTestResult');
      out.innerHTML = '<div class="al-detail">Enviando…</div>';
      try {
        const r = await apiFetch('/api/admin/notify/test', { method: 'POST', body: '{}' });
        out.innerHTML = `<div class="al-state">
          ${row(r.email.ok, 'Correo', r.email.ok ? `Enviado a <b>${esc(r.email.to.join(', '))}</b>. Revisa también Spam.` : esc(r.email.error || r.email.note || 'No se pudo enviar'))}
          ${info.telegram || r.telegram.ok ? row(r.telegram.ok, 'Telegram', r.telegram.ok ? 'Enviado' : esc(r.telegram.error || '')) : ''}
          ${row(r.push.ok, 'Notificación al celular', r.push.ok ? `Enviada a ${r.push.sent} dispositivo${r.push.sent === 1 ? '' : 's'}` : esc(r.push.error || 'No se pudo enviar'))}
        </div>`;
      } catch (err) { out.innerHTML = `<div class="al-detail">${esc(err.message)}</div>`; }
    });
  }

  // Arranque (después de que el panel cargó la sesión)
  document.addEventListener('DOMContentLoaded', () => {
    registerSW();
    setTimeout(poll, 1500);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { dismiss(); MOBILE.closeDrawer(); } });

  return { dismiss, renderAlerts, refreshBadge: poll };
})();
