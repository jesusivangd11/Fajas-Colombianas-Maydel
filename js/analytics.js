// Inyecta GA4 + Meta Pixel si hay IDs configurados (window.MAYDEL_CFG cargado por /config.js)
(function () {
  const cfg = window.MAYDEL_CFG || {};
  const head = document.head;

  // Google y Meta guardan la dirección completa de cada página que se mide. Al
  // volver de la verificación del banco (3D Secure) la URL del carrito trae la
  // clave secreta del pago; se quita ANTES de cargar las etiquetas. Este script
  // va con defer, así que el carrito ya leyó esos datos para mostrar la
  // confirmación cuando llega aquí.
  const SENSITIVE = ['payment_intent', 'payment_intent_client_secret', 'redirect_status', 'token', 'ticket'];
  try {
    const url = new URL(location.href);
    let dirty = false;
    for (const k of SENSITIVE) if (url.searchParams.has(k)) { url.searchParams.delete(k); dirty = true; }
    if (dirty) history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch {}

  // Etiqueta de Google (contenedor GTM-MHHLXV5M) con Google Ads. En casi todas las
  // páginas va escrita directo en el <head>; las que pueden traer claves en la URL
  // (el carrito al volver del banco) no la llevan, y aquí se carga DESPUÉS de
  // limpiar la dirección.
  const GTAG_CONTAINER = 'GTM-MHHLXV5M';
  if (!document.querySelector('script[src*="googletagmanager.com/gtm.js"]')) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    const g = document.createElement('script');
    g.async = true; g.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTAG_CONTAINER;
    head.appendChild(g);
  }

  // Una sola etiqueta de Google (gtag.js) para GA4 y Google Ads. Google Ads mide
  // la compra cuando la clienta llega a /gracias.html (conversión por URL).
  const gIds = [cfg.gaId, cfg.adsId].filter(id => /^(G|AW)-[A-Z0-9]+$/i.test(id || ''));
  if (gIds.length) {
    const s1 = document.createElement('script');
    s1.async = true; s1.src = `https://www.googletagmanager.com/gtag/js?id=${gIds[0]}`;
    head.appendChild(s1);
    const s2 = document.createElement('script');
    s2.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());` +
      gIds.map(id => `gtag('config','${id}');`).join('');
    head.appendChild(s2);
    window.gtag = window.gtag || function(){ (window.dataLayer = window.dataLayer || []).push(arguments); };
  }

  if (cfg.pixelId) {
    const s = document.createElement('script');
    s.textContent = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${cfg.pixelId}');fbq('track','PageView');`;
    head.appendChild(s);
  }
})();

// Helpers para trackear eventos puntuales (carrito, compra, etc.)
window.trackEvent = function (name, params) {
  params = params || {};
  try { if (window.gtag) window.gtag('event', name, params); } catch {}
  try {
    if (window.fbq) {
      const fbName = { purchase: 'Purchase', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout' }[name] || name;
      // Meta necesita value + currency en la compra para medir el retorno de anuncios.
      window.fbq('track', fbName, params.value != null ? { value: params.value, currency: params.currency || 'MXN' } : {});
    }
  } catch {}
};
