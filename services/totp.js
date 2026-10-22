/* =============================================================================
   Verificación en dos pasos (TOTP, RFC 6238) · Google Authenticator, Microsoft
   Authenticator, Authy... Cada 30 s la app muestra un código de 6 dígitos que
   sale de un secreto compartido; aquí se calcula el mismo y se comparan.

   El secreto se guarda CIFRADO (AES-256-GCM) con una llave derivada de
   JWT_SECRET: quien lea la tabla users no puede generar códigos. Ojo: si algún
   día se cambia JWT_SECRET, los secretos guardados ya no se pueden leer y hay que
   volver a activar la verificación (ver db/reset_2fa.js).
   ============================================================================= */
const crypto = require('crypto');

const ISSUER = 'Fajas Maydel';
const STEP_SECONDS = 30;
const DIGITS = 6;
const BACKUP_CODES = 8;

// ── Base32 (el formato en que las apps esperan el secreto) ─────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// ── Cifrado del secreto en la BD ───────────────────────────────────────────
const key = () => crypto.createHash('sha256').update('totp|' + (process.env.JWT_SECRET || '')).digest();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
function decrypt(blob) {
  const [iv, tag, data] = String(blob).split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// ── Códigos ────────────────────────────────────────────────────────────────
function generateSecret() { return base32Encode(crypto.randomBytes(20)); }

function codeAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const n = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, '0');
}

const currentStep = () => Math.floor(Date.now() / 1000 / STEP_SECONDS);

/* Comprueba un código aceptando ±1 paso (el reloj del celular puede ir unos
   segundos adelantado o atrasado). Devuelve el paso que coincidió, o null.
   `lastStep` es el último paso ya usado: un código no se acepta dos veces. */
function verify(secret, code, lastStep = 0) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = currentStep();
  for (const step of [now - 1, now, now + 1]) {
    if (step <= Number(lastStep || 0)) continue;
    const expected = codeAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

function otpauthUrl(secret, account) {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ── Códigos de respaldo (si se pierde el celular) ──────────────────────────
// Se muestran UNA vez; en la BD solo queda su huella. Formato: 4821-7730.
const hashBackup = c => crypto.createHash('sha256').update(String(c).replace(/[^0-9]/g, '')).digest('hex');
function generateBackupCodes() {
  const codes = Array.from({ length: BACKUP_CODES }, () => {
    const n = crypto.randomInt(0, 1e8).toString().padStart(8, '0');
    return n.slice(0, 4) + '-' + n.slice(4);
  });
  return { codes, hashes: codes.map(hashBackup) };
}
// Devuelve la lista de huellas sin el código usado, o null si no coincide.
function useBackupCode(hashes, code) {
  const digits = String(code || '').replace(/[^0-9]/g, '');
  if (digits.length !== 8) return null;
  const h = hashBackup(digits);
  const list = Array.isArray(hashes) ? hashes : [];
  if (!list.includes(h)) return null;
  return list.filter(x => x !== h);
}

module.exports = {
  generateSecret, verify, otpauthUrl, encrypt, decrypt, codeAt, currentStep,
  generateBackupCodes, useBackupCode,
};
