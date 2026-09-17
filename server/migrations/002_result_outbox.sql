BEGIN;
-- Durable, server-only completion journal. It contains one outcome per match,
-- never physics snapshots. Rating/history/result commit removes the row.
CREATE TABLE IF NOT EXISTS arena.pending_results (
  match_id uuid PRIMARY KEY REFERENCES arena.matches(id),
  outcome jsonb NOT NULL CHECK (jsonb_typeof(outcome) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pending_results_recorded ON arena.pending_results(recorded_at, match_id);
CREATE UNIQUE INDEX IF NOT EXISTS roster_account_once ON arena.roster(match_id,player_id) WHERE player_id IS NOT NULL;
ALTER TABLE arena.pending_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena.schema_version ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arena.pending_results FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON arena.pending_results FROM anon; END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON arena.pending_results FROM authenticated; END IF;
END $$;
INSERT INTO arena.schema_version(version) VALUES(2) ON CONFLICT DO NOTHING;
COMMIT;
