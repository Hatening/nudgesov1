import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dbPath = path.resolve(arg('--db', process.env.DB_PATH || path.join(process.cwd(), '.data', 'relaydesk.sqlite')));
const outPath = path.resolve(arg('--out', process.env.BACKUP_PATH || path.join(process.cwd(), 'artifacts', 'backups', `relaydesk-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)));
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const db = openDatabase(dbPath);
try {
  db.exec(`VACUUM INTO '${outPath.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const backup = new DatabaseSync(outPath);
try {
  const integrity = backup.prepare('PRAGMA integrity_check').get().integrity_check;
  const messages = Number(backup.prepare('SELECT COUNT(*) AS count FROM messages').get().count || 0);
  const escalations = Number(backup.prepare('SELECT COUNT(*) AS count FROM escalations').get().count || 0);
  const ok = integrity === 'ok';
  console.log(JSON.stringify({ ok, source: dbPath, backup: outPath, integrity, messages, escalations }, null, 2));
  process.exitCode = ok ? 0 : 1;
} finally {
  backup.close();
}
