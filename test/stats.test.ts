import { expect, test } from 'vitest'
import type { Match } from '../shared/api'
import { bestWin, currentStreak, inAgeGroup, isActive, levelHighlights, resultsFor, winStreaks } from '../shared/stats'

let n = 0
function m(a: string, b: string, aWins: boolean, date: string, over: Partial<Match> = {}): Match {
  n++
  const g = aWins ? { a: 11, b: 5 } : { a: 5, b: 11 }
  return {
    id: `m${n}`, date, playerAId: a, playerBId: b, games: [g, g, g], type: 'friendly', venue: null, notes: null, status: 'confirmed',
    unranked: false, autoConfirmed: false, confirmedAt: null, disputedAt: null, createdBy: null, createdAt: `${date}T10:00:00Z`,
    levelABefore: 1000, levelBBefore: 1000, levelAAfter: null, levelBAfter: null, deltaA: null, deltaB: null, provisionalA: null, provisionalB: null,
    ...over,
  }
}

test('form, streak and best win come from confirmed matches, newest first', () => {
  const ms = [
    m('me', 'x', true, '2026-01-01', { levelBBefore: 3000 }),
    m('y', 'me', true, '2026-01-02'),
    m('me', 'z', true, '2026-01-03', { levelBBefore: 2000 }),
    m('me', 'w', true, '2026-01-04', { levelBBefore: 2500 }),
    m('me', 'q', false, '2026-01-05', { status: 'pending' }),
  ]
  const r = resultsFor('me', ms)
  expect(r.map((e) => e.result)).toEqual(['W', 'W', 'L', 'W'])
  expect(currentStreak(r)).toEqual({ result: 'W', length: 2 })
  expect(bestWin(r)?.opponentId).toBe('x')
})

test('win streaks per player', () => {
  const s = winStreaks([m('a', 'b', true, '2026-01-01'), m('a', 'c', true, '2026-01-02'), m('b', 'c', true, '2026-01-03')])
  expect(s.get('a')).toBe(2)
  expect(s.get('b')).toBe(1)
  expect(s.get('c')).toBeUndefined()
})

test('activity and age groups', () => {
  const now = Date.parse('2026-06-01T00:00:00Z')
  expect(isActive({ lastPlayed: '2025-07-01', createdAt: '2020-01-01T00:00:00Z' }, now)).toBe(true)
  expect(isActive({ lastPlayed: '2025-05-01', createdAt: '2020-01-01T00:00:00Z' }, now)).toBe(false)
  expect(isActive({ lastPlayed: null, createdAt: '2026-05-01T00:00:00Z' }, now)).toBe(true)
  const year = new Date().getFullYear()
  expect(inAgeGroup({ birthYear: year - 40 }, '35')).toBe(true)
  expect(inAgeGroup({ birthYear: year - 40 }, '45')).toBe(false)
  expect(inAgeGroup({ birthYear: null }, '35')).toBe(false)
  expect(inAgeGroup({ birthYear: null }, '')).toBe(true)
})

test('peak level and 30-day change', () => {
  const day = 86_400_000
  const now = 100 * day
  const pts = [{ t: 0, level: 1000 }, { t: 50 * day, level: 1300 }, { t: 80 * day, level: 1200 }]
  expect(levelHighlights(pts, 30, now)).toEqual({ peak: 1300, peakAt: 50 * day, change: 1200 - 1300 })
})

test('share text speaks for the sharer and adds the level change once confirmed', async () => {
  const { shareText } = await import('../shared/share')
  const base = m('ann', 'bob', true, '2026-01-01', { games: [{ a: 11, b: 7 }, { a: 9, b: 11 }, { a: 11, b: 8 }, { a: 11, b: 5 }], levelAAfter: 2050, deltaA: 45, levelBAfter: 1950, deltaB: -45 })
  const names = { a: 'Ann Lee', b: 'Bob Ray' }
  expect(shareText(base, names, 'ann')).toBe('Beat Bob Ray 3–1 (11–7, 9–11, 11–8, 11–5). My level: 2,050 (+45). Tracked on Boast')
  expect(shareText(base, names, 'bob')).toBe('Lost to Ann Lee 1–3 (7–11, 11–9, 8–11, 5–11). My level: 1,950 (−45). Rematch soon! Tracked on Boast')
  expect(shareText({ ...base, status: 'pending' }, names, 'ann')).toBe('Beat Bob Ray 3–1 (11–7, 9–11, 11–8, 11–5). Tracked on Boast')
  expect(shareText(base, names, null)).toBe('Ann Lee beat Bob Ray 3–1 (11–7, 9–11, 11–8, 11–5) on Boast')
})
