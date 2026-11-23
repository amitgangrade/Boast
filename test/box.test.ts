import { expect, test } from 'vitest'
import type { Match } from '../shared/api'
import { boxResults, fillBoxes, promoteRelegate } from '../shared/box'

let n = 0
function match(a: string, b: string, games: Array<[number, number]>, over: Partial<Match> = {}): Match {
  n++
  return {
    id: `m${n}`, date: '2026-03-10', playerAId: a, playerBId: b, games: games.map(([x, y]) => ({ a: x, b: y })), type: 'box',
    venue: null, notes: null, status: 'confirmed', unranked: false, autoConfirmed: false, confirmedAt: null, disputedAt: null,
    createdBy: null, createdAt: `2026-03-10T10:00:0${n % 10}Z`, levelABefore: null, levelBBefore: null, levelAAfter: null,
    levelBAfter: null, deltaA: null, deltaB: null, provisionalA: null, provisionalB: null, ...over,
  }
}
const round = { startsOn: '2026-03-01', endsOn: '2026-03-31' }

test('standings: 3 for a win, 1 for a loss, ties broken by games then points', () => {
  const ms = [
    match('ann', 'bob', [[11, 5], [11, 5], [11, 5]]),
    match('bob', 'cat', [[11, 9], [9, 11], [11, 9], [11, 9]]),
    match('cat', 'ann', [[11, 8], [11, 8], [11, 8]]),
  ]
  const { standings, cells, total } = boxResults(round, ['ann', 'bob', 'cat'], ms)
  expect(total).toBe(3)
  expect(cells.size).toBe(3)
  // Everyone won once and lost once (4 pts each); games difference decides.
  expect(standings.map((s) => [s.playerId, s.points])).toEqual([['cat', 4], ['ann', 4], ['bob', 4]])
})

test('only confirmed box matches inside the round between box-mates count, first one per pair', () => {
  const ms = [
    match('ann', 'bob', [[11, 1], [11, 1], [11, 1]], { type: 'friendly' }),
    match('ann', 'bob', [[1, 11], [1, 11], [1, 11]], { date: '2026-02-28' }),
    match('ann', 'bob', [[11, 2], [11, 2], [11, 2]], { status: 'pending' }),
    match('ann', 'zed', [[11, 2], [11, 2], [11, 2]]),
    match('bob', 'ann', [[11, 2], [11, 2], [11, 2]], { date: '2026-03-05' }),
    match('ann', 'bob', [[11, 2], [11, 2], [11, 2]], { date: '2026-03-20' }),
  ]
  const { standings } = boxResults(round, ['ann', 'bob'], ms)
  expect(standings[0]).toMatchObject({ playerId: 'bob', won: 1, played: 1, points: 3 })
  expect(standings[1]).toMatchObject({ playerId: 'ann', lost: 1, played: 1, points: 1 })
})

test('promotion and relegation move one player between neighbouring boxes', () => {
  expect(promoteRelegate([['a1', 'a2', 'a3'], ['b1', 'b2', 'b3'], ['c1', 'c2', 'c3']])).toEqual([
    ['a1', 'a2', 'b1'],
    ['a3', 'b2', 'c1'],
    ['b3', 'c2', 'c3'],
  ])
  expect(promoteRelegate([['a1', 'a2']])).toEqual([['a1', 'a2']])
})

test('boxes are filled evenly in level order', () => {
  const ids = Array.from({ length: 11 }, (_, i) => `p${i + 1}`)
  const boxes = fillBoxes(ids, 5)
  expect(boxes.map((b) => b.length)).toEqual([6, 5])
  expect(boxes[0][0]).toBe('p1')
  expect(fillBoxes(['a', 'b', 'c'], 5)).toEqual([['a', 'b', 'c']])
})
