const TOKEN  = process.env.TELEGRAM_BOT_TOKEN || '';
const CHATID = process.env.TELEGRAM_CHAT_ID   || '';

async function sendTelegram(text) {
  if (!TOKEN || !CHATID || TOKEN.startsWith('CAMBIAR')) return { skipped: true };
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHATID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    return await r.json();
  } catch (err) {
    console.error('[telegram] error:', err.message);
    return { error: err.message };
  }
}

const fmt = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n || 0));

// Escapa texto del cliente para el parse_mode HTML de Telegram.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Aviso al admin. Pedidos por WhatsApp: al crearse. Pedidos con tarjeta: cuando
   Stripe confirma el pago (order.paymentStatus === 'paid'), para no avisar de
   carritos que nunca se pagaron. */
function notifyNewOrder(order) {
  const paid = order.paymentStatus === 'paid';
  const ship = order.shippingInfo || {};
  const itemList = (order.items || []).slice(0, 6)
    .map(i => `• ${esc(i.productName)}${[i.size, i.color].filter(Boolean).length ? ` (${esc([i.size, i.color].filter(Boolean).join(' / '))})` : ''} x${i.qty}`).join('\n');
  const more = (order.items || []).length > 6 ? `\n... +${order.items.length - 6} mas` : '';
  const address = [ship.address, ship.city, order.shippingState].filter(Boolean).map(esc).join(', ');
  const text =
    (paid ? `💰 <b>VENTA PAGADA</b> #${order.id}\n\n` : `🛍️ <b>NUEVO PEDIDO</b> #${order.id}\n\n`) +
    `👤 ${esc(order.userName)}\n` +
    `✉️ ${esc(order.userEmail || '-')}\n` +
    `📱 ${esc(ship.phone || '-')}\n` +
    `📍 ${address || '-'}\n` +
    (order.notes ? `📝 ${esc(order.notes)}\n` : '') +
    `💳 ${order.paymentMethod === 'stripe' ? 'Tarjeta (Stripe)' : 'WhatsApp'} — ${paid ? 'PAGADO ✅' : 'pendiente de pago'}\n\n` +
    `${itemList}${more}\n\n` +
    `Subtotal: ${fmt(order.subtotal)}\n` +
    (order.discountAmount ? `Descuento (${order.couponCode}): -${fmt(order.discountAmount)}\n` : '') +
    `Envio: ${order.shippingCost ? fmt(order.shippingCost) : 'GRATIS'}${order.couponCode ? ` · cupón ${order.couponCode}` : ''}\n` +
    `<b>TOTAL: ${fmt(order.total)}</b>`;
  return sendTelegram(text);
}

module.exports = { notifyNewOrder, sendTelegram };
