BEGIN;
CREATE SCHEMA IF NOT EXISTS arena;
REVOKE ALL ON SCHEMA arena FROM PUBLIC;
CREATE TABLE IF NOT EXISTS arena.schema_version (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS arena.seasons (
  id text PRIMARY KEY, config_version text NOT NULL, config jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arena.profiles (
  id uuid PRIMARY KEY, display_name varchar(24) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arena.ratings (
  player_id uuid NOT NULL REFERENCES arena.profiles(id), season_id text NOT NULL REFERENCES arena.seasons(id),
  playlist smallint NOT NULL CHECK (playlist BETWEEN 1 AND 3), mode text NOT NULL CHECK (mode IN ('casual','ranked')),
  mu double precision NOT NULL CHECK (mu >= 0 AND mu < 1000000),
  uncertainty double precision NOT NULL CHECK (uncertainty > 0 AND uncertainty < 1000000), games integer NOT NULL CHECK (games >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(player_id, season_id, playlist, mode)
);
CREATE TABLE IF NOT EXISTS arena.matches (
  id uuid PRIMARY KEY, server_id uuid NOT NULL, season_id text NOT NULL REFERENCES arena.seasons(id), config_version text NOT NULL,
  playlist smallint NOT NULL CHECK (playlist BETWEEN 1 AND 3), mode text NOT NULL CHECK (mode IN ('casual','ranked')),
  region text NOT NULL, private boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('reserved','active','completed','cancelled')),
  result jsonb, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS arena.roster (
  match_id uuid NOT NULL REFERENCES arena.matches(id), slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 5),
  identity text NOT NULL, player_id uuid REFERENCES arena.profiles(id), team smallint NOT NULL CHECK (team IN (0,1)),
  display_name varchar(24) NOT NULL, visual text NOT NULL, is_test boolean NOT NULL DEFAULT false,
  PRIMARY KEY(match_id, slot), UNIQUE(match_id, identity)
);
CREATE TABLE IF NOT EXISTS arena.rating_history (
  match_id uuid NOT NULL REFERENCES arena.matches(id), player_id uuid NOT NULL REFERENCES arena.profiles(id),
  season_id text NOT NULL REFERENCES arena.seasons(id), playlist smallint NOT NULL, mode text NOT NULL,
  previous jsonb NOT NULL, current jsonb NOT NULL, delta double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(match_id, player_id, mode)
);
CREATE TABLE IF NOT EXISTS arena.penalties (
  player_id uuid PRIMARY KEY REFERENCES arena.profiles(id), strikes integer NOT NULL DEFAULT 0,
  until_at timestamptz NOT NULL, last_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arena.abandonments (
  match_id uuid NOT NULL REFERENCES arena.matches(id), player_id uuid NOT NULL REFERENCES arena.profiles(id),
  reason text NOT NULL, cooldown_seconds integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(match_id, player_id)
);
CREATE INDEX IF NOT EXISTS rating_history_player ON arena.rating_history(player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS matches_status ON arena.matches(status);
ALTER TABLE arena.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena.roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena.rating_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena.penalties ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena.abandonments ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena.seasons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA arena FROM PUBLIC;
-- Supabase browser roles receive no policies, schema access, or grants.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON SCHEMA arena FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA arena FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON SCHEMA arena FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA arena FROM authenticated;
  END IF;
END $$;
INSERT INTO arena.schema_version(version) VALUES(1) ON CONFLICT DO NOTHING;
COMMIT;
