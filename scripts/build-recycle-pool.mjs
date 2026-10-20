#!/usr/bin/env node
/**
 * Build the recycle pool from rejected knowledge JSONL files.
 *
 * The pool is intentionally read-only with respect to the app database:
 * it only discovers `*reject*.jsonl` files, normalizes their provenance and
 * rejection reason, and writes `raw_data/recycle_pool.jsonl` + stats.
 * It never calls an LLM or a cloud API.
 *
 * Usage:
 *   node scripts/build-recycle-pool.mjs
 *   node scripts/build-recycle-pool.mjs --root . --out raw_data/recycle_pool.jsonl
 *   node scripts/build-recycle-pool.mjs --input db/seed/knowledge.rejected.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const inputArgs = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--input' && args[index + 1]) inputArgs.push(args[index + 1]);
}

const scanRoot = path.resolve(option('--root', ROOT));
const outputPath = path.resolve(option('--out', path.join(ROOT, 'raw_data', 'recycle_pool.jsonl')));
const statsPath = outputPath.replace(/\.jsonl$/i, '.stats.json');

// Avoid walking huge datasets that cannot contain rejected cards.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.data', '.hf-cache',
  'WixQA-full', 'massive', 'mtop', 'multiwoz', 'clinc150'
]);
const REASON_ORDER = ['number', 'url', 'entity', 'other'];

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.isFile() && /\.jsonl$/i.test(entry.name) && /reject/i.test(entry.name)) {
      files.push(full);
    }
  }
}

function sourceTypeOf(row) {
  if (row && typeof row.source_type === 'string' && row.source_type.trim()) return row.source_type.trim();
  const source = String(row?.source || row?.source_file || '');
  if (/wixqa/i.test(source)) return 'wixqa';
  if (/ecommerce-ai-skills/i.test(source)) return 'ecommerce_ai_skills';
  if (/bitext/i.test(source)) return 'bitext';
  if (/webfaq|traveling/i.test(source)) return 'webfaq';
  if (/seller_extra/i.test(source)) return 'public_web';
  return 'unknown';
}

function reasonOf(row) {
  return String(row?.reason || row?.reject_reason || row?.rejection || '').trim();
}

function reasonKinds(reason) {
  const parts = reason.split(/;\s*/).filter(Boolean);
  const kinds = new Set();
  for (const part of parts) {
    const match = part.match(/^([a-z_]+):/i);
    kinds.add(match ? match[1].toLowerCase() : 'other');
  }
  if (kinds.size === 0) kinds.add('other');
  return [...kinds].sort((left, right) => {
    const l = REASON_ORDER.indexOf(left);
    const r = REASON_ORDER.indexOf(right);
    return (l < 0 ? REASON_ORDER.length : l) - (r < 0 ? REASON_ORDER.length : r);
  });
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))));
}

function main() {
  const files = inputArgs.length > 0
    ? inputArgs.map((file) => path.resolve(file))
    : (() => {
        const found = [];
        walk(scanRoot, found);
        return found;
      })();

  const uniqueFiles = [...new Set(files)]
    .filter((file) => path.resolve(file) !== path.resolve(outputPath))
    .sort((left, right) => left.localeCompare(right));

  if (uniqueFiles.length === 0) {
    throw new Error(`No *reject*.jsonl files found under ${scanRoot}`);
  }

  const rows = [];
  const seen = new Set();
  const fileStats = [];
  let invalidLines = 0;
  let duplicatesRemoved = 0;

  for (const file of uniqueFiles) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/') || file;
    let lines;
    try {
      lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim());
    } catch (error) {
      fileStats.push({ path: relative, rows: 0, invalid: 0, error: error.message });
      continue;
    }

    let fileRows = 0;
    let fileInvalid = 0;
    for (const line of lines) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        fileInvalid += 1;
        invalidLines += 1;
        continue;
      }
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        fileInvalid += 1;
        invalidLines += 1;
        continue;
      }

      const source = String(row.source || row.source_file || row.dataset || 'unknown');
      const reason = reasonOf(row);
      const kinds = reasonKinds(reason);
      const normalized = {
        ...row,
        source_file: relative,
        source_type: sourceTypeOf(row),
        reject_reason: kinds.join('+'),
        reject_reason_kinds: kinds
      };
      const key = JSON.stringify([
        normalized.source_type,
        source,
        normalized.idx ?? null,
        normalized.question || normalized.title || '',
        reason
      ]);
      if (seen.has(key)) {
        duplicatesRemoved += 1;
        continue;
      }
      seen.add(key);
      rows.push(normalized);
      fileRows += 1;
    }
    fileStats.push({ path: relative, rows: fileRows, invalid: fileInvalid });
  }

  rows.sort((left, right) => (
    String(left.source_type).localeCompare(String(right.source_type))
    || String(left.source).localeCompare(String(right.source))
    || Number(left.idx ?? 0) - Number(right.idx ?? 0)
    || String(left.question || '').localeCompare(String(right.question || ''))
  ));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');

  const stats = {
    ok: true,
    generated_at: new Date().toISOString(),
    scan_root: scanRoot,
    output: path.relative(ROOT, outputPath).split(path.sep).join('/'),
    files: fileStats,
    total: rows.length,
    invalid_lines: invalidLines,
    duplicates_removed: duplicatesRemoved,
    by_source_type: countBy(rows.map((row) => row.source_type)),
    by_reject_reason: countBy(rows.map((row) => row.reject_reason)),
    by_reject_reason_records: countBy(rows.flatMap((row) => row.reject_reason_kinds)),
    by_source: countBy(rows.map((row) => row.source))
  };
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2) + '\n', 'utf8');

  console.log('RECYCLE_POOL_OK');
  console.log(JSON.stringify(stats, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`RECYCLE_POOL_FAILED: ${error.message}`);
  process.exitCode = 1;
}
