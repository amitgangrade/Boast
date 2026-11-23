import { DEFAULT_SETTINGS, type Game, type MatchType, recomputeAll, type RatingPlayer, type Settings } from '../shared/rating'

export async function loadSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare("SELECT data FROM settings WHERE id = 'algorithm'").first<{ data: string }>()
  return row ? { ...DEFAULT_SETTINGS, ...(JSON.parse(row.data) as Partial<Settings>) } : DEFAULT_SETTINGS
}

const CHUNK = 400
const changed = (x: number | null, y: number) => x == null || Math.abs(x - y) > 1e-9
const changedOrNull = (x: number | null, y: number | null) => (x == null || y == null ? x !== y : Math.abs(x - y) > 1e-9)

/** Rank movement on the leaderboard compares against levels this many days ago. */
export const MOVEMENT_DAYS = 7

/** A match's place in the replay order: (date, created_at, id). */
export interface MatchKey {
  date: string
  created_at: string
  id: string
}

/**
 * Narrows a recompute to what a match change can affect: every confirmed match from
 * `from` onward (in replay order), plus `players` — the changed match's players, who
 * need recomputing even if that match is no longer confirmed.
 */
export interface RecomputeScope {
  from: MatchKey
  players: string[]
}

/** The earlier of two match keys, for edits that move a match. */
export const earlierKey = <K extends MatchKey>(x: K, y: K): K =>
  (x.date.localeCompare(y.date) || x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id)) <= 0 ? x : y

interface PlayerLevelRow {
  id: string
  starting_level: number
  seeded_rating: number
  current_level: number | null
  matches_played: number
  created_at: string
  last_played: string | null
  prev_level: number | null
}

interface MatchLevelRow {
  id: string
  date: string
  created_at: string
  player_a_id: string
  player_b_id: string
  games: string
  type: MatchType
  unranked: number
  level_a_before: number | null
  level_b_before: number | null
  level_a_after: number | null
  level_b_after: number | null
  delta_a: number | null
  delta_b: number | null
  provisional_a: number | null
  provisional_b: number | null
}

const MATCH_COLS = `id, date, created_at, player_a_id, player_b_id, games, type, unranked,
  level_a_before, level_b_before, level_a_after, level_b_after, delta_a, delta_b, provisional_a, provisional_b`
const PLAYER_COLS = 'id, starting_level, seeded_rating, current_level, matches_played, created_at, last_played, prev_level'
// Uses the matches_stale_levels partial index (migration 0003), so it doesn't scan every match.
const STALE_SQL = "SELECT id FROM matches WHERE status <> 'confirmed' AND level_a_after IS NOT NULL"

const inOrder = (x: MatchLevelRow, y: MatchLevelRow) => x.date.localeCompare(y.date) || x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id)
const cutoffDate = () => new Date(Date.now() - MOVEMENT_DAYS * 86_400_000).toISOString().slice(0, 10)

/**
 * Recomputes levels from confirmed matches and writes only the rows whose cached values
 * changed. Called after anything that can affect ratings, so stored levels are never stale.
 *
 * Without a scope it replays the whole history (settings, starting levels, imports, the
 * daily cron). With a scope it replays only from the changed match onward, starting each
 * affected player from their stored level just before it — the same result for far fewer
 * rows read, which matters on D1's free plan.
 */
export async function recomputeLevels(db: D1Database, scope?: RecomputeScope): Promise<{ players: number; matches: number }> {
  return scope ? recomputeFrom(db, scope) : recomputeEverything(db)
}

async function recomputeEverything(db: D1Database) {
  const [settings, playersRes, matchesRes, staleRes] = await Promise.all([
    loadSettings(db),
    db.prepare(`SELECT ${PLAYER_COLS} FROM players`).all<PlayerLevelRow>(),
    db.prepare(`SELECT ${MATCH_COLS} FROM matches WHERE status = 'confirmed'`).all<MatchLevelRow>(),
    db.prepare(STALE_SQL).all<{ id: string }>(),
  ])
  const players = playersRes.results
  const matches = matchesRes.results
  const result = recomputeAll(
    players.map((p) => ({ id: p.id, startingLevel: p.starting_level, seededRating: !!p.seeded_rating })),
    matches.map(toRatingMatch),
    settings,
  )

  // Last confirmed match date, and each player's level as of MOVEMENT_DAYS ago (for rank movement).
  const cutoff = cutoffDate()
  const lastPlayed = new Map<string, string>()
  const levelThen = new Map<string, number>()
  for (const m of [...matches].sort(inOrder)) {
    for (const pid of [m.player_a_id, m.player_b_id]) lastPlayed.set(pid, m.date)
    const r = result.matches.get(m.id)
    if (!r || m.date > cutoff) continue
    levelThen.set(m.player_a_id, r.levelAAfter)
    levelThen.set(m.player_b_id, r.levelBAfter)
  }

  const playerUpdates: PlayerUpdate[] = []
  for (const p of players) {
    const s = result.players.get(p.id)!
    const lp = lastPlayed.get(p.id) ?? null
    const pl = levelThen.get(p.id) ?? (p.created_at.slice(0, 10) <= cutoff ? p.starting_level : null)
    pushIfChanged(playerUpdates, p, s.currentLevel, s.matchesPlayed, lp, pl)
  }
  return write(db, playerUpdates, matchUpdates(matches, result.matches), staleRes.results)
}

