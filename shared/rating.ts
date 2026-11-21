export type MatchType = 'friendly' | 'box' | 'league' | 'tournament'

export interface Game {
  a: number
  b: number
}

export interface Settings {
  dampingK: number
  pointsWeight: number
  pointsExponent: number
  gamesExponent: number
  provisionalThreshold: number
  movingAverageWindow: number
}

export const DEFAULT_SETTINGS: Settings = {
  dampingK: 0.12,
  pointsWeight: 0.5,
  pointsExponent: 2,
  gamesExponent: 5,
  provisionalThreshold: 5,
  movingAverageWindow: 4,
}

export const MATCH_TYPES: readonly MatchType[] = ['friendly', 'box', 'league', 'tournament']

export const MATCH_TYPE_WEIGHT: Record<MatchType, number> = {
  friendly: 0.7,
  box: 1.0,
  league: 1.3,
  tournament: 1.6,
}

export const MATCH_TYPE_LABEL: Record<MatchType, string> = {
  friendly: 'Friendly',
  box: 'Box league',
  league: 'League',
  tournament: 'Tournament',
}

export const DEFAULT_STARTING_LEVEL = 1000

export function isProvisional(
  p: { matchesPlayed: number; seededRating: boolean },
  settings: Pick<Settings, 'provisionalThreshold'>,
): boolean {
  return !p.seededRating && p.matchesPlayed < settings.provisionalThreshold
}

export function gamesWon(games: Game[], side: 'a' | 'b'): number {
  return games.filter((g) => (side === 'a' ? g.a > g.b : g.b > g.a)).length
}

export function winnerSide(games: Game[]): 'a' | 'b' | null {
  const a = gamesWon(games, 'a')
  const b = gamesWon(games, 'b')
  return a === b ? null : a > b ? 'a' : 'b'
}

export function pointsRatio(games: Game[]): number {
  let a = 0
  let total = 0
  for (const g of games) {
    a += g.a
    total += g.a + g.b
  }
  return total === 0 ? 0.5 : a / total
}

export function gamesRatio(games: Game[]): number {
  const decisive = games.filter((g) => g.a !== g.b)
  if (decisive.length === 0) return 0.5
  return decisive.filter((g) => g.a > g.b).length / decisive.length
}

const sigmoid = (ratio: number, exponent: number) => {
  const p = Math.pow(ratio, exponent)
  return p / (p + 1)
}

export function expectedPerformance(levelA: number, levelB: number, s: Settings): number {
  const r = levelA / levelB
  return s.pointsWeight * sigmoid(r, s.pointsExponent) + (1 - s.pointsWeight) * sigmoid(r, s.gamesExponent)
}

export function actualPerformance(games: Game[], s: Settings): number {
  return s.pointsWeight * pointsRatio(games) + (1 - s.pointsWeight) * gamesRatio(games)
}

export interface LevelUpdate {
  levelAAfter: number
  levelBAfter: number
  deltaA: number
  deltaB: number
  expected: number
  actual: number
}

export function updateLevels(input: {
  levelA: number
  levelB: number
  games: Game[]
  type: MatchType
  provisionalA: boolean
  provisionalB: boolean
  settings: Settings
}): LevelUpdate {
  const { levelA, levelB, games, type, provisionalA, provisionalB, settings } = input
  const expected = expectedPerformance(levelA, levelB, settings)
  const actual = actualPerformance(games, settings)
  const change = settings.dampingK * MATCH_TYPE_WEIGHT[type] * (actual - expected)
  let a = levelA * (1 + change)
  let b = levelB * (1 - change)
  // An established player is shielded from a provisional newcomer's noise.
  if (provisionalA && !provisionalB) b = levelB
  if (provisionalB && !provisionalA) a = levelA
  a = Math.max(1, a)
  b = Math.max(1, b)
  return { levelAAfter: a, levelBAfter: b, deltaA: a - levelA, deltaB: b - levelB, expected, actual }
}

export interface RatingPlayer {
  id: string
  startingLevel: number
  seededRating: boolean
}

export interface RatingMatch {
  id: string
  date: string
  playerAId: string
  playerBId: string
  games: Game[]
  type: MatchType
  unranked: boolean
  /** Orders matches played on the same date: earlier-recorded first. */
  createdAt?: string
}

export interface MatchLevels {
  levelABefore: number
  levelBBefore: number
  levelAAfter: number
  levelBAfter: number
  deltaA: number
  deltaB: number
  provisionalA: boolean
  provisionalB: boolean
}

export interface PlayerLevelState {
  currentLevel: number
  matchesPlayed: number
}

/**
 * Replays every rated match in (date, recorded-at, id) order from each player's starting
 * level. This is the single source of truth for levels: the server persists
 * its output and never updates levels any other way.
 */
export function recomputeAll(
  players: RatingPlayer[],
  matches: RatingMatch[],
  settings: Settings,
): { players: Map<string, PlayerLevelState>; matches: Map<string, MatchLevels> } {
  const state = new Map<string, PlayerLevelState & { seeded: boolean }>()
  for (const p of players) {
    state.set(p.id, { currentLevel: p.startingLevel, matchesPlayed: 0, seeded: p.seededRating })
  }
  const sorted = [...matches].sort(
    (x, y) => x.date.localeCompare(y.date) || (x.createdAt ?? '').localeCompare(y.createdAt ?? '') || x.id.localeCompare(y.id),
  )
  const out = new Map<string, MatchLevels>()
  for (const m of sorted) {
    const a = state.get(m.playerAId)
    const b = state.get(m.playerBId)
    if (!a || !b) continue
    const provisionalA = isProvisional({ matchesPlayed: a.matchesPlayed, seededRating: a.seeded }, settings)
    const provisionalB = isProvisional({ matchesPlayed: b.matchesPlayed, seededRating: b.seeded }, settings)
    if (m.unranked) {
      out.set(m.id, {
        levelABefore: a.currentLevel,
        levelBBefore: b.currentLevel,
        levelAAfter: a.currentLevel,
        levelBAfter: b.currentLevel,
        deltaA: 0,
        deltaB: 0,
        provisionalA,
        provisionalB,
      })
      continue
    }
    const u = updateLevels({
      levelA: a.currentLevel,
      levelB: b.currentLevel,
      games: m.games,
      type: m.type,
      provisionalA,
      provisionalB,
      settings,
    })
    out.set(m.id, {
      levelABefore: a.currentLevel,
      levelBBefore: b.currentLevel,
      levelAAfter: u.levelAAfter,
      levelBAfter: u.levelBAfter,
      deltaA: u.deltaA,
      deltaB: u.deltaB,
      provisionalA,
      provisionalB,
    })
    a.currentLevel = u.levelAAfter
    b.currentLevel = u.levelBAfter
    a.matchesPlayed += 1
    b.matchesPlayed += 1
  }
  const playersOut = new Map<string, PlayerLevelState>()
  for (const [id, s] of state) playersOut.set(id, { currentLevel: s.currentLevel, matchesPlayed: s.matchesPlayed })
  return { players: playersOut, matches: out }
}

export function movingAverage(levels: number[], window: number): number {
  if (levels.length === 0) return 0
  const slice = levels.slice(-window)
  return slice.reduce((s, l) => s + l, 0) / slice.length
}
