-- GS1 GPC taxonomy foundation: Segment / Family / Class / Brick.
--
-- The official GPC JSON export also nests Level 5 (attribute type) and Level 6
-- (attribute value) nodes under each Brick. Those two levels reuse their codes
-- across Bricks, so they are folded into gpc_taxonomy.attributes_json by
-- scripts/ingest-gpc.mjs instead of becoming rows of this table.
-- Only Levels 1-4 are stored here, which keeps `code` globally unique.

CREATE TABLE IF NOT EXISTS gpc_taxonomy (
  code                INTEGER PRIMARY KEY,                 -- GS1 GPC 8-digit code, e.g. 10001354
  level               TEXT    NOT NULL
                              CHECK (level IN ('Segment', 'Family', 'Class', 'Brick')),
  level_num           INTEGER NOT NULL CHECK (level_num BETWEEN 1 AND 4),
  parent_code         INTEGER REFERENCES gpc_taxonomy(code) ON DELETE RESTRICT,
  title               TEXT    NOT NULL,                    -- title in the source language (EN for this export)
  definition          TEXT,                                -- GS1 definition, may be absent
  definition_excludes TEXT,                                -- GS1 "excludes" note, may be absent
  attributes_json     TEXT    NOT NULL DEFAULT '[]'
                              CHECK (json_valid(attributes_json)),
  attribute_count     INTEGER NOT NULL DEFAULT 0 CHECK (attribute_count >= 0),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  language            TEXT    NOT NULL DEFAULT 'en',
  -- The level and the parent pointer must agree: Segment has no parent,
  -- every other level has one and sits exactly one level below it.
  CHECK (
       (level = 'Segment' AND parent_code IS NULL     AND level_num = 1)
    OR (level = 'Family'  AND parent_code IS NOT NULL AND level_num = 2)
    OR (level = 'Class'   AND parent_code IS NOT NULL AND level_num = 3)
    OR (level = 'Brick'   AND parent_code IS NOT NULL AND level_num = 4)
  )
);

CREATE INDEX IF NOT EXISTS idx_gpc_taxonomy_parent ON gpc_taxonomy(parent_code);
CREATE INDEX IF NOT EXISTS idx_gpc_taxonomy_level ON gpc_taxonomy(level, code);
CREATE INDEX IF NOT EXISTS idx_gpc_taxonomy_title ON gpc_taxonomy(title COLLATE NOCASE);
