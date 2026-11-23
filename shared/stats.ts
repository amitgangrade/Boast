import type { Match, Player } from './api'
import { gamesWon } from './rating'
import { ageFromBirthYear } from './util'

/** Players who haven't played (or joined) within this many days drop off the default leaderboard. */
export const ACTIVE_DAYS = 365

const daysAgoIso = (days: number, now = Date.now()) => new Date(now - days * 86_400_000).toISOString().slice(0, 10)

/** Active = a confirmed match in the last year, or joined in the last year. */
export function isActive(p: Pick<Player, 'lastPlayed' | 'createdAt'>, now = Date.now()): boolean {
  const since = daysAgoIso(ACTIVE_DAYS, now)
  return (p.lastPlayed ?? p.createdAt.slice(0, 10)) >= since
}

export const AGE_GROUPS = [
  { value: 'u19', label: 'Under 19', test: (age: number) => age < 19 },
  { value: '35', label: '35+', test: (age: number) => age >= 35 },
  { value: '45', label: '45+', test: (age: number) => age >= 45 },
  { value: '55', label: '55+', test: (age: number) => age >= 55 },
  { value: '65', label: '65+', test: (age: number) => age >= 65 },
] as const

/** False when the player hasn't given a birth year, so age filters leave them out. */
export function inAgeGroup(p: Pick<Player, 'birthYear'>, group: string): boolean {
  const g = AGE_GROUPS.find((x) => x.value === group)
  if (!g) return true
  const age = ageFromBirthYear(p.birthYear)
  return age != null && g.test(age)
}

export type Result = 'W' | 'L' | 'D'
export interface FormEntry {
  match: Match
  result: Result
  /** The opponent's level going into the match, when it was rated. */
  opponentLevel: number | null
  opponentId: string
}

const newestFirst = (x: Match, y: Match) => y.date.localeCompare(x.date) || y.createdAt.localeCompare(x.createdAt) || y.id.localeCompare(x.id)

/** The player's confirmed results, newest first. */
export function resultsFor(playerId: string, matches: Match[]): FormEntry[] {
  return matches
    .filter((m) => m.status === 'confirmed' && (m.playerAId === playerId || m.playerBId === playerId))
    .sort(newestFirst)
    .map((m) => {
      const side = m.playerAId === playerId ? 'a' : 'b'
      const mine = gamesWon(m.games, side)
      const theirs = gamesWon(m.games, side === 'a' ? 'b' : 'a')
      return {
        match: m,
        result: mine > theirs ? 'W' : mine < theirs ? 'L' : 'D',
        opponentLevel: side === 'a' ? m.levelBBefore : m.levelABefore,
        opponentId: side === 'a' ? m.playerBId : m.playerAId,
      }
    })
}

/** Current run of wins or losses (a draw ends it). */
export function currentStreak(entries: FormEntry[]): { result: 'W' | 'L'; length: number } | null {
  const first = entries[0]?.result
  if (!first || first === 'D') return null
  let n = 0
  while (n < entries.length && entries[n].result === first) n++
  return { result: first, length: n }
}

/** The win against the highest-rated opponent (rated matches only). */
export function bestWin(entries: FormEntry[]): FormEntry | null {
  let best: FormEntry | null = null
  for (const e of entries) {
    if (e.result !== 'W' || e.match.unranked || e.opponentLevel == null) continue
    if (!best || e.opponentLevel > best.opponentLevel!) best = e
  }
  return best
}

/** Each player's current winning streak within these matches (any order). */
export function winStreaks(matches: Match[]): Map<string, number> {
  const streak = new Map<string, number>()
  const settled = new Set<string>()
  for (const m of matches.filter((x) => x.status === 'confirmed').sort(newestFirst)) {
    const a = gamesWon(m.games, 'a')
    const b = gamesWon(m.games, 'b')
    for (const [id, won] of [[m.playerAId, a > b], [m.playerBId, b > a]] as const) {
      if (settled.has(id)) continue
      if (won) streak.set(id, (streak.get(id) ?? 0) + 1)
      else settled.add(id)
    }
  }
  return streak
}

/** Peak of a level history, and the change since `days` ago. */
export function levelHighlights(points: Array<{ t: number; level: number }>, days = 30, now = Date.now()) {
  if (points.length === 0) return { peak: null, peakAt: null, change: null }
  let peak = points[0]
  for (const p of points) if (p.level >= peak.level) peak = p
  const cutoff = now - days * 86_400_000
  let then: number | null = null
  for (const p of points) if (p.t <= cutoff) then = p.level
  const current = points[points.length - 1].level
  return { peak: peak.level, peakAt: peak.t, change: then == null ? null : current - then }
}
