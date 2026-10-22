const nodemailer = require('nodemailer');

const FROM_NAME  = process.env.SMTP_FROM_NAME || 'Fajas Colombianas Maydel';
const FROM_EMAIL = process.env.SMTP_USER || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!FROM_EMAIL || FROM_EMAIL.startsWith('CAMBIAR')) {
    console.warn('[mailer] SMTP_USER no configurado. Los correos se mostraran en consola en lugar de enviarse.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: FROM_EMAIL, pass: process.env.SMTP_PASS || '' },
  });
  return transporter;
}

async function send({ to, subject, html, text }) {
  const tx = getTransporter();
  if (!tx) {
    console.log('\n========== EMAIL (modo simulado) ==========');
    console.log('Para:', to);
    console.log('Asunto:', subject);
    console.log('Cuerpo (texto):', text || '(solo HTML)');
    console.log('===========================================\n');
    return { simulated: true };
  }
  return tx.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to, subject, html,
    // Versión en texto con el MISMO contenido que el HTML: un texto alterno de una
    // sola línea frente a un HTML largo es una señal típica de spam.
    text: html ? htmlToText(html) : text,
  });
}

function htmlToText(html) {
  return html
    .replace(/<(style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => `${label.replace(/<[^>]+>/g, '').trim()} (${href})`)
    .replace(/<\/(p|div|tr|h[1-6]|li)>|<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const fmt = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n || 0));

// Todo lo que escribe la clienta (nombre, notas, dirección...) se escapa antes
// de meterlo al HTML del correo: si no, podría inyectar enlaces o contenido falso
// en los correos que salen con la marca de la tienda (incluido el del admin).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shell(title, body, accentColor = '#1a5c2e') {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;color:#111827">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-top:24px;margin-bottom:24px">
    <div style="background:${accentColor};padding:24px 28px;color:#fff">
      <h1 style="margin:0;font-size:20px;font-weight:700;letter-spacing:.5px">FAJAS COLOMBIANAS MAYDEL</h1>
      <p style="margin:6px 0 0;font-size:13px;opacity:.85">${title}</p>
    </div>
    <div style="padding:28px">${body}</div>
    <div style="background:#f9fafb;padding:18px 28px;font-size:12px;color:#6b7280;text-align:center;border-top:1px solid #e5e7eb">
      <p style="margin:0">Fajas Colombianas Maydel &middot; Chihuahua, Mexico</p>
      <p style="margin:6px 0 0"><a href="https://wa.me/526143716816" style="color:${accentColor};text-decoration:none">WhatsApp: 614 371 6816</a></p>
    </div>
  </div></body></html>`;
}

function itemRows(items) {
  return items.map(i => {
    const meta = [i.size, i.color, i.option].filter(Boolean).join(' / ');
    return `<tr>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb">${esc(i.productName)}${meta ? `<br><small style="color:#6b7280">${esc(meta)}</small>` : ''}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${i.qty}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${fmt(i.price * i.qty)}</td>
    </tr>`;
  }).join('');
}

function orderTable(order) {
  return `<table style="width:100%;border-collapse:collapse;margin:18px 0">
    <thead><tr style="background:#f3f4f6"><th style="padding:10px 8px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:1px">Producto</th>
      <th style="padding:10px 8px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:1px">Cant.</th>
      <th style="padding:10px 8px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:1px">Subtotal</th></tr></thead>
    <tbody>${itemRows(order.items || [])}</tbody>
    <tfoot>
      <tr><td colspan="2" style="padding:10px 8px;text-align:right;color:#6b7280">Subtotal</td><td style="padding:10px 8px;text-align:right">${fmt(order.subtotal)}</td></tr>
      ${order.discountAmount ? `<tr><td colspan="2" style="padding:10px 8px;text-align:right;color:#6b7280">Descuento (${esc(order.couponCode)})</td><td style="padding:10px 8px;text-align:right">-${fmt(order.discountAmount)}</td></tr>` : ''}
      <tr><td colspan="2" style="padding:10px 8px;text-align:right;color:#6b7280">Envio${order.couponCode && !order.shippingCost ? ` (${esc(order.couponCode)})` : ''}</td><td style="padding:10px 8px;text-align:right">${order.shippingCost ? fmt(order.shippingCost) : 'GRATIS'}</td></tr>
      <tr><td colspan="2" style="padding:14px 8px;text-align:right;font-weight:700;border-top:2px solid #111">TOTAL</td><td style="padding:14px 8px;text-align:right;font-weight:700;border-top:2px solid #111">${fmt(order.total)}</td></tr>
    </tfoot></table>`;
}

async function sendOrderToCustomer(order) {
  const paid = order.paymentStatus === 'paid';
  const body = `
    <p>Hola <strong>${esc(order.userName)}</strong>,</p>
    <p>${paid ? 'Recibimos el pago de tu pedido' : 'Recibimos tu pedido'} <strong>#${order.id}</strong>. ¡Gracias por confiar en Maydel!</p>
    ${orderTable(order)}
    <div style="background:#eaf5ee;border-left:3px solid #1a5c2e;padding:14px 16px;margin:18px 0;font-size:14px;color:#0d3d1a">
      <strong>Estado:</strong> ${paid ? 'Pago confirmado &mdash; preparando envio' : 'Pendiente de pago &mdash; te contactaremos por WhatsApp para confirmarlo'}<br>
      <strong>Envio a:</strong> ${esc(order.shippingState || 'Mexico')} (${order.shippingState && order.shippingState.toLowerCase().includes('chihuahua') ? '1-3 dias habiles' : '3-7 dias habiles'})
    </div>
    <p style="margin-top:18px;font-size:14px;color:#6b7280">Si tienes preguntas, responde este correo o escribenos por WhatsApp.</p>
    <p style="margin-top:24px"><a href="${PUBLIC_URL}/mis-pedidos.html" style="display:inline-block;background:#1a5c2e;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:1px;text-transform:uppercase">Ver mis pedidos</a></p>
  `;
  return send({
    to: order.userEmail,
    subject: paid ? `Pago confirmado - pedido #${order.id} - Fajas Maydel` : `Recibimos tu pedido #${order.id} - Fajas Maydel`,
    html: shell(`Pedido #${order.id}`, body),
    text: `Hola ${order.userName}, recibimos tu pedido ${order.id} por ${fmt(order.total)}. Gracias por tu compra.`,
  });
}

