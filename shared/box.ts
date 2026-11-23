import type { BoxRound, Match } from './api'
import { gamesWon } from './rating'

/** Box league points: everyone who plays scores, and a win is worth most. */
export const BOX_POINTS = { win: 3, draw: 2, loss: 1 } as const

export interface BoxStanding {
  playerId: string
  played: number
  won: number
  drawn: number
  lost: number
  gamesFor: number
  gamesAgainst: number
  pointsFor: number
  pointsAgainst: number
  points: number
}

export const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`)

/**
 * Results for one box: the first confirmed 'box' match between each pair of box-mates
 * played within the round's dates, and the standings they produce.
 * `order` breaks exact ties (e.g. level order), so standings are stable.
 */
export function boxResults(round: Pick<BoxRound, 'startsOn' | 'endsOn'>, box: string[], matches: Match[]) {
  const members = new Set(box)
  const cells = new Map<string, Match>()
  const sorted = [...matches].sort((x, y) => x.date.localeCompare(y.date) || x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id))
  for (const m of sorted) {
    if (m.status !== 'confirmed' || m.type !== 'box') continue
    if (m.date < round.startsOn || m.date > round.endsOn) continue
    if (!members.has(m.playerAId) || !members.has(m.playerBId)) continue
    const k = pairKey(m.playerAId, m.playerBId)
    if (!cells.has(k)) cells.set(k, m)
  }
  const table = new Map<string, BoxStanding>(
    box.map((id) => [id, { playerId: id, played: 0, won: 0, drawn: 0, lost: 0, gamesFor: 0, gamesAgainst: 0, pointsFor: 0, pointsAgainst: 0, points: 0 }]),
  )
  for (const m of cells.values()) {
    for (const side of ['a', 'b'] as const) {
      const s = table.get(side === 'a' ? m.playerAId : m.playerBId)!
      const other = side === 'a' ? 'b' : 'a'
      const gf = gamesWon(m.games, side)
      const ga = gamesWon(m.games, other)
      s.played++
      s.gamesFor += gf
      s.gamesAgainst += ga
      for (const g of m.games) {
        s.pointsFor += g[side]
        s.pointsAgainst += g[other]
      }
      if (gf > ga) {
        s.won++
        s.points += BOX_POINTS.win
      } else if (gf < ga) {
        s.lost++
        s.points += BOX_POINTS.loss
      } else {
        s.drawn++
        s.points += BOX_POINTS.draw
      }
    }
  }
  const rank = new Map(box.map((id, i) => [id, i]))
  const standings = [...table.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.won - x.won ||
      y.gamesFor - y.gamesAgainst - (x.gamesFor - x.gamesAgainst) ||
      y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst) ||
      rank.get(x.playerId)! - rank.get(y.playerId)!,
  )
  return { cells, standings, total: (box.length * (box.length - 1)) / 2 }
}

/**
 * Next round's boxes from this round's final standings (each box ranked best first):
 * the top `move` of each box go up one box and the bottom `move` go down one.
 */
export function promoteRelegate(ranked: string[][], move = 1): string[][] {
  const n = ranked.length
  const up = ranked.map((b, i) => (i > 0 ? b.slice(0, move) : []))
  const down = ranked.map((b, i) => (i < n - 1 ? b.slice(Math.max(b.length - move, up[i].length)) : []))
  return ranked.map((b, i) => {
    const leaving = new Set([...up[i], ...down[i]])
    return [...(i > 0 ? down[i - 1] : []), ...b.filter((id) => !leaving.has(id)), ...(i < n - 1 ? up[i + 1] : [])]
  })
}

/** Splits players (best first) into boxes of about `size`, without leaving a lonely last box. */
export function fillBoxes(playerIds: string[], size: number): string[][] {
  const s = Math.max(2, Math.floor(size))
  const count = Math.max(1, Math.round(playerIds.length / s))
  const base = Math.floor(playerIds.length / count)
  const extra = playerIds.length % count
  const out: string[][] = []
  let i = 0
  for (let b = 0; b < count; b++) {
    const len = base + (b < extra ? 1 : 0)
    out.push(playerIds.slice(i, i + len))
    i += len
  }
  return out.filter((b) => b.length > 0)
}
