#!/usr/bin/env node
/**
 * Ingest the official GS1 GPC JSON export into SQLite.
 *
 * The export is a 6-level tree:
 *   Level 1-4  Segment / Family / Class / Brick  -> one gpc_taxonomy row each
 *   Level 5    attribute type                     \
 *   Level 6    attribute value                     / folded into the parent Brick's attributes_json
 *
 * Levels 5/6 reuse their codes across Bricks, so only Levels 1-4 become rows and
 * the 8-digit code stays a valid primary key. The whole import runs in one
 * transaction (and clears the table children-first) so an interrupted run
 * leaves the previous taxonomy untouched.
 *
 * Usage:
 *   node scripts/ingest-gpc.mjs [--source <file|dir>] [--db <path>] [--batch-size 500] [--dry-run] [--quiet]
 *   GPC_JSON=... DB_PATH=... node scripts/ingest-gpc.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrateSchema, transaction, closeDatabase } from '../src/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const GPC_DEFAULT_SOURCE = path.resolve(
  ROOT,
  '..',
  'language_prompt',
  'GPC',
  'GPC as of May 2026 v20260520 GB.json'
);
export const DEFAULT_DB_PATH = path.join(ROOT, '.data', 'relaydesk.sqlite');
export const LEVEL_NAMES = Object.freeze(['Segment', 'Family', 'Class', 'Brick']);

// Children first: gpc_taxonomy.parent_code uses ON DELETE RESTRICT.
const CLEAR_LEVELS = ['Brick', 'Class', 'Family', 'Segment'];
const INSERT_SQL = `
  INSERT INTO gpc_taxonomy (
    code, level, level_num, parent_code, title, definition, definition_excludes,
    attributes_json, attribute_count, is_active, language
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function asCode(value, context) {
  const code = Number(value);
  if (!Number.isSafeInteger(code) || code < 10000000 || code > 99999999) {
    throw new Error(`${context}: expected an 8-digit GPC code, got ${JSON.stringify(value)}`);
  }
  return code;
}

function asTitle(value, context) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${context}: missing Title`);
  }
  return value.trim();
}

function asText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
}

function parseAttribute(node, brickCode) {
  const level = Number(node?.Level);
  if (level !== 5) {
    throw new Error(`Brick ${brickCode}: expected attribute Level 5 child, got Level ${node?.Level}`);
  }
  const code = asCode(node.Code, `Brick ${brickCode} attribute`);
  const values = (Array.isArray(node.Childs) ? node.Childs : []).map((valueNode) => {
    if (Number(valueNode?.Level) !== 6) {
      throw new Error(`Attribute ${code}: expected Level 6 value child, got Level ${valueNode?.Level}`);
    }
    return {
      code: asCode(valueNode.Code, `Attribute ${code} value`),
      title: asTitle(valueNode.Title, `Attribute ${code} value ${valueNode.Code}`)
    };
  });
  return {
    code,
    title: asTitle(node.Title, `Brick ${brickCode} attribute ${code}`),
    definition: asText(node.Definition),
    values
  };
}

/**
 * Pure parser: turns the GS1 JSON object into rows + counters.
 * Throws on malformed input; it never touches the database.
 */
export function parseGpc(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.Schema) || payload.Schema.length === 0) {
    throw new Error('GPC JSON must be an object with a non-empty "Schema" array');
  }

  const language = typeof payload.LanguageCode === 'string' && payload.LanguageCode.trim()
    ? payload.LanguageCode.trim().toLowerCase()
    : 'en';
  const sourceVersion = typeof payload.DateUtc === 'string' ? payload.DateUtc : null;
  const rows = [];
  const seenCodes = new Set();
  const levels = { Segment: 0, Family: 0, Class: 0, Brick: 0 };
  let bricksWithAttributes = 0;
  let attributeTypes = 0;
  let attributeValues = 0;
  let attributeJsonBytes = 0;

  function visit(node, parentRow) {
    if (!node || typeof node !== 'object') throw new Error('GPC node must be an object');

    const levelNum = Number(node.Level);
    const expectedLevel = parentRow ? parentRow.levelNum + 1 : 1;
    if (!Number.isInteger(levelNum) || levelNum !== expectedLevel || levelNum > 4) {
      throw new Error(`GPC node ${node.Code}: expected Level ${expectedLevel}, got Level ${node.Level}`);
    }

    const code = asCode(node.Code, `Level ${levelNum} node`);
    if (seenCodes.has(code)) throw new Error(`Duplicate GPC code ${code} in Levels 1-4`);
    seenCodes.add(code);

    const row = {
      code,
      level: LEVEL_NAMES[levelNum - 1],
      levelNum,
      parentCode: parentRow ? parentRow.code : null,
      title: asTitle(node.Title, `Level ${levelNum} node ${code}`),
      definition: asText(node.Definition),
      definitionExcludes: asText(node.DefinitionExcludes),
      attributesJson: '[]',
      attributeCount: 0,
      isActive: node.Active === false ? 0 : 1,
      language
    };

    if (levelNum === 4) {
      const attributes = (Array.isArray(node.Childs) ? node.Childs : [])
        .map((child) => parseAttribute(child, code));
      row.attributesJson = attributes.length > 0 ? JSON.stringify(attributes) : '[]';
      row.attributeCount = attributes.length;
      if (attributes.length > 0) bricksWithAttributes += 1;
      attributeTypes += attributes.length;
      attributeValues += attributes.reduce((total, attribute) => total + attribute.values.length, 0);
      attributeJsonBytes += Buffer.byteLength(row.attributesJson);
    }

    rows.push(row);
    levels[row.level] += 1;

    if (levelNum < 4) {
      for (const child of Array.isArray(node.Childs) ? node.Childs : []) visit(child, row);
    }
  }

  for (const segment of payload.Schema) visit(segment, null);

  return {
    language,
    sourceVersion,
    rows,
    stats: {
      levels,
      total: rows.length,
      bricksWithAttributes,
      attributeTypes,
      attributeValues,
      attributeJsonBytes
    }
  };
}

