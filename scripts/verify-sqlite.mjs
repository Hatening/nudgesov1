import path from 'node:path';
import { openDatabase, tableCount } from '../src/db.js';

const arg = (name, fallback) => {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const dbPath = path.resolve(arg('--db', process.env.DB_PATH || path.join(process.cwd(), '.data', 'relaydesk.sqlite')));
const db = openDatabase(dbPath);
try {
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  const journal = db.prepare('PRAGMA journal_mode').get().journal_mode;
  const foreignKeys = Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys);
  const counts = {};
  for (const table of ['tenants', 'users', 'sessions', 'sites', 'knowledge', 'conversations', 'messages', 'escalations', 'glossary', 'events', 'test_runs']) {
    counts[table] = tableCount(db, table);
  }
  const ok = integrity === 'ok' && journal === 'wal' && foreignKeys === 1;
  console.log(JSON.stringify({ ok, db: dbPath, integrity, journal_mode: journal, foreign_keys: foreignKeys, counts }, null, 2));
  process.exit(ok ? 0 : 1);
} finally {
  db.close();
}
