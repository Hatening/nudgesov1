import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, closeDatabase } from '../src/db.js';
import { ingestGpc, GPC_DEFAULT_SOURCE } from '../scripts/ingest-gpc.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveDbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(root, '.data', 'relaydesk.sqlite');
const realSourcePath = process.env.GPC_JSON ? path.resolve(process.env.GPC_JSON) : GPC_DEFAULT_SOURCE;

function fixturePayload() {
  return {
    LanguageCode: 'EN',
    DateUtc: '20/5/2026',
    Schema: [
      {
        Level: 1,
        Code: 67000000,
        Title: 'Clothing',
        Definition: 'Clothing segment definition.',
        DefinitionExcludes: null,
        Active: true,
        Childs: [{
          Level: 2,
          Code: 67010000,
          Title: 'Clothing',
          Definition: '',
          DefinitionExcludes: null,
          Active: true,
          Childs: [{
            Level: 3,
            Code: 67010100,
            Title: 'Clothing Accessories',
            Definition: 'Accessories definition.',
            DefinitionExcludes: null,
            Active: true,
            Childs: [{
              Level: 4,
              Code: 10001354,
              Title: 'Clothing Accessories Variety Packs',
              Definition: 'Variety packs definition.',
              DefinitionExcludes: 'Excludes single accessories.',
              Active: true,
              Childs: [{
                Level: 5,
                Code: 20000217,
                Title: 'Colour',
                Definition: 'Colour of the product.',
                Childs: [
                  { Level: 6, Code: 30015369, Title: 'BLUE' },
                  { Level: 6, Code: 30001173, Title: 'GREEN' }
                ]
              }]
            }]
          }]
        }]
      },
      {
        Level: 1,
        Code: 50000000,
        Title: 'Food/Beverage',
        Definition: null,
        DefinitionExcludes: null,
        Active: true,
        Childs: [{
          Level: 2,
          Code: 50200000,
          Title: 'Beverages',
          Definition: null,
          Active: true,
          Childs: [{
            Level: 3,
            Code: 50202200,
            Title: 'Alcoholic Beverages',
            Definition: null,
            Active: true,
            Childs: [{
              Level: 4,
              Code: 10000275,
              Title: 'Wine - Sparkling',
              Definition: 'Sparkling wine definition.',
              DefinitionExcludes: null,
              Active: true,
              Childs: []
            }]
          }]
        }]
      }
    ]
  };
}

function ancestry(db, code) {
  return db.prepare(`
    WITH RECURSIVE ancestors(code, parent_code, level, level_num, title) AS (
      SELECT code, parent_code, level, level_num, title
      FROM gpc_taxonomy
      WHERE code = ?
      UNION ALL
      SELECT parent.code, parent.parent_code, parent.level, parent.level_num, parent.title
      FROM gpc_taxonomy AS parent
      JOIN ancestors AS child ON child.parent_code = parent.code
    )
    SELECT code, parent_code, level, level_num, title
    FROM ancestors
    ORDER BY level_num
  `).all(code).map((row) => ({ ...row }));
}

test('GPC ingest builds a 4-level taxonomy, folds attributes onto Bricks and is idempotent', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-gpc-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sourcePath = path.join(dir, 'gpc-fixture.json');
  const dbPath = path.join(dir, 'gpc-fixture.sqlite');
  await fs.writeFile(sourcePath, JSON.stringify(fixturePayload()), 'utf8');

  const first = ingestGpc({ sourcePath, dbPath, batchSize: 3, quiet: true });
  assert.equal(first.total, 8);
  assert.deepEqual(first.levels, { Segment: 2, Family: 2, Class: 2, Brick: 2 });
  assert.equal(first.attributes.bricksWithAttributes, 1);
  assert.equal(first.attributes.attributeTypes, 1);
  assert.equal(first.attributes.attributeValues, 2);

  let db = openDatabase(dbPath);
  try {
    const columns = db.prepare('PRAGMA table_info(gpc_taxonomy)').all().map((row) => row.name);
    for (const column of ['code', 'level', 'parent_code', 'title', 'definition', 'attributes_json']) {
      assert.ok(columns.includes(column), `gpc_taxonomy is missing column ${column}`);
    }
    assert.equal(String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase(), 'wal');
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    const byCode = new Map(
      db.prepare('SELECT * FROM gpc_taxonomy').all().map((row) => [row.code, { ...row }])
    );
    assert.equal(byCode.size, 8);
    assert.equal(byCode.get(67000000).parent_code, null);
    assert.equal(byCode.get(67000000).level, 'Segment');
    assert.equal(byCode.get(67000000).level_num, 1);
    assert.equal(byCode.get(10001354).parent_code, 67010100);
    assert.equal(byCode.get(10001354).level, 'Brick');
    assert.equal(byCode.get(10001354).level_num, 4);
    assert.equal(byCode.get(10001354).definition, 'Variety packs definition.');
    assert.equal(byCode.get(10001354).definition_excludes, 'Excludes single accessories.');
    assert.equal(byCode.get(10001354).attribute_count, 1);
    assert.equal(byCode.get(67010000).definition, null);
    assert.equal(byCode.get(10000275).attributes_json, '[]');
    assert.equal(byCode.get(10000275).attribute_count, 0);
    assert.equal(byCode.get(10001354).language, 'en');
    assert.equal(byCode.get(10001354).is_active, 1);

    assert.deepEqual(JSON.parse(byCode.get(10001354).attributes_json), [{
      code: 20000217,
      title: 'Colour',
      definition: 'Colour of the product.',
      values: [
        { code: 30015369, title: 'BLUE' },
        { code: 30001173, title: 'GREEN' }
      ]
    }]);

    const chain = ancestry(db, 10001354);
    assert.deepEqual(chain.map((row) => row.code), [67000000, 67010000, 67010100, 10001354]);
    assert.deepEqual(chain.map((row) => row.level), ['Segment', 'Family', 'Class', 'Brick']);
    assert.deepEqual(chain.map((row) => row.parent_code), [null, 67000000, 67010000, 67010100]);
  } finally {
    closeDatabase(db);
  }

  const second = ingestGpc({ sourcePath, dbPath, batchSize: 2, quiet: true });
  assert.equal(second.total, 8);

  db = openDatabase(dbPath);
  try {
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM gpc_taxonomy').get().count), 8);
    const migration = db.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = '006_gpc_taxonomy'").get();
    assert.equal(Number(migration.count), 1);
  } finally {
    closeDatabase(db);
  }

  const invalid = fixturePayload();
  invalid.Schema[0].Childs[0].Level = 3;
  await fs.writeFile(sourcePath, JSON.stringify(invalid), 'utf8');
  assert.throws(
    () => ingestGpc({ sourcePath, dbPath, quiet: true }),
    /expected Level 2/
  );

  db = openDatabase(dbPath);
  try {
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM gpc_taxonomy').get().count), 8);
  } finally {
    closeDatabase(db);
  }
});

