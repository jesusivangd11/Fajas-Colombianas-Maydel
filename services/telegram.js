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

function notifyNewOrder(order) {
  const itemList = (order.items || []).slice(0, 6)
    .map(i => `• ${i.productName}${i.size ? ` (${i.size})` : ''} x${i.qty}`).join('\n');
  const more = (order.items || []).length > 6 ? `\n... +${order.items.length - 6} mas` : '';
  const text =
    `🛍️ <b>NUEVO PEDIDO</b> #${order.id}\n\n` +
    `👤 ${order.userName}\n` +
    `📱 ${order.shippingInfo?.phone || '-'}\n` +
    `📍 ${order.shippingState || '-'}\n` +
    `💳 ${order.paymentMethod === 'stripe' ? 'Stripe (en linea)' : 'WhatsApp'}\n\n` +
    `${itemList}${more}\n\n` +
    `Subtotal: ${fmt(order.subtotal)}\n` +
    (order.discountAmount ? `Descuento (${order.couponCode}): -${fmt(order.discountAmount)}\n` : '') +
    `Envio: ${order.shippingCost ? fmt(order.shippingCost) : 'GRATIS'}${order.couponCode ? ` · cupón ${order.couponCode}` : ''}\n` +
    `<b>TOTAL: ${fmt(order.total)}</b>`;
  return sendTelegram(text);
}

module.exports = { notifyNewOrder, sendTelegram };
