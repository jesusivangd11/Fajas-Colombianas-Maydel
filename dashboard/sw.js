// Service worker del panel: recibe los avisos push de ventas y los muestra
// aunque el panel esté cerrado. No guarda nada en caché (el panel siempre
// carga la versión más nueva).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// Chrome pide un manejador de fetch para ofrecer "Instalar app"; deja pasar todo.
self.addEventListener('fetch', () => {});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || '🛍️ ¡Nueva venta en Maydel!';
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: data.body || 'Toca para ver el pedido',
      icon: '/dashboard/icon-192.png',
      badge: '/dashboard/icon-192.png',
      tag: data.tag || 'maydel-order',
      renotify: true,              // vuelve a sonar aunque haya otra del mismo pedido
      requireInteraction: true,    // se queda en pantalla hasta que la toquen
      vibrate: [400, 150, 400, 150, 600],
      data: { url: data.url || '/dashboard/?panel=orders' },
    });
    // Si el panel está abierto, que también suene y se actualice al instante.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach(w => w.postMessage({ type: 'maydel-push', payload: data }));
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/dashboard/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const panel = wins.find(w => new URL(w.url).pathname.startsWith('/dashboard'));
    if (panel) { await panel.focus(); return panel.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