async function recomputeFrom(db: D1Database, scope: RecomputeScope) {
  const k = scope.from
  const [settings, suffixRes, staleRes] = await Promise.all([
    loadSettings(db),
    db
      .prepare(`SELECT ${MATCH_COLS} FROM matches WHERE status = 'confirmed' AND (date, created_at, id) >= (?1, ?2, ?3)`)
      .bind(k.date, k.created_at, k.id)
      .all<MatchLevelRow>(),
    db.prepare(STALE_SQL).all<{ id: string }>(),
  ])
  const suffix = suffixRes.results.sort(inOrder)
  const ids = [...new Set([...scope.players, ...suffix.flatMap((m) => [m.player_a_id, m.player_b_id])])]
  if (ids.length === 0) return write(db, [], [], staleRes.results)

  // Each affected player's state just before the changed match: their last confirmed match
  // before it (whose stored levels are still right, since nothing before it changed) and
  // how many rated matches they'd played. One indexed lookup per player and side.
  const [playersRes, beforeRes] = await db.batch([
    db.prepare(`SELECT ${PLAYER_COLS} FROM players WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)),
    db
      .prepare(
        `WITH prior AS (
           SELECT j.value AS pid,
             (SELECT id FROM matches WHERE player_a_id = j.value AND status = 'confirmed' AND (date, created_at, id) < (?2, ?3, ?4)
                ORDER BY date DESC, created_at DESC, id DESC LIMIT 1) AS a_id,
             (SELECT id FROM matches WHERE player_b_id = j.value AND status = 'confirmed' AND (date, created_at, id) < (?2, ?3, ?4)
                ORDER BY date DESC, created_at DESC, id DESC LIMIT 1) AS b_id,
             (SELECT COUNT(*) FROM matches WHERE player_a_id = j.value AND status = 'confirmed' AND unranked = 0 AND (date, created_at, id) < (?2, ?3, ?4))
             + (SELECT COUNT(*) FROM matches WHERE player_b_id = j.value AND status = 'confirmed' AND unranked = 0 AND (date, created_at, id) < (?2, ?3, ?4)) AS played
           FROM json_each(?1) j)
         SELECT prior.pid, prior.played,
           ma.date AS a_date, ma.created_at AS a_created, ma.id AS a_mid, ma.level_a_after AS a_level,
           mb.date AS b_date, mb.created_at AS b_created, mb.id AS b_mid, mb.level_b_after AS b_level
         FROM prior LEFT JOIN matches ma ON ma.id = prior.a_id LEFT JOIN matches mb ON mb.id = prior.b_id`,
      )
      .bind(JSON.stringify(ids), k.date, k.created_at, k.id),
  ])
  const players = playersRes.results as PlayerLevelRow[]
  type Prior = { pid: string; played: number; a_date: string | null; a_created: string | null; a_mid: string | null; a_level: number | null; b_date: string | null; b_created: string | null; b_mid: string | null; b_level: number | null }
  const prior = new Map<string, { level: number | null; date: string | null; played: number }>()
  for (const r of beforeRes.results as Prior[]) {
    const a = r.a_mid ? { date: r.a_date!, created_at: r.a_created!, id: r.a_mid, level: r.a_level } : null
    const b = r.b_mid ? { date: r.b_date!, created_at: r.b_created!, id: r.b_mid, level: r.b_level } : null
    const last = a && b ? (earlierKey(a, b) === a ? b : a) : (a ?? b)
    prior.set(r.pid, { level: last?.level ?? null, date: last?.date ?? null, played: r.played })
  }

  const ratingPlayers: RatingPlayer[] = players.map((p) => ({
    id: p.id,
    startingLevel: p.starting_level,
    seededRating: !!p.seeded_rating,
    levelBefore: prior.get(p.id)?.level ?? undefined,
    matchesBefore: prior.get(p.id)?.played ?? 0,
  }))
  const result = recomputeAll(ratingPlayers, suffix.map(toRatingMatch), settings)

  const cutoff = cutoffDate()
  const lastInSuffix = new Map<string, string>()
  const levelThen = new Map<string, number>()
  for (const m of suffix) {
    for (const pid of [m.player_a_id, m.player_b_id]) lastInSuffix.set(pid, m.date)
    const r = result.matches.get(m.id)
    if (!r || m.date > cutoff) continue
    levelThen.set(m.player_a_id, r.levelAAfter)
    levelThen.set(m.player_b_id, r.levelBAfter)
  }

  const playerUpdates: PlayerUpdate[] = []
  for (const p of players) {
    const s = result.players.get(p.id)!
    const before = prior.get(p.id)
    const lp = lastInSuffix.get(p.id) ?? before?.date ?? null
    // If every change is after the cutoff, the level at the cutoff can't have moved.
    const pl =
      k.date > cutoff
        ? p.prev_level
        : (levelThen.get(p.id) ?? (before?.date ? before.level : null) ?? (p.created_at.slice(0, 10) <= cutoff ? p.starting_level : null))
    pushIfChanged(playerUpdates, p, s.currentLevel, s.matchesPlayed, lp, pl)
  }
  return write(db, playerUpdates, matchUpdates(suffix, result.matches), staleRes.results)
}

const toRatingMatch = (m: MatchLevelRow) => ({
  id: m.id,
  date: m.date,
  playerAId: m.player_a_id,
  playerBId: m.player_b_id,
  games: JSON.parse(m.games) as Game[],
  type: m.type,
  unranked: !!m.unranked,
  createdAt: m.created_at,
})

type PlayerUpdate = { id: string; l: number; n: number; lp: string | null; pl: number | null }

function pushIfChanged(out: PlayerUpdate[], p: PlayerLevelRow, level: number, played: number, lp: string | null, pl: number | null) {
  if (changed(p.current_level, level) || p.matches_played !== played || p.last_played !== lp || changedOrNull(p.prev_level, pl)) {
    out.push({ id: p.id, l: level, n: played, lp, pl })
  }
}

function matchUpdates(matches: MatchLevelRow[], levels: ReturnType<typeof recomputeAll>['matches']) {
  const out: Array<Record<string, number | string>> = []
  for (const m of matches) {
    const r = levels.get(m.id)
    if (!r) continue
    if (
      changed(m.level_a_before, r.levelABefore) ||
      changed(m.level_b_before, r.levelBBefore) ||
      changed(m.level_a_after, r.levelAAfter) ||
      changed(m.level_b_after, r.levelBAfter) ||
      m.provisional_a !== +r.provisionalA ||
      m.provisional_b !== +r.provisionalB
    ) {
      out.push({ id: m.id, lab: r.levelABefore, lbb: r.levelBBefore, laa: r.levelAAfter, lba: r.levelBAfter, da: r.deltaA, db: r.deltaB, pa: +r.provisionalA, pb: +r.provisionalB })
    }
  }
  return out
}

async function write(db: D1Database, playerUpdates: PlayerUpdate[], matchUpdates: Array<Record<string, number | string>>, stale: Array<{ id: string }>) {
  const stmts: D1PreparedStatement[] = []
  for (let i = 0; i < playerUpdates.length; i += CHUNK) {
    stmts.push(
      db
        .prepare(
          `UPDATE players SET current_level = j.value->>'$.l', matches_played = j.value->>'$.n',
             last_played = j.value->>'$.lp', prev_level = j.value->>'$.pl'
           FROM json_each(?) j WHERE players.id = j.value->>'$.id'`,
        )
        .bind(JSON.stringify(playerUpdates.slice(i, i + CHUNK))),
    )
  }
  for (let i = 0; i < matchUpdates.length; i += CHUNK) {
    stmts.push(
      db
        .prepare(
          `UPDATE matches SET
             level_a_before = j.value->>'$.lab', level_b_before = j.value->>'$.lbb',
             level_a_after = j.value->>'$.laa', level_b_after = j.value->>'$.lba',
             delta_a = j.value->>'$.da', delta_b = j.value->>'$.db',
             provisional_a = j.value->>'$.pa', provisional_b = j.value->>'$.pb'
           FROM json_each(?) j WHERE matches.id = j.value->>'$.id'`,
        )
        .bind(JSON.stringify(matchUpdates.slice(i, i + CHUNK))),
    )
  }
  if (stale.length > 0) {
    stmts.push(
      db
        .prepare(
          `UPDATE matches SET level_a_before = NULL, level_b_before = NULL, level_a_after = NULL, level_b_after = NULL,
             delta_a = NULL, delta_b = NULL, provisional_a = NULL, provisional_b = NULL
           WHERE id IN (SELECT value FROM json_each(?))`,
        )
        .bind(JSON.stringify(stale.map((r) => r.id))),
    )
  }
  if (stmts.length) await db.batch(stmts)
  return { players: playerUpdates.length, matches: matchUpdates.length + stale.length }
}
