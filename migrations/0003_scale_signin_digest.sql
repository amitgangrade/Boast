-- A counter bumped whenever players or clubs change, so read-heavy endpoints
-- (/players, /clubs) can serve a per-isolate cached copy after reading one row.
CREATE TABLE data_versions (
  name     TEXT PRIMARY KEY,
  version  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO data_versions (name, version) VALUES ('directory', 1);
CREATE TRIGGER players_dv_insert AFTER INSERT ON players BEGIN UPDATE data_versions SET version = version + 1 WHERE name = 'directory'; END;
CREATE TRIGGER players_dv_update AFTER UPDATE ON players BEGIN UPDATE data_versions SET version = version + 1 WHERE name = 'directory'; END;
CREATE TRIGGER players_dv_delete AFTER DELETE ON players BEGIN UPDATE data_versions SET version = version + 1 WHERE name = 'directory'; END;
CREATE TRIGGER clubs_dv_insert AFTER INSERT ON clubs BEGIN UPDATE data_versions SET version = version + 1 WHERE name = 'directory'; END;
CREATE TRIGGER clubs_dv_update AFTER UPDATE ON clubs BEGIN UPDATE data_versions SET version = version + 1 WHERE name = 'directory'; END;
CREATE TRIGGER clubs_dv_delete AFTER DELETE ON clubs BEGIN UPDATE data_versions SET version = version + 1 WHERE name = 'directory'; END;

-- Lets recomputeLevels find matches that lost their confirmed status without scanning every match.
CREATE INDEX matches_stale_levels ON matches(id) WHERE status <> 'confirmed' AND level_a_after IS NOT NULL;

-- Email-link sign-in: one-time tokens (stored hashed), valid for 15 minutes.
CREATE TABLE login_tokens (
  id          TEXT PRIMARY KEY,          -- sha-256 of the token in the link
  email       TEXT NOT NULL,
  email_norm  TEXT NOT NULL,
  return_to   TEXT,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX login_tokens_email ON login_tokens(email_norm, created_at);

-- More email preferences (1 = send).
ALTER TABLE players ADD COLUMN notify_digest INTEGER NOT NULL DEFAULT 1;
ALTER TABLE players ADD COLUMN notify_leagues INTEGER NOT NULL DEFAULT 1;
