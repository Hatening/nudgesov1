#!/usr/bin/env node
/**
 * Export cloud-rescued knowledge rows from SQLite into the deploy seed.
 *
 * Output: db/seed/knowledge-rescued.jsonl
 *
 * Only rows with review_status='cloud-rescued' are exported. The file keeps
 * the approved-source fields and the local evidence proof so seed-kb can run
 * its runtime gate again on Render. It never exports site/demo/public_web rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dbPath = path.resolve(option('--db', process.env.DB_PATH || path.join(ROOT, '.data', 'relaydesk.sqlite')));
const outPath = path.resolve(option('--out', path.join(ROOT, 'db', 'seed', 'knowledge-rescued.jsonl')));
const allowed = new Set(['wixqa', 'ecommerce_ai_skills']);
const banned = /bitext|webfaq|traveling/i;

if (!fs.existsSync(dbPath)) throw new Error(`database not found: ${dbPath}`);

const db = new DatabaseSync(dbPath, { readOnly: true });
let rows;
try {
  rows = db.prepare(`
    SELECT id, title, content, language, tags_json, category, audience,
           sensitivity, freshness, source_type, source_id, source_url,
           review_status, evidence_json, is_insight
    FROM knowledge
    WHERE review_status = 'cloud-rescued'
    ORDER BY id
  `).all();
} finally {
  db.close();
}

const cards = [];
let skipped = 0;
const bySourceType = {};
for (const row of rows) {
  if (!row.id || !row.title || !row.content || !allowed.has(row.source_type) || !row.source_id) {
    skipped += 1;
    continue;
  }
  if (banned.test(`${row.source_type} ${row.source_id} ${row.source_url || ''}`)) {
    skipped += 1;
    continue;
  }
  let evidence;
  try {
    evidence = JSON.parse(row.evidence_json || '[]');
  } catch {
    skipped += 1;
    continue;
  }
  if (!Array.isArray(evidence) || evidence.length === 0) {
    skipped += 1;
    continue;
  }
  const validation = evidence[0]?.validation || { passed: true, missing: [] };
  if (validation.missing && validation.missing.length > 0) {
    skipped += 1;
    continue;
  }
  const tags = JSON.parse(row.tags_json || '[]');
  const card = {
    id: row.id,
    tenant_id: 'global',
    scope: 'global',
    title: row.title,
    type: 'qa',
    language: row.language || 'en',
    tags,
    content: row.content,
    audience: row.audience || 'seller',
    category: row.category || '其他',
    sensitivity: row.sensitivity || 'low',
    freshness: row.freshness || 'static',
    is_insight: Number(row.is_insight || 0),
    source_type: row.source_type,
    source_id: row.source_id,
    source_url: row.source_url || null,
    review_status: 'cloud-rescued',
    evidence_json: row.evidence_json,
    validation_json: JSON.stringify({
      checked: validation.checked || { urls: [], numbers: [], entities: [] },
      passed: validation.passed !== false,
      missing: []
    })
  };
  cards.push(card);
  bySourceType[row.source_type] = (bySourceType[row.source_type] || 0) + 1;
}

if (cards.length === 0) throw new Error('no cloud-rescued rows found');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const tmp = `${outPath}.tmp`;
fs.writeFileSync(tmp, cards.map((card) => JSON.stringify(card)).join('\n') + '\n', 'utf8');
fs.renameSync(tmp, outPath);
console.log(JSON.stringify({
  ok: true,
  db: dbPath,
  out: outPath,
  total: cards.length,
  skipped,
  by_source_type: bySourceType,
  bytes: fs.statSync(outPath).size
}, null, 2));
