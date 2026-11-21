-- Boast schema. Identity fields live only on `players`; a signed-in user owns
-- at most one player (players.user_id). Levels on players/matches are derived
-- caches written exclusively by the server-side recompute.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  email_norm  TEXT NOT NULL,
  google_sub  TEXT UNIQUE,
  google_name TEXT,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX users_email_norm ON users(email_norm);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,           -- sha-256 of the cookie token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE players (
  id              TEXT PRIMARY KEY,
  user_id         TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  username        TEXT UNIQUE,
  name            TEXT NOT NULL,
  email           TEXT,
  email_norm      TEXT,
  phone           TEXT,
  country         TEXT,
  city            TEXT,
  club            TEXT,
  club_slug       TEXT,
  avatar_url      TEXT,
  birth_year      INTEGER,
  gender          TEXT CHECK (gender IN ('male','female')),
  dominant_hand   TEXT CHECK (dominant_hand IN ('right','left','ambi')),
  notes           TEXT,
  starting_level  REAL NOT NULL DEFAULT 1000 CHECK (starting_level > 0),
  seeded_rating   INTEGER NOT NULL DEFAULT 0,
  current_level   REAL,
  matches_played  INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX players_email_unique ON players(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX players_email_norm ON players(email_norm);
CREATE INDEX players_club_slug ON players(club_slug);

CREATE TABLE matches (
  id              TEXT PRIMARY KEY,
  date            TEXT NOT NULL,
  player_a_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player_b_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  games           TEXT NOT NULL,          -- JSON [{a,b},...]
  type            TEXT NOT NULL CHECK (type IN ('friendly','box','league','tournament')),
  venue           TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','disputed')),
  unranked        INTEGER NOT NULL DEFAULT 0,
  auto_confirmed  INTEGER NOT NULL DEFAULT 0,
  confirmed_at    TEXT,
  disputed_at     TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  level_a_before  REAL,
  level_b_before  REAL,
  level_a_after   REAL,
  level_b_after   REAL,
  delta_a         REAL,
  delta_b         REAL,
  provisional_a   INTEGER,
  provisional_b   INTEGER,
  CHECK (player_a_id <> player_b_id)
);
CREATE INDEX matches_a ON matches(player_a_id, date);
CREATE INDEX matches_b ON matches(player_b_id, date);
CREATE INDEX matches_date ON matches(date DESC, created_at DESC);
CREATE INDEX matches_status ON matches(status, created_at);

CREATE TABLE challenges (
  id              TEXT PRIMARY KEY,
  from_player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  message         TEXT,
  proposed_date   TEXT,
  venue           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  responded_at    TEXT
);
CREATE INDEX challenges_to ON challenges(to_player_id, status);
CREATE INDEX challenges_from ON challenges(from_player_id, status);

CREATE TABLE clubs (
  slug         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  city         TEXT,
  country      TEXT,
  description  TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE club_admins (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_slug   TEXT NOT NULL,
  granted_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, club_slug)
);

CREATE TABLE groups (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  description  TEXT,
  is_private   INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE group_members (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  added_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (group_id, player_id)
);
CREATE INDEX group_members_player ON group_members(player_id);

CREATE TABLE settings (
  id          TEXT PRIMARY KEY,
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Profile photos, already cropped and shrunk by the browser (~50 KB each).
CREATE TABLE avatars (
  key           TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  content_type  TEXT NOT NULL,
  bytes         BLOB NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX avatars_player ON avatars(player_id);

CREATE TABLE audit_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_user_id       TEXT,
  actor_label         TEXT,
  entity_type         TEXT NOT NULL,
  entity_id           TEXT,
  op                  TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  summary             TEXT,
  changed             TEXT,                -- JSON
  subject_player_ids  TEXT NOT NULL DEFAULT '[]',
  subject_club_slugs  TEXT NOT NULL DEFAULT '[]',
  subject_group_ids   TEXT NOT NULL DEFAULT '[]',
  privileged          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX audit_at ON audit_events(at DESC, id DESC);
