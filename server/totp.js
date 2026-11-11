// Kody jednorazowe TOTP (RFC 6238: HMAC-SHA1, 30 s, 6 cyfr) – zgodne z Google Authenticator i podobnymi.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

/** Kod dla danego licznika (numeru 30-sekundowego okna). */
export function codeAt(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}

/**
 * Sprawdza kod z tolerancją ±1 okna. Zwraca numer okna, w którym kod pasuje, albo null.
 * lastCounter chroni przed ponownym użyciem tego samego kodu.
 */
export function verify(secret, code, { now = Date.now(), lastCounter = -1 } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const cur = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) {
    const counter = cur + d;
    if (counter <= lastCounter) continue;
    const want = codeAt(secret, counter);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return counter;
  }
  return null;
}

export const otpauthUrl = (secret, account, issuer = 'KumoDesk') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Dziesięć kodów zapasowych w postaci xxxx-xxxx. */
export const newRecoveryCodes = () => Array.from({ length: 10 }, () => { const h = crypto.randomBytes(4).toString('hex'); return `${h.slice(0, 4)}-${h.slice(4)}`; });
export const hashCode = (c) => crypto.createHash('sha256').update(String(c).toLowerCase().replace(/[^0-9a-f]/g, '')).digest('hex');
