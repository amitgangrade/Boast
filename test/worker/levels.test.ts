import { expect, test } from 'vitest'
import { earlierKey, type MatchKey, recomputeLevels } from '../../worker/levels'
import { testDb } from './d1'

/**
 * The narrow recompute (replaying only from a changed match) must leave the database
 * exactly as a full replay would. After each kind of change we run the narrow version,
 * then a full one: the full one must find nothing left to fix.
 */

let seed = 42
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

function games() {
  const out: Array<{ a: number; b: number }> = []
  let wa = 0
  let wb = 0
  while (wa < 3 && wb < 3) {
    const aWins = rnd() < 0.5
    const loser = Math.floor(rnd() * 10)
    out.push(aWins ? { a: 11, b: loser } : { a: loser, b: 11 })
    if (aWins) wa++
    else wb++
  }
  return JSON.stringify(out)
}

function setup() {
  const { d1, raw } = testDb()
  const players = Array.from({ length: 10 }, (_, i) => `p${i}`)
  players.forEach((id, i) =>
    raw
      .prepare('INSERT INTO players (id, name, starting_level, seeded_rating, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, `Player ${i}`, 1000 + Math.round(rnd() * 2000), i % 3 === 0 ? 1 : 0, i === 9 ? `${day(-3)}T00:00:00.000Z` : '2025-01-01T00:00:00.000Z'),
  )
  let n = 0
  const addMatch = (over: { date?: string; status?: string; unranked?: number; a?: string; b?: string } = {}) => {
    const a = over.a ?? pick(players.slice(0, 9))
    let b = over.b ?? pick(players.slice(0, 9))
    if (a === b) b = players[(players.indexOf(a) + 1) % 9]
    const id = `m${String(++n).padStart(3, '0')}`
    const row = {
      id,
      date: over.date ?? day(-Math.floor(rnd() * 400)),
      created_at: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
      a,
      b,
    }
    raw
      .prepare('INSERT INTO matches (id, date, player_a_id, player_b_id, games, type, status, unranked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, row.date, a, b, games(), pick(['friendly', 'box', 'league', 'tournament']), over.status ?? 'confirmed', over.unranked ?? (rnd() < 0.1 ? 1 : 0), row.created_at)
    return { id, date: row.date, created_at: row.created_at, player_a_id: a, player_b_id: b }
  }
  for (let i = 0; i < 80; i++) addMatch({ status: rnd() < 0.85 ? 'confirmed' : 'pending' })
  const keyOf = (id: string) => raw.prepare('SELECT id, date, created_at, player_a_id, player_b_id, status FROM matches WHERE id = ?').get(id) as unknown as MatchKey & { player_a_id: string; player_b_id: string; status: string }
  return { d1, raw, addMatch, keyOf, players }
}

async function expectConsistent(d1: D1Database) {
  expect(await recomputeLevels(d1)).toEqual({ players: 0, matches: 0 })
}

test('narrow recompute matches a full replay after every kind of match change', async () => {
  const { d1, raw, addMatch, keyOf } = setup()
  await recomputeLevels(d1)
  await expectConsistent(d1)

  // Confirm a pending match somewhere in the middle of the history.
  const pending = raw.prepare("SELECT id FROM matches WHERE status = 'pending' ORDER BY date LIMIT 1 OFFSET 2").get() as { id: string }
  raw.prepare("UPDATE matches SET status = 'confirmed' WHERE id = ?").run(pending.id)
  let m = keyOf(pending.id)
  await recomputeLevels(d1, { from: m, players: [m.player_a_id, m.player_b_id] })
  await expectConsistent(d1)

  // A new match today, and one backdated by a year (auto-confirmed, as when an admin logs it).
  for (const date of [day(0), day(-365), day(-3)]) {
    const added = addMatch({ date })
    await recomputeLevels(d1, { from: added, players: [added.player_a_id, added.player_b_id] })
    await expectConsistent(d1)
  }

  // A newcomer (joined 3 days ago) plays their first match.
  const first = addMatch({ date: day(-1), a: 'p9', b: 'p0' })
  await recomputeLevels(d1, { from: first, players: ['p9', 'p0'] })
  await expectConsistent(d1)

  // Edit: move a confirmed match earlier, then later, changing the score too.
  const confirmed = (raw.prepare("SELECT id FROM matches WHERE status = 'confirmed' ORDER BY date LIMIT 1 OFFSET 30").all() as Array<{ id: string }>)[0].id
  for (const newDate of [day(-390), day(-2)]) {
    const before = keyOf(confirmed)
    raw.prepare('UPDATE matches SET date = ?, games = ? WHERE id = ?').run(newDate, games(), confirmed)
    await recomputeLevels(d1, { from: earlierKey(before, { ...before, date: newDate }), players: [before.player_a_id, before.player_b_id] })
    await expectConsistent(d1)
  }

  // An admin sets a confirmed match to disputed, so its levels must be cleared.
  const toDispute = (raw.prepare("SELECT id FROM matches WHERE status = 'confirmed' ORDER BY date LIMIT 1 OFFSET 10").all() as Array<{ id: string }>)[0].id
  m = keyOf(toDispute)
  raw.prepare("UPDATE matches SET status = 'disputed' WHERE id = ?").run(toDispute)
  await recomputeLevels(d1, { from: m, players: [m.player_a_id, m.player_b_id] })
  await expectConsistent(d1)
  expect((raw.prepare('SELECT level_a_after FROM matches WHERE id = ?').get(toDispute) as { level_a_after: number | null }).level_a_after).toBeNull()

  // Delete a confirmed match.
  const toDelete = (raw.prepare("SELECT id FROM matches WHERE status = 'confirmed' ORDER BY date LIMIT 1 OFFSET 5").all() as Array<{ id: string }>)[0].id
  m = keyOf(toDelete)
  raw.prepare('DELETE FROM matches WHERE id = ?').run(toDelete)
  await recomputeLevels(d1, { from: m, players: [m.player_a_id, m.player_b_id] })
  await expectConsistent(d1)

  // A player's only match is deleted: they go back to their starting level and "never played".
  const solo = addMatch({ date: day(-1), a: 'p9', b: 'p1' })
  raw.prepare("DELETE FROM matches WHERE player_a_id = 'p9' OR player_b_id = 'p9'").run()
  await recomputeLevels(d1, { from: first, players: ['p9', 'p0', 'p1', solo.player_b_id] })
  await expectConsistent(d1)
  const p9 = raw.prepare("SELECT current_level, starting_level, matches_played, last_played FROM players WHERE id = 'p9'").get() as Record<string, unknown>
  expect(p9).toMatchObject({ matches_played: 0, last_played: null })
  expect(p9.current_level).toBe(p9.starting_level)
})

test('the narrow recompute reads only the tail of the history', async () => {
  const { d1, raw, addMatch } = setup()
  await recomputeLevels(d1)
  const total = (raw.prepare("SELECT COUNT(*) n FROM matches WHERE status = 'confirmed'").get() as { n: number }).n
  let suffixRows = 0
  const spy = {
    ...d1,
    prepare: (sql: string) => {
      const s = d1.prepare(sql)
      if (sql.includes('(date, created_at, id) >=')) {
        return { bind: (...a: unknown[]) => ({ all: async () => { const r = await s.bind(...a).all(); suffixRows = r.results.length; return r } }) }
      }
      return s
    },
  } as unknown as D1Database
  const today = addMatch({ date: day(0) })
  await recomputeLevels(spy, { from: today, players: [today.player_a_id, today.player_b_id] })
  expect(suffixRows).toBeLessThan(5)
  expect(total).toBeGreaterThan(50)
  await expectConsistent(d1)
})
