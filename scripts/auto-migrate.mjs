import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDatabase, migrateSchema, isDatabaseEmpty, closeDatabase } from '../src/db.js';

const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), '.data'));
const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, 'relaydesk.sqlite'));
const jsonPath = path.resolve(process.env.JSON_PATH || path.join(dataDir, 'store.json'));

if (!fs.existsSync(jsonPath)) {
  console.log('auto-migrate: no legacy store.json; using SQLite seed path');
  process.exit(0);
}

const db = openDatabase(dbPath);
migrateSchema(db);
const empty = isDatabaseEmpty(db);
closeDatabase(db);

if (!empty) {
  console.log('auto-migrate: SQLite already contains data; skipping legacy import');
  process.exit(0);
}

console.log(`auto-migrate: empty SQLite + legacy store.json found; importing ${jsonPath}`);
const result = spawnSync(process.execPath, [
  path.join(process.cwd(), 'scripts', 'migrate-json-to-sqlite.mjs'),
  '--source', jsonPath,
  '--db', dbPath
], { stdio: 'inherit' });

if (result.error) {
  console.error(`auto-migrate: failed to start migration: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`auto-migrate: migration exited with ${result.status}`);
  process.exit(result.status || 1);
}
console.log('auto-migrate: legacy data imported successfully');
