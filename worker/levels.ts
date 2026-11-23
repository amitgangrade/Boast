import { DEFAULT_SETTINGS, type Game, type MatchType, recomputeAll, type Settings } from '../shared/rating'

export async function loadSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare("SELECT data FROM settings WHERE id = 'algorithm'").first<{ data: string }>()
  return row ? { ...DEFAULT_SETTINGS, ...(JSON.parse(row.data) as Partial<Settings>) } : DEFAULT_SETTINGS
}

const CHUNK = 400
const changed = (x: number | null, y: number) => x == null || Math.abs(x - y) > 1e-9
const changedOrNull = (x: number | null, y: number | null) => (x == null || y == null ? x !== y : Math.abs(x - y) > 1e-9)

/** Rank movement on the leaderboard compares against levels this many days ago. */
export const MOVEMENT_DAYS = 7

/**
 * Recomputes every level from the full confirmed-match history and writes only
 * the rows whose cached values changed. Called after anything that can affect
 * ratings, so stored levels are never stale.
 */
export async function recomputeLevels(db: D1Database): Promise<{ players: number; matches: number }> {
  const [settings, playersRes, matchesRes, staleRes] = await Promise.all([
    loadSettings(db),
    db
      .prepare('SELECT id, starting_level, seeded_rating, current_level, matches_played, created_at, last_played, prev_level FROM players')
      .all<{
        id: string
        starting_level: number
        seeded_rating: number
        current_level: number | null
        matches_played: number
        created_at: string
        last_played: string | null
        prev_level: number | null
      }>(),
    db
      .prepare(
        `SELECT id, date, created_at, player_a_id, player_b_id, games, type, unranked,
                level_a_before, level_b_before, level_a_after, level_b_after, delta_a, delta_b, provisional_a, provisional_b
         FROM matches WHERE status = 'confirmed'`,
      )
      .all<{
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
      }>(),
    db.prepare("SELECT id FROM matches WHERE status <> 'confirmed' AND level_a_after IS NOT NULL").all<{ id: string }>(),
  ])
  const players = playersRes.results
  const matches = matchesRes.results
  const result = recomputeAll(
    players.map((p) => ({ id: p.id, startingLevel: p.starting_level, seededRating: !!p.seeded_rating })),
    matches.map((m) => ({
      id: m.id,
      date: m.date,
      playerAId: m.player_a_id,
      playerBId: m.player_b_id,
      games: JSON.parse(m.games) as Game[],
      type: m.type,
      unranked: !!m.unranked,
      createdAt: m.created_at,
    })),
    settings,
  )

  // Last confirmed match date, and each player's level as of MOVEMENT_DAYS ago (for rank movement).
  const cutoff = new Date(Date.now() - MOVEMENT_DAYS * 86_400_000).toISOString().slice(0, 10)
  const lastPlayed = new Map<string, string>()
  const levelThen = new Map<string, number>()
  const ordered = [...matches].sort((x, y) => x.date.localeCompare(y.date) || x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id))
  for (const m of ordered) {
    for (const pid of [m.player_a_id, m.player_b_id]) lastPlayed.set(pid, m.date)
    const r = result.matches.get(m.id)
    if (!r || m.date > cutoff) continue
    levelThen.set(m.player_a_id, r.levelAAfter)
    levelThen.set(m.player_b_id, r.levelBAfter)
  }

  const playerUpdates: Array<{ id: string; l: number; n: number; lp: string | null; pl: number | null }> = []
  for (const p of players) {
    const s = result.players.get(p.id)!
    const lp = lastPlayed.get(p.id) ?? null
    const pl = levelThen.get(p.id) ?? (p.created_at.slice(0, 10) <= cutoff ? p.starting_level : null)
    if (changed(p.current_level, s.currentLevel) || p.matches_played !== s.matchesPlayed || p.last_played !== lp || changedOrNull(p.prev_level, pl)) {
      playerUpdates.push({ id: p.id, l: s.currentLevel, n: s.matchesPlayed, lp, pl })
    }
  }
  const matchUpdates: Array<Record<string, number | string>> = []
  for (const m of matches) {
    const r = result.matches.get(m.id)
    if (!r) continue
    if (
      changed(m.level_a_before, r.levelABefore) ||
      changed(m.level_b_before, r.levelBBefore) ||
      changed(m.level_a_after, r.levelAAfter) ||
      changed(m.level_b_after, r.levelBAfter) ||
      m.provisional_a !== +r.provisionalA ||
      m.provisional_b !== +r.provisionalB
    ) {
      matchUpdates.push({
        id: m.id,
        lab: r.levelABefore,
        lbb: r.levelBBefore,
        laa: r.levelAAfter,
        lba: r.levelBAfter,
        da: r.deltaA,
        db: r.deltaB,
        pa: +r.provisionalA,
        pb: +r.provisionalB,
      })
    }
  }

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
  if (staleRes.results.length > 0) {
    stmts.push(
      db
        .prepare(
          `UPDATE matches SET level_a_before = NULL, level_b_before = NULL, level_a_after = NULL, level_b_after = NULL,
             delta_a = NULL, delta_b = NULL, provisional_a = NULL, provisional_b = NULL
           WHERE id IN (SELECT value FROM json_each(?))`,
        )
        .bind(JSON.stringify(staleRes.results.map((r) => r.id))),
    )
  }
  if (stmts.length) await db.batch(stmts)
  return { players: playerUpdates.length, matches: matchUpdates.length + staleRes.results.length }
}
