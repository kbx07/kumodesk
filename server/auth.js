// Authentication: passwords (scrypt), sessions in an HttpOnly cookie, roles.
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
function sha(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

export const validUsername = (u) => /^[A-Za-z0-9._-]{3,32}$/.test(String(u || ''));
export const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;

const DEVICE = 'kd_device';
const DEVICE_TTL = 90 * 24 * 3600 * 1000;

function readCookie(req, name = COOKIE) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function setCookie(req, res, value, maxAgeSec, name = COOKIE) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const prev = res.getHeader('Set-Cookie');
  const line = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', prev ? [].concat(prev, line) : line);
}

/** "Remember this device": a separate cookie that makes the 2FA code unnecessary for 90 days. */
export function rememberDevice(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.trustDevice(sha(token), userId, String(req.headers['user-agent'] || '').slice(0, 120), DEVICE_TTL);
  setCookie(req, res, token, Math.floor(DEVICE_TTL / 1000), DEVICE);
}
export function deviceRemembered(req, userId) {
  const token = readCookie(req, DEVICE);
  return !!token && db.deviceTrusted(sha(token), userId);
}
export const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

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

// Brake on password guessing: after 8 failed attempts, a 5-minute pause (per address and username).
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

/** Requires a session for all of /api except the sign-in routes. */
export function requireAuth(req, res, next) {
  if (req.path.startsWith('/auth/')) return next();
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: db.countUsers() === 0 ? 'err.setupNeeded' : 'err.loginNeeded' });
  req.user = user;
  touch(user.id, req);
  // an account with mandatory two-factor authentication that is not enabled yet: setup only
  if (user.twofa.required && !user.twofa.enabled && req.path !== '/status') return res.status(403).json({ error: 'err.twofaRequired' });
  next();
}
export function requireSuper(req, res, next) {
  if (!req.user?.super) return res.status(403).json({ error: 'err.superOnly' });
  next();
}

// ---------- presence: who is using the app right now, and on what ----------
const ONLINE_MS = 3 * 60 * 1000;
const seen = new Map(); // `${userId}|${device}` -> time of the last request
/** Short device label from the User-Agent header, e.g. "Chrome · Windows". */
export function deviceLabel(ua) {
  const s = String(ua || '');
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return [br, os].filter(Boolean).join(' · ') || 'unknown';
}
function touch(userId, req) {
  const now = Date.now();
  seen.set(`${userId}|${deviceLabel(req.headers['user-agent'])}`, now);
  if (seen.size > 5000) for (const [k, at] of seen) if (now - at > 86400000) seen.delete(k);
}
/** { online, devices, lastSeen } for a user; kept in memory, so it starts empty after a restart. */
export function presence(userId, now = Date.now()) {
  const devices = []; let last = 0;
  for (const [k, at] of seen) {
    const i = k.indexOf('|');
    if (Number(k.slice(0, i)) !== userId) continue;
    if (at > last) last = at;
    if (now - at < ONLINE_MS) devices.push(k.slice(i + 1));
  }
  return { online: devices.length > 0, devices, lastSeen: last ? new Date(last).toISOString() : null };
}
export const forgetPresence = (userId) => { for (const k of seen.keys()) if (k.startsWith(`${userId}|`)) seen.delete(k); };

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'err.adminOnly' });
  next();
}
