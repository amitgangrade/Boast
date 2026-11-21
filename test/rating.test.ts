import { describe, expect, test } from 'vitest'
import {
  actualPerformance,
  DEFAULT_SETTINGS as S,
  expectedPerformance,
  gamesRatio,
  isProvisional,
  movingAverage,
  pointsRatio,
  recomputeAll,
  type RatingMatch,
  updateLevels,
} from '../shared/rating'

const sweep = [{ a: 11, b: 0 }, { a: 11, b: 0 }, { a: 11, b: 0 }]
const base = { games: sweep, type: 'box' as const, provisionalA: false, provisionalB: false, settings: S }

describe('performance', () => {
  test('equal levels expect 0.5 whatever the exponents', () => {
    expect(expectedPerformance(1000, 1000, S)).toBeCloseTo(0.5)
    expect(expectedPerformance(1000, 1000, { ...S, gamesExponent: 11 })).toBeCloseTo(0.5)
  })
  test('a clean 3-0 sweep is perfect performance', () => {
    expect(pointsRatio(sweep)).toBe(1)
    expect(gamesRatio(sweep)).toBe(1)
    expect(actualPerformance(sweep, S)).toBe(1)
  })
  test('tied games are ignored; all ties fall back to 0.5', () => {
    expect(gamesRatio([{ a: 10, b: 10 }, { a: 11, b: 5 }])).toBe(1)
    expect(gamesRatio([{ a: 10, b: 10 }])).toBe(0.5)
    expect(pointsRatio([])).toBe(0.5)
  })
})

describe('updateLevels', () => {
  test('moves players in opposite directions by equal proportions', () => {
    const u = updateLevels({ ...base, levelA: 1000, levelB: 1000 })
    expect(u.levelAAfter / 1000 - 1).toBeCloseTo(1 - u.levelBAfter / 1000)
    expect(u.deltaA).toBeGreaterThan(0)
  })
  test('tournament moves 1.6/0.7 times a friendly', () => {
    const t = updateLevels({ ...base, type: 'tournament', levelA: 1000, levelB: 1100 })
    const f = updateLevels({ ...base, type: 'friendly', levelA: 1000, levelB: 1100 })
    expect(t.deltaA / f.deltaA).toBeCloseTo(1.6 / 0.7)
  })
  test('halving damping halves the change', () => {
    const full = updateLevels({ ...base, levelA: 900, levelB: 1000 })
    const half = updateLevels({ ...base, levelA: 900, levelB: 1000, settings: { ...S, dampingK: 0.06 } })
    expect(half.deltaA).toBeCloseTo(full.deltaA / 2)
  })
  test('levels never drop below 1', () => {
    const u = updateLevels({ ...base, levelA: 50, levelB: 50, settings: { ...S, dampingK: 50 }, games: [{ a: 0, b: 11 }] })
    expect(u.levelAAfter).toBe(1)
  })
  test('an established player is shielded from a provisional opponent', () => {
    const u = updateLevels({ ...base, levelA: 1000, levelB: 1500, provisionalA: true })
    expect(u.levelBAfter).toBe(1500)
    expect(u.levelAAfter).toBeGreaterThan(1000)
  })
})

describe('provisional', () => {
  test('seeded players are never provisional', () => {
    expect(isProvisional({ matchesPlayed: 0, seededRating: true }, S)).toBe(false)
    expect(isProvisional({ matchesPlayed: 4, seededRating: false }, S)).toBe(true)
    expect(isProvisional({ matchesPlayed: 5, seededRating: false }, S)).toBe(false)
  })
})

describe('recomputeAll', () => {
  const players = [
    { id: 'a', startingLevel: 1000, seededRating: true },
    { id: 'b', startingLevel: 1000, seededRating: true },
    { id: 'c', startingLevel: 1000, seededRating: true },
  ]
  const m = (id: string, date: string, x: string, y: string, extra: Partial<RatingMatch> = {}): RatingMatch => ({
    id, date, playerAId: x, playerBId: y, games: [{ a: 11, b: 7 }, { a: 11, b: 9 }], type: 'league', unranked: false, ...extra,
  })

  test('input order does not matter, only (date, id)', () => {
    const ms = [m('2', '2024-02-01', 'b', 'c'), m('1', '2024-01-01', 'a', 'b'), m('3', '2024-02-01', 'c', 'a')]
    const r1 = recomputeAll(players, ms, S)
    const r2 = recomputeAll(players, [...ms].reverse(), S)
    for (const p of players) expect(r1.players.get(p.id)).toEqual(r2.players.get(p.id))
  })
  test('same-day matches replay in the order they were recorded', () => {
    const late = m('a-first-id', '2024-03-01', 'a', 'b', { createdAt: '2024-03-01T20:00:00Z' })
    const early = m('z-last-id', '2024-03-01', 'c', 'a', { createdAt: '2024-03-01T09:00:00Z' })
    const r = recomputeAll(players, [late, early], S)
    expect(r.matches.get('z-last-id')!.levelBBefore).toBe(1000)
    expect(r.matches.get('a-first-id')!.levelABefore).not.toBe(1000)
  })
  test('unranked matches pass through with zero change', () => {
    const r = recomputeAll(players, [m('1', '2024-01-01', 'a', 'b', { unranked: true })], S)
    expect(r.matches.get('1')!.deltaA).toBe(0)
    expect(r.players.get('a')).toEqual({ currentLevel: 1000, matchesPlayed: 0 })
  })
  test('provisional status is read before each match', () => {
    const p = [{ id: 'n', startingLevel: 1000, seededRating: false }, { id: 'e', startingLevel: 1000, seededRating: true }]
    const ms = Array.from({ length: 6 }, (_, i) => m(String(i), `2024-01-0${i + 1}`, 'n', 'e'))
    const r = recomputeAll(p, ms, S)
    expect(r.matches.get('4')!.provisionalA).toBe(true)
    expect(r.matches.get('4')!.deltaB).toBe(0)
    expect(r.matches.get('5')!.provisionalA).toBe(false)
    expect(r.matches.get('5')!.deltaB).toBeLessThan(0)
  })
  test('a player with no matches keeps their starting level', () => {
    expect(recomputeAll(players, [], S).players.get('c')).toEqual({ currentLevel: 1000, matchesPlayed: 0 })
  })
})

test('movingAverage uses the last N levels', () => {
  expect(movingAverage([1, 2, 3, 4, 5], 2)).toBe(4.5)
  expect(movingAverage([7], 4)).toBe(7)
})