/** Accepts a JSON file or a directory containing the GPC .json export. */
export function resolveSourcePath(input = process.env.GPC_JSON || GPC_DEFAULT_SOURCE) {
  const candidate = path.resolve(input);
  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch {
    throw new Error(`GPC JSON not found: ${candidate}. Pass --source <file|dir> or set GPC_JSON.`);
  }
  if (!stat.isDirectory()) return candidate;

  const files = fs.readdirSync(candidate)
    .filter((name) => /\.json$/i.test(name) && !/\.jsonld$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) throw new Error(`No GPC .json file found in ${candidate}`);
  return path.join(candidate, files[files.length - 1]);
}

function normalizeBatchSize(value) {
  const size = Math.floor(Number(value));
  return Number.isFinite(size) && size > 0 ? Math.min(size, 5000) : 500;
}

/**
 * Parse the GPC export and write it to gpc_taxonomy.
 * Synchronous on purpose: the repository's other SQLite scripts are sync too.
 */
export function ingestGpc(options = {}) {
  const startedAt = Date.now();
  const sourcePath = resolveSourcePath(options.sourcePath ?? process.env.GPC_JSON ?? GPC_DEFAULT_SOURCE);
  const dbPath = path.resolve(options.dbPath ?? process.env.DB_PATH ?? DEFAULT_DB_PATH);
  const batchSize = normalizeBatchSize(options.batchSize ?? process.env.GPC_BATCH_SIZE ?? 500);
  const quiet = Boolean(options.quiet);
  const dryRun = Boolean(options.dryRun);

  const raw = fs.readFileSync(sourcePath, 'utf8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid GPC JSON at ${sourcePath}: ${error.message}`);
  }
  const parsed = parseGpc(payload);

  const base = {
    source: sourcePath,
    db: dbPath,
    language: parsed.language,
    sourceVersion: parsed.sourceVersion,
    levels: { ...parsed.stats.levels },
    total: parsed.stats.total,
    attributes: {
      bricksWithAttributes: parsed.stats.bricksWithAttributes,
      attributeTypes: parsed.stats.attributeTypes,
      attributeValues: parsed.stats.attributeValues,
      jsonBytes: parsed.stats.attributeJsonBytes
    }
  };

  if (dryRun) {
    return { ok: true, dryRun: true, ...base, elapsedMs: Date.now() - startedAt };
  }

  const db = openDatabase(dbPath);
  try {
    migrateSchema(db);
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gpc_taxonomy'").get();
    if (!table) throw new Error('gpc_taxonomy table is missing after migrations');

    const inserted = transaction(db, () => {
      // Children first, otherwise ON DELETE RESTRICT blocks the wipe.
      for (const level of CLEAR_LEVELS) {
        db.exec(`DELETE FROM gpc_taxonomy WHERE level = '${level}'`);
      }

      const insert = db.prepare(INSERT_SQL);
      for (let offset = 0; offset < parsed.rows.length; offset += batchSize) {
        const batch = parsed.rows.slice(offset, offset + batchSize);
        for (const row of batch) {
          insert.run(
            row.code,
            row.level,
            row.levelNum,
            row.parentCode,
            row.title,
            row.definition,
            row.definitionExcludes,
            row.attributesJson,
            row.attributeCount,
            row.isActive,
            row.language
          );
        }
        if (!quiet) {
          process.stderr.write(`gpc: ${Math.min(offset + batchSize, parsed.rows.length)}/${parsed.rows.length} rows\n`);
        }
      }

      const counts = {};
      for (const record of db.prepare('SELECT level, COUNT(*) AS count FROM gpc_taxonomy GROUP BY level').all()) {
        counts[record.level] = Number(record.count);
      }
      for (const level of LEVEL_NAMES) {
        if ((counts[level] || 0) !== parsed.stats.levels[level]) {
          throw new Error(`Row count mismatch for ${level}: expected ${parsed.stats.levels[level]}, got ${counts[level] || 0}`);
        }
      }

      const foreignKeyProblems = db.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyProblems.length > 0) {
        throw new Error(`Foreign key check failed for ${foreignKeyProblems.length} row(s)`);
      }
      return counts;
    }, { attempts: 12, baseDelayMs: 25 });

    const total = Number(db.prepare('SELECT COUNT(*) AS count FROM gpc_taxonomy').get().count);
    if (total !== parsed.stats.total) {
      throw new Error(`gpc_taxonomy has ${total} rows after ingest, expected ${parsed.stats.total}`);
    }
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error(`SQLite integrity_check failed: ${integrity}`);

    return { ok: true, ...base, levels: inserted, total, elapsedMs: Date.now() - startedAt };
  } finally {
    closeDatabase(db);
  }
}

function cliOptions(argv) {
  const args = argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  return {
    sourcePath: option('--source', process.env.GPC_JSON || GPC_DEFAULT_SOURCE),
    dbPath: option('--db', process.env.DB_PATH || DEFAULT_DB_PATH),
    batchSize: option('--batch-size', process.env.GPC_BATCH_SIZE || 500),
    dryRun: args.includes('--dry-run'),
    quiet: args.includes('--quiet')
  };
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    const summary = ingestGpc(cliOptions(process.argv));
    console.log('GPC_INGEST_OK');
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(`GPC_INGEST_FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
