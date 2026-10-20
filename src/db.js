import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDatabase } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'migrations', '001_init.sql');

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA wal_autocheckpoint = 1000;
  `);
  return db;
}

export function migrateSchema(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migrations = [
    { version: '001_init', file: '001_init.sql' },
    { version: '002_auth_refresh_tokens', file: '002_auth_refresh_tokens.sql' },
    { version: '003_audience_isolation', file: '003_audience_isolation.sql' },
    { version: '004_knowledge_category', file: '004_knowledge_category.sql' },
    { version: '005_is_insight', file: '005_is_insight.sql' },
    { version: '006_gpc_taxonomy', file: '006_gpc_taxonomy.sql' },
    { version: '007_knowledge_tenant_meta', file: '007_knowledge_tenant_meta.sql' }
  ];
  let changed = false;
  for (const migration of migrations) {
    const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
    if (applied) continue;
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', migration.file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
      db.exec('COMMIT');
      changed = true;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
  return changed;
}

export function tableCount(db, table) {
  const allowed = new Set(['tenants','users','sessions','sites','knowledge','conversations','messages','escalations','settings','glossary','events','test_runs']);
  if (!allowed.has(table)) throw new Error(`Unsafe table name: ${table}`);
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0);
}

export function isDatabaseEmpty(db) {
  const nonGlobalTenants = Number(db.prepare("SELECT COUNT(*) AS count FROM tenants WHERE id <> 'global'").get().count || 0);
  return nonGlobalTenants === 0
    && tableCount(db, 'users') === 0
    && tableCount(db, 'knowledge') === 0
    && tableCount(db, 'conversations') === 0;
}

export function initializeDatabase(db) {
  migrateSchema(db);
  if (isDatabaseEmpty(db)) {
    seedDatabase(db);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isBusy(error) {
  return /SQLITE_BUSY|database is locked/i.test(String(error?.message || error?.code || ''));
}

export function transaction(db, fn, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 8));
  const baseDelay = Math.max(1, Number(options.baseDelayMs || 15));
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      db.exec('BEGIN IMMEDIATE');
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      lastError = error;
      try { db.exec('ROLLBACK'); } catch {}
      if (!isBusy(error) || attempt === attempts - 1) throw error;
      sleepSync(baseDelay * (attempt + 1));
    }
  }
  throw lastError;
}

export function closeDatabase(db) {
  try { db.close(); } catch {}
}

export { seedDatabase } from './seed.js';