test('GPC real dictionary: Clothing and Food/Beverage Bricks resolve through all four levels', async (t) => {
  if (!fsSync.existsSync(realSourcePath)) {
    t.skip(`GPC JSON not found: ${realSourcePath}`);
    return;
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-gpc-real-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'gpc-real.sqlite');

  const summary = ingestGpc({ sourcePath: realSourcePath, dbPath, batchSize: 500, quiet: true });
  assert.equal(summary.total, 6463);
  assert.deepEqual(summary.levels, { Segment: 45, Family: 162, Class: 938, Brick: 5318 });
  assert.equal(summary.attributes.bricksWithAttributes, 3663);
  assert.equal(summary.attributes.attributeTypes, 10188);
  assert.equal(summary.attributes.attributeValues, 184323);

  const db = openDatabase(dbPath);
  try {
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    const clothing = ancestry(db, 10001354);
    assert.deepEqual(clothing.map((row) => row.code), [67000000, 67010000, 67010100, 10001354]);
    assert.deepEqual(clothing.map((row) => row.title), [
      'Clothing',
      'Clothing',
      'Clothing Accessories',
      'Clothing Accessories Variety Packs'
    ]);
    assert.deepEqual(clothing.map((row) => row.level), ['Segment', 'Family', 'Class', 'Brick']);

    const wine = ancestry(db, 10000275);
    assert.deepEqual(wine.map((row) => row.code), [50000000, 50200000, 50202200, 10000275]);
    assert.deepEqual(wine.map((row) => row.level), ['Segment', 'Family', 'Class', 'Brick']);
    assert.equal(wine[0].title, 'Food/Beverage');
    assert.equal(wine[3].title, 'Wine - Sparkling');

    const wineRow = { ...db.prepare('SELECT * FROM gpc_taxonomy WHERE code = ?').get(10000275) };
    assert.equal(wineRow.attribute_count, 14);
    const attributes = JSON.parse(wineRow.attributes_json);
    const colour = attributes.find((attribute) => attribute.title === 'Colour of Wine');
    assert.ok(colour, 'Colour of Wine attribute is present on the Wine - Sparkling Brick');
    for (const expected of ['BLUE', 'GREEN', 'ORANGE']) {
      assert.ok(colour.values.some((value) => value.title === expected), `Colour of Wine has value ${expected}`);
    }

    const clothingBricks = db.prepare(
      "SELECT code, title FROM gpc_taxonomy WHERE level = 'Brick' AND title LIKE '%Clothing%' ORDER BY code LIMIT 5"
    ).all();
    assert.ok(clothingBricks.length > 0);

    const badLevel = db.prepare(`
      SELECT COUNT(*) AS count
      FROM gpc_taxonomy AS child
      JOIN gpc_taxonomy AS parent ON parent.code = child.parent_code
      WHERE child.level_num <> parent.level_num + 1
    `).get();
    assert.equal(Number(badLevel.count), 0);

    const orphans = db.prepare(
      "SELECT COUNT(*) AS count FROM gpc_taxonomy WHERE level <> 'Segment' AND parent_code IS NULL"
    ).get();
    assert.equal(Number(orphans.count), 0);
  } finally {
    closeDatabase(db);
  }
});

test('GPC live database has the ingested taxonomy available', (t) => {
  if (!fsSync.existsSync(liveDbPath)) {
    t.skip(`live database not found: ${liveDbPath}`);
    return;
  }

  const db = new DatabaseSync(liveDbPath, { readOnly: true });
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gpc_taxonomy'").get();
    if (!table) {
      t.skip('gpc_taxonomy has not been ingested into the live database yet');
      return;
    }
    const total = Number(db.prepare('SELECT COUNT(*) AS count FROM gpc_taxonomy').get().count);
    if (total === 0) {
      t.skip('gpc_taxonomy is empty in the live database');
      return;
    }
    assert.equal(total, 6463);
    const clothing = ancestry(db, 10001354);
    assert.deepEqual(clothing.map((row) => row.code), [67000000, 67010000, 67010100, 10001354]);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});
