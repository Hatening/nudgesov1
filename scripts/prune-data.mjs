import path from 'node:path';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';

const arg = (name, fallback) => {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const dbPath = path.resolve(arg('--db', process.env.DB_PATH || path.join(process.cwd(), '.data', 'relaydesk.sqlite')));
const db = openDatabase(dbPath);
try {
  migrateSchema(db);
  const dao = createDao(db);
  const days = Number(arg('--days', process.env.PRIVACY_RETENTION_DAYS || dao.getSettings().privacyRetentionDays || 365));
  const result = dao.purgeExpiredData({ days });
  console.log(JSON.stringify({ ok: true, db: dbPath, days, ...result }, null, 2));
} finally {
  closeDatabase(db);
}
