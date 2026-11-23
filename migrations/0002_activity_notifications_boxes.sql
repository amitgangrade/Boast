-- Derived by recomputeLevels (never edited directly):
--   last_played: date of the player's most recent confirmed match
--   prev_level:  their level 7 days ago (NULL if they joined after that), for rank movement
ALTER TABLE players ADD COLUMN last_played TEXT;
ALTER TABLE players ADD COLUMN prev_level REAL;

-- Email preferences (1 = send). Unsubscribe links carry email_token instead of a session.
ALTER TABLE players ADD COLUMN notify_matches INTEGER NOT NULL DEFAULT 1;
ALTER TABLE players ADD COLUMN notify_challenges INTEGER NOT NULL DEFAULT 1;
ALTER TABLE players ADD COLUMN notify_reminders INTEGER NOT NULL DEFAULT 1;
ALTER TABLE players ADD COLUMN email_token TEXT;
UPDATE players SET email_token = lower(hex(randomblob(16))) WHERE email_token IS NULL;
CREATE UNIQUE INDEX players_email_token ON players(email_token) WHERE email_token IS NOT NULL;

-- Box leagues: a group runs rounds; each round splits players into numbered boxes
-- (1 = top). Results come from confirmed 'box' matches between box-mates in the round's dates.
CREATE TABLE box_rounds (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  starts_on   TEXT NOT NULL,
  ends_on     TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX box_rounds_group ON box_rounds(group_id, starts_on DESC);

CREATE TABLE box_entries (
  round_id   TEXT NOT NULL REFERENCES box_rounds(id) ON DELETE CASCADE,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  box        INTEGER NOT NULL CHECK (box >= 1),
  PRIMARY KEY (round_id, player_id)
);
CREATE INDEX box_entries_player ON box_entries(player_id);