async function sendOrderToAdmin(order) {
  if (!ADMIN_EMAIL) return;
  const paid = order.paymentStatus === 'paid';
  const body = `
    <p style="font-size:15px"><strong>${paid ? 'Venta pagada con tarjeta' : 'Nuevo pedido recibido'}</strong></p>
    <table style="width:100%;font-size:14px;margin-bottom:12px">
      <tr><td style="padding:4px 0;color:#6b7280">ID:</td><td><strong>${order.id}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">Cliente:</td><td>${esc(order.userName)} &lt;${esc(order.userEmail)}&gt;</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">Telefono:</td><td>${esc(order.shippingInfo?.phone || '-')}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">Direccion:</td><td>${esc([order.shippingInfo?.address, order.shippingInfo?.city, order.shippingInfo?.cp && 'C.P. ' + order.shippingInfo.cp].filter(Boolean).join(', ') || '-')}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">Estado:</td><td>${esc(order.shippingState || '-')}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">Pago:</td><td>${order.paymentMethod === 'stripe' ? 'Stripe (en linea)' : 'Por WhatsApp'} &mdash; ${esc(order.paymentStatus)}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280">Notas:</td><td>${esc(order.notes || '-')}</td></tr>
    </table>
    ${orderTable(order)}
    <p style="margin-top:18px"><a href="${PUBLIC_URL}/dashboard/" style="display:inline-block;background:#c9a96e;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:1px;text-transform:uppercase">Abrir panel</a></p>
  `;
  return send({
    to: ADMIN_EMAIL,
    subject: `[Maydel] ${paid ? 'VENTA PAGADA' : 'Nuevo pedido'} #${order.id} - ${fmt(order.total)} - ${String(order.userName || '').replace(/[\r\n]/g, ' ')}`,
    html: shell(`${paid ? 'Venta pagada' : 'Nuevo pedido'} #${order.id}`, body, '#c9a96e'),
    text: `${paid ? 'Venta pagada' : 'Nuevo pedido'} ${order.id} de ${order.userName} por ${fmt(order.total)}.`,
  });
}

