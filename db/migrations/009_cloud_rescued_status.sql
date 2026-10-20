-- 008_cloud_rescued_status.sql
-- KB rescue: allow the new review_status value `cloud-rescued`.
--
-- SQLite cannot alter a CHECK constraint in place. Add a replacement column,
-- copy the existing values, drop the old column and rename the replacement.
-- The replacement column intentionally has no CHECK: review_status is a
-- workflow label owned by the app/merge script, and future rescue/audit states
-- must not require a table rebuild.

ALTER TABLE knowledge ADD COLUMN review_status_v2 TEXT NOT NULL DEFAULT 'candidate';
UPDATE knowledge SET review_status_v2 = review_status;
ALTER TABLE knowledge DROP COLUMN review_status;
ALTER TABLE knowledge RENAME COLUMN review_status_v2 TO review_status;
