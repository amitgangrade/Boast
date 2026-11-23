import type { Match } from './api'
import { gamesWon } from './rating'
import { fmtDelta, fmtLevel } from './util'

/**
 * The message shared to WhatsApp and friends after a match: first person when the
 * sharer played in it, with the level change once it's confirmed.
 */
export function shareText(m: Match, names: { a: string; b: string }, me: string | null): string {
  const ga = gamesWon(m.games, 'a')
  const gb = gamesWon(m.games, 'b')
  const scores = m.games.map((g) => `${g.a}–${g.b}`).join(', ')
  const side = me === m.playerAId ? 'a' : me === m.playerBId ? 'b' : null
  if (!side) {
    const [w, l, x, y] = ga >= gb ? [names.a, names.b, ga, gb] : [names.b, names.a, gb, ga]
    return `${w} ${ga === gb ? 'drew with' : 'beat'} ${l} ${x}–${y} (${scores}) on Boast`
  }
  const mine = side === 'a' ? ga : gb
  const theirs = side === 'a' ? gb : ga
  const them = side === 'a' ? names.b : names.a
  const myScores = side === 'a' ? scores : m.games.map((g) => `${g.b}–${g.a}`).join(', ')
  const verb = mine > theirs ? 'Beat' : mine < theirs ? 'Lost to' : 'Drew with'
  const after = side === 'a' ? m.levelAAfter : m.levelBAfter
  const delta = side === 'a' ? m.deltaA : m.deltaB
  const level = m.status === 'confirmed' && after != null && !m.unranked ? ` My level: ${fmtLevel(after)} (${fmtDelta(delta)}).` : ''
  return `${verb} ${them} ${mine}–${theirs} (${myScores}).${level}${mine < theirs ? ' Rematch soon!' : ''} Tracked on Boast`
}
