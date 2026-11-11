// Version check against GitHub and self-update (git + npm, then a restart by systemd).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LATEST_URL = process.env.KUMODESK_UPDATE_URL || 'https://raw.githubusercontent.com/kbx07/kumodesk/main/package.json';
const CACHE_MS = 6 * 3600 * 1000;

export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/** Compares two versions such as "2.10.0" and "2.9.3": negative, zero or positive. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0), pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/**
 * How this installation is updated:
 *  self   – a git checkout run by systemd (the Proxmox / Debian install): the app can update itself,
 *  docker – a container image: pull the new image on the host,
 *  manual – anything else.
 */
export function updateMode() {
  if (fs.existsSync(path.join(ROOT, '.git')) && (process.env.INVOCATION_ID || process.env.KUMODESK_SELF_UPDATE === '1')) return 'self';
  return fs.existsSync('/.dockerenv') ? 'docker' : 'manual';
}

let cache = { latest: null, checked: null, error: null, at: 0 };
/** Latest published version (cached for a few hours unless forced). */
export async function checkLatest(force = false) {
  if (!force && cache.at && Date.now() - cache.at < CACHE_MS) return cache;
  try {
    const res = await fetch(LATEST_URL, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'kumodesk' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const v = String((await res.json()).version || '');
    if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('bad version');
    cache = { latest: v, checked: new Date().toISOString(), error: null, at: Date.now() };
  } catch (e) {
    cache = { ...cache, error: String(e.message || e).slice(0, 200), at: Date.now() };
  }
  return cache;
}

export const updateState = { running: false, step: null, error: null, done: false };

/** Downloads the new code, installs dependencies and exits so that systemd starts the new version. */
export async function runUpdate({ exit = (code) => process.exit(code) } = {}) {
  if (updateState.running) throw new Error('err.updateBusy');
  if (updateMode() !== 'self') throw new Error('err.updateManual');
  Object.assign(updateState, { running: true, step: 'fetch', error: null, done: false });
  const opts = { cwd: ROOT, timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 };
  try {
    const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts)).stdout.trim() || 'main';
    await run('git', ['fetch', '-q', 'origin', branch], opts);
    await run('git', ['reset', '-q', '--hard', `origin/${branch}`], opts);
    updateState.step = 'install';
    await run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], opts);
    Object.assign(updateState, { step: 'restart', done: true });
    cache.at = 0;
    // a non-zero exit makes systemd (Restart=on-failure) start the service again with the new code
    setTimeout(() => exit(75), 1500);
  } catch (e) {
    Object.assign(updateState, { running: false, error: String(e.stderr || e.message || e).trim().slice(-400) });
    throw e;
  }
}