// Aviso al cliente de que su pedido viene con retraso (o de que ya se normalizó).
async function sendOrderDelayUpdate(order) {
  const body = order.delayed
    ? `<p>Hola <strong>${esc(order.userName)}</strong>,</p>
       <p>Te avisamos que tu pedido <strong>#${order.id}</strong> viene con <strong>retraso</strong>.</p>
       ${order.delayNote ? `<div style="background:#fef3c7;border-radius:4px;padding:16px;margin:18px 0;color:#92400e">${esc(order.delayNote)}</div>` : ''}
       <p>Lamentamos la espera; seguimos al pendiente para que te llegue lo antes posible.</p>`
    : `<p>Hola <strong>${esc(order.userName)}</strong>,</p>
       <p>Buenas noticias: tu pedido <strong>#${order.id}</strong> ya no tiene retraso y sigue su curso normal.</p>`;
  return send({
    to: order.userEmail,
    subject: order.delayed ? `Tu pedido #${order.id} viene con retraso` : `Tu pedido #${order.id} sigue su curso`,
    html: shell(`Pedido #${order.id}`, body + `
      <p style="margin-top:24px"><a href="${PUBLIC_URL}/mis-pedidos.html" style="display:inline-block;background:#1a5c2e;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:1px;text-transform:uppercase">Ver mi pedido</a></p>`),
    text: order.delayed
      ? `Tu pedido ${order.id} viene con retraso. ${order.delayNote || ''}`
      : `Tu pedido ${order.id} ya no tiene retraso.`,
  });
}

async function sendOrderStatusUpdate(order) {
  const labels = {
    pending: 'Pendiente', confirmed: 'Confirmado', processing: 'En preparacion',
    shipped: 'Enviado', delivered: 'Entregado', cancelled: 'Cancelado',
  };
  const tracking = order.trackingNumber && ['shipped', 'delivered'].includes(order.status)
    ? `<div style="background:#f3f4f6;border-radius:4px;padding:14px 16px;margin:18px 0;font-size:14px">
         <strong>Paquetería:</strong> ${esc(order.trackingCarrier || '-')}<br>
         <strong>Número de guía:</strong> <span style="font-family:monospace;font-size:15px">${esc(order.trackingNumber)}</span>
       </div>` : '';
  const refunded = order.paymentStatus === 'refunded'
    ? `<p style="font-size:14px;color:#374151">Te reembolsamos <strong>${fmt(order.total)}</strong> a tu tarjeta. Según tu banco, puede tardar de 5 a 10 días hábiles en reflejarse.</p>` : '';
  const body = `
    <p>Hola <strong>${esc(order.userName)}</strong>,</p>
    <p>El estado de tu pedido <strong>#${order.id}</strong> cambio a:</p>
    <div style="background:#eaf5ee;border-radius:4px;padding:18px;text-align:center;font-size:18px;font-weight:700;color:#1a5c2e;margin:18px 0">${labels[order.status] || esc(order.status)}</div>
    ${tracking}${refunded}
    <p style="font-size:14px;color:#6b7280">Total del pedido: <strong>${fmt(order.total)}</strong></p>
    <p style="margin-top:24px"><a href="${PUBLIC_URL}/mis-pedidos.html" style="display:inline-block;background:#1a5c2e;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:1px;text-transform:uppercase">Ver mi pedido</a></p>
  `;
  return send({
    to: order.userEmail,
    subject: `Tu pedido #${order.id} ahora esta: ${labels[order.status] || order.status}`,
    html: shell(`Actualizacion de pedido`, body),
    text: `Tu pedido ${order.id} cambio a ${order.status}.`,
  });
}

async function sendPasswordReset({ to, name, resetUrl }) {
  const body = `
    <p>Hola <strong>${esc(name || '')}</strong>,</p>
    <p>Recibimos una solicitud para restablecer la contrasena de tu cuenta en Fajas Maydel.</p>
    <p style="margin:24px 0;text-align:center"><a href="${resetUrl}" style="display:inline-block;background:#1a5c2e;color:#fff;padding:14px 32px;border-radius:4px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:1px;text-transform:uppercase">Restablecer contrasena</a></p>
    <p style="font-size:13px;color:#6b7280">Este enlace expira en 1 hora. Si tu no solicitaste este cambio, puedes ignorar este correo y tu contrasena seguira igual.</p>
    <p style="font-size:12px;color:#9ca3af;margin-top:18px;word-break:break-all">Si el boton no funciona, copia y pega esta direccion en tu navegador:<br>${resetUrl}</p>
  `;
  return send({
    to,
    subject: 'Restablece tu contrasena - Fajas Maydel',
    html: shell('Recuperacion de contrasena', body),
    text: `Restablece tu contrasena: ${resetUrl} (expira en 1 hora)`,
  });
}

module.exports = { sendOrderToCustomer, sendOrderToAdmin, sendOrderStatusUpdate, sendOrderDelayUpdate, sendPasswordReset };
