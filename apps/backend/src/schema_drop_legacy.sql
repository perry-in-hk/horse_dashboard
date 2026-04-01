-- One-time cleanup: remove archived operational tables (no longer in schema.sql).
-- Safe to run repeatedly after tables are already gone.

DROP TABLE IF EXISTS results CASCADE;
DROP TABLE IF EXISTS race_entries CASCADE;
DROP TABLE IF EXISTS odds_snapshots CASCADE;
DROP TABLE IF EXISTS recommendations CASCADE;
DROP TABLE IF EXISTS races CASCADE;
DROP TABLE IF EXISTS horses CASCADE;
DROP TABLE IF EXISTS jockeys CASCADE;
DROP TABLE IF EXISTS trainers CASCADE;
DROP TABLE IF EXISTS ingestion_runs CASCADE;
