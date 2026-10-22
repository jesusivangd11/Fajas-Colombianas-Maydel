// Servicio de codigos OTP por SMS / WhatsApp.
//
// Funciona en "modo demo" por defecto: si no hay un proveedor configurado en .env,
// el codigo NO se envia de verdad, se muestra en la consola del servidor y el
// backend lo devuelve al navegador para que puedas probar el flujo completo.
//
// Para enviar mensajes REALES solo agrega las claves en .env y este archivo los usa
// automaticamente. Soporta dos proveedores:
//
//   Twilio (SMS + WhatsApp):
//     TWILIO_ACCOUNT_SID=ACxxxxxxxx
//     TWILIO_AUTH_TOKEN=xxxxxxxx
//     TWILIO_SMS_FROM=+1XXXXXXXXXX           (numero para SMS)
//     TWILIO_WHATSAPP_FROM=whatsapp:+14155238886  (numero de WhatsApp)
//
//   Meta WhatsApp Cloud API (solo WhatsApp):
//     WHATSAPP_CLOUD_TOKEN=xxxxxxxx
//     WHATSAPP_PHONE_NUMBER_ID=xxxxxxxx
//
// Mientras esas variables no existan, todo corre en modo demo, pero SOLO en
// desarrollo local. En producción el modo demo entregaría el código a cualquiera
// que sepa el teléfono de una clienta (robo de cuenta), así que ahí el canal
// simplemente no está disponible hasta que se configure un proveedor.

const DEFAULT_COUNTRY = process.env.OTP_DEFAULT_COUNTRY_CODE || '52'; // Mexico

// Deja el telefono solo en digitos. Si trae 10 digitos (numero local MX), le
// antepone el codigo de pais por defecto. Sirve para comparar y para enviar.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) d = DEFAULT_COUNTRY + d;        // 6141234567 -> 526141234567
  if (d.startsWith('00')) d = d.slice(2);              // 0052... -> 52...
  return d;
}

function toE164(phone) {
  const d = normalizePhone(phone);
  return d ? '+' + d : '';
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digitos
}

function providerConfigured(channel) {
  const hasTwilioSms      = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM;
  const hasTwilioWa       = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM;
  const hasMetaWa         = process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (channel === 'sms')      return !!hasTwilioSms;
  if (channel === 'whatsapp') return !!(hasTwilioWa || hasMetaWa);
  return false;
}

// Modo demo (mostrar el código en pantalla) solo fuera de producción.
function demoAllowed() {
  return process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
}

// ¿Se puede ofrecer este canal a la clienta? (proveedor real o demo local)
function channelAvailable(channel) {
  return providerConfigured(channel) || demoAllowed();
}

const MESSAGE = code =>
  `Fajas Colombianas Maydel: tu codigo de verificacion es ${code}. Expira en 10 minutos. No lo compartas con nadie.`;

async function sendViaTwilio({ phone, code, channel }) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const to    = channel === 'whatsapp' ? `whatsapp:${toE164(phone)}` : toE164(phone);
  const from  = channel === 'whatsapp' ? process.env.TWILIO_WHATSAPP_FROM : process.env.TWILIO_SMS_FROM;

  const body = new URLSearchParams({ To: to, From: from, Body: MESSAGE(code) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
  return { provider: 'twilio' };
}

async function sendViaMetaWhatsApp({ phone, code }) {
  const token   = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizePhone(phone),
      type: 'text',
      text: { body: MESSAGE(code) },
    }),
  });
  if (!res.ok) throw new Error(`Meta WhatsApp ${res.status}: ${await res.text()}`);
  return { provider: 'meta' };
}

// Envia el codigo. Devuelve { simulated: true } si no hay proveedor configurado.
async function sendCode({ phone, code, channel }) {
  if (!providerConfigured(channel)) {
    if (!demoAllowed()) throw new Error('Sin proveedor de mensajería para ' + channel);
    console.log('\n========== OTP (modo demo, sin proveedor) ==========');
    console.log('Canal :', channel.toUpperCase());
    console.log('Para  :', toE164(phone));
    console.log('Codigo:', code);
    console.log('====================================================\n');
    return { simulated: true };
  }
  try {
    if (channel === 'whatsapp' && process.env.WHATSAPP_CLOUD_TOKEN && !process.env.TWILIO_WHATSAPP_FROM) {
      return await sendViaMetaWhatsApp({ phone, code });
    }
    return await sendViaTwilio({ phone, code, channel });
  } catch (err) {
    console.error('[otp] Error enviando codigo:', err.message);
    throw err;
  }
}

module.exports = { normalizePhone, toE164, generateCode, sendCode, providerConfigured, channelAvailable, demoAllowed };
