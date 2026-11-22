import { actualPerformance, expectedPerformance, gamesRatio, type Game, MATCH_TYPE_LABEL, MATCH_TYPE_WEIGHT, MATCH_TYPES, type MatchType, pointsRatio, type Settings } from './rating'
import { fmtLevel } from './util'

export interface ExplainInput {
  levelA: number
  levelB: number
  games: Game[]
  type: MatchType
  provisionalA: boolean
  provisionalB: boolean
  deltaA: number
  deltaB: number
  nameA: string
  nameB: string
  settings: Settings
  /** Whose point of view to explain from. */
  side: 'a' | 'b'
  /** Describe a match that hasn't been saved yet ("would") instead of a played one ("was"). */
  preview?: boolean
}

export interface Explanation {
  /** Share of the match the chosen side was expected to win, 0–1. */
  expected: number
  /** Share they actually won, 0–1. */
  actual: number
  lines: string[]
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const pts = (d: number) => `${fmtLevel(Math.abs(d))} ${Math.round(Math.abs(d)) === 1 ? 'point' : 'points'}`

/** Plain-English account of why a rated match moved levels the way it did. */
export function explainMatch(i: ExplainInput): Explanation {
  const flip = i.side === 'b'
  const mirror = (games: Game[]) => games.map((g) => ({ a: g.b, b: g.a }))
  const me = flip ? i.nameB : i.nameA
  const them = flip ? i.nameA : i.nameB
  const myLevel = flip ? i.levelB : i.levelA
  const theirLevel = flip ? i.levelA : i.levelB
  const myDelta = flip ? i.deltaB : i.deltaA
  const theirDelta = flip ? i.deltaA : i.deltaB
  const myGames = flip ? mirror(i.games) : i.games
  const expected = flip ? 1 - expectedPerformance(i.levelA, i.levelB, i.settings) : expectedPerformance(i.levelA, i.levelB, i.settings)
  const actual = actualPerformance(myGames, i.settings)
  const s = i.settings
  const p = !!i.preview
  const change = (d: number) => (p ? `would ${d > 0 ? 'gain' : 'lose'}` : d > 0 ? 'gains' : 'loses')

  const lines: string[] = []
  lines.push(
    p
      ? `From the level gap (${fmtLevel(myLevel)} vs ${fmtLevel(theirLevel)}), ${me} is expected to win ${pct(expected)} of this match; with this score they win ${pct(actual)}.`
      : `From the level gap (${fmtLevel(myLevel)} vs ${fmtLevel(theirLevel)}), ${me} was expected to win ${pct(expected)} of this match and actually won ${pct(actual)}.`,
  )
  lines.push(
    `“Won” blends points and games: ${me} took ${pct(pointsRatio(myGames))} of the points and ${pct(gamesRatio(myGames))} of the games, weighted ${pct(s.pointsWeight)} / ${pct(1 - s.pointsWeight)}.`,
  )

  const moved = (d: number) => Math.abs(d) >= 0.5
  if (!moved(myDelta) && !moved(theirDelta)) {
    lines.push(`That ${p ? 'is' : 'was'} close enough to the prediction that neither level ${p ? 'changes' : 'changed'}.`)
  } else {
    const verdict = actual > expected ? 'Better than predicted' : 'Worse than predicted'
    const parts: string[] = []
    if (moved(myDelta)) parts.push(`${me} ${change(myDelta)} ${pts(myDelta)}`)
    if (moved(theirDelta)) parts.push(`${them} ${change(theirDelta)} ${pts(theirDelta)}`)
    lines.push(`${verdict}, so ${parts.join(' and ')}.`)
  }

  const scale = MATCH_TYPES.map((t) => `${MATCH_TYPE_LABEL[t].toLowerCase()} ×${MATCH_TYPE_WEIGHT[t]}`).join(', ')
  lines.push(`${MATCH_TYPE_LABEL[i.type]} matches count ×${MATCH_TYPE_WEIGHT[i.type]} (${scale}); bigger occasions move levels more.`)

  if (i.provisionalA !== i.provisionalB) {
    const newcomer = i.provisionalA ? i.nameA : i.nameB
    const settled = i.provisionalA ? i.nameB : i.nameA
    lines.push(
      `${newcomer} ${p ? 'is' : 'was'} provisional (fewer than ${s.provisionalThreshold} rated matches), so only ${newcomer}’s level ${p ? 'moves' : 'moved'} — ${settled}’s is protected until ${newcomer} settles in.`,
    )
  } else if (i.provisionalA && i.provisionalB) {
    lines.push(`Both players ${p ? 'are' : 'were'} provisional, so both levels ${p ? 'move' : 'moved'} freely.`)
  }

  return { expected, actual, lines }
}
