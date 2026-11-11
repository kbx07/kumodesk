// Logowanie: hasła (scrypt), sesje w ciasteczku HttpOnly, role.
import crypto from 'node:crypto';
import * as db from './db.js';

const COOKIE = 'kd_session';
const TTL = 30 * 24 * 3600 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [alg, saltHex, keyHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(keyHex, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export const validUsername = (u) => /^[A-Za-z0-9._-]{3,32}$/.test(String(u || ''));
export const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}
function setCookie(req, res, value, maxAgeSec) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}

export function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.createSession(sha(token), userId, TTL);
  setCookie(req, res, token, Math.floor(TTL / 1000));
}
export function endSession(req, res) {
  const token = readCookie(req);
  if (token) db.deleteSession(sha(token));
  setCookie(req, res, '', 0);
}
export function currentUser(req) {
  const token = readCookie(req);
  return token ? db.sessionUser(sha(token)) : null;
}

// Hamulec na zgadywanie haseł: po 8 nieudanych próbach 5 minut przerwy (na adres i login).
const fails = new Map();
export function loginAllowed(key) {
  const f = fails.get(key);
  return !f || f.n < 8 || Date.now() - f.at > 5 * 60 * 1000;
}
export function loginFailed(key) {
  const f = fails.get(key);
  if (!f || Date.now() - f.at > 5 * 60 * 1000) fails.set(key, { n: 1, at: Date.now() });
  else { f.n++; f.at = Date.now(); }
  if (fails.size > 5000) fails.clear();
}
export const loginOk = (key) => fails.delete(key);

/** Wymaga zalogowania dla całego /api poza trasami logowania. */
export function requireAuth(req, res, next) {
  if (req.path.startsWith('/auth/')) return next();
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: db.countUsers() === 0 ? 'err.setupNeeded' : 'err.loginNeeded' });
  req.user = user;
  next();
}
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'err.adminOnly' });
  next();
}
