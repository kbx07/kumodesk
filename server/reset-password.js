// Awaryjna zmiana hasła z wiersza poleceń:  node server/reset-password.js <login> <nowe-haslo>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import { hashPassword, validPassword } from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [username, password] = process.argv.slice(2);
if (!username || !validPassword(password)) { console.error('Usage: node server/reset-password.js <username> <new-password (min. 8 characters)>'); process.exit(1); }
db.openDb(path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'kumodesk.db'));
const u = db.getUserAuth(username);
if (!u) { console.error(`No such user: ${username}. Users: ${db.listUsers().map((x) => x.username).join(', ') || '(none)'}`); process.exit(1); }
db.updateUser(u.id, { pass_hash: hashPassword(password) });
console.log(`Password changed for ${u.username}. All sessions of this user were signed out.`);
