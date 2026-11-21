import type { Context } from 'hono'
import type { z } from 'zod'
import type { Challenge, Match, Player } from '../shared/api'
import type { Game, MatchType } from '../shared/rating'
import type { Gender, Hand } from '../shared/util'
import type { Viewer } from './perms'

export type AppEnv = { Bindings: Env; Variables: { viewer: Viewer | null } }
export type Ctx = Context<AppEnv>

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 500,
    message: string,
  ) {
    super(message)
  }
}

export const bad = (msg: string) => new HttpError(400, msg)
export const forbidden = (msg = 'Not allowed') => new HttpError(403, msg)
export const notFound = (msg = 'Not found') => new HttpError(404, msg)

export const nowIso = () => new Date().toISOString()
export const uuid = () => crypto.randomUUID()

export async function body<T extends z.ZodTypeAny>(c: Ctx, schema: T): Promise<z.output<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw bad('Request body must be JSON')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw bad(parsed.error.issues[0]?.message ?? 'Invalid request')
  return parsed.data
}

export function requireViewer(c: Ctx): Viewer {
  const v = c.get('viewer')
  if (!v) throw new HttpError(401, 'Sign in first')
  return v
}

export function requireAdmin(c: Ctx): Viewer {
  const v = requireViewer(c)
  if (!v.isAdmin) throw forbidden('Admins only')
  return v
}

/** Runs statements in D1 batches (each batch is one transaction). */
export async function runBatch(db: D1Database, stmts: D1PreparedStatement[], size = 50) {
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size))
  }
}

// ---------------------------------------------------------------------------
// Rows → API objects
// ---------------------------------------------------------------------------

export interface PlayerRow {
  id: string
  user_id: string | null
  username: string | null
  name: string
  email: string | null
  email_norm: string | null
  phone: string | null
  country: string | null
  city: string | null
  club: string | null
  club_slug: string | null
  avatar_url: string | null
  birth_year: number | null
  gender: string | null
  dominant_hand: string | null
  notes: string | null
  starting_level: number
  seeded_rating: number
  current_level: number | null
  matches_played: number
  created_by: string | null
  created_at: string
}

export function toPlayer(r: PlayerRow, withContact: boolean): Player {
  const p: Player = {
    id: r.id,
    name: r.name,
    username: r.username,
    claimed: r.user_id != null,
    startingLevel: r.starting_level,
    seededRating: !!r.seeded_rating,
    currentLevel: r.current_level ?? r.starting_level,
    matchesPlayed: r.matches_played,
    club: r.club,
    clubSlug: r.club_slug,
    city: r.city,
    country: r.country,
    avatarUrl: r.avatar_url,
    birthYear: r.birth_year,
    gender: r.gender as Gender | null,
    dominantHand: r.dominant_hand as Hand | null,
    createdAt: r.created_at,
  }
  if (withContact) {
    p.email = r.email
    p.phone = r.phone
    p.notes = r.notes
  }
  return p
}

export interface MatchRow {
  id: string
  date: string
  player_a_id: string
  player_b_id: string
  games: string
  type: string
  venue: string | null
  notes: string | null
  status: string
  unranked: number
  auto_confirmed: number
  confirmed_at: string | null
  disputed_at: string | null
  created_by: string | null
  created_at: string
  level_a_before: number | null
  level_b_before: number | null
  level_a_after: number | null
  level_b_after: number | null
  delta_a: number | null
  delta_b: number | null
  provisional_a: number | null
  provisional_b: number | null
}

const boolOrNull = (n: number | null) => (n == null ? null : !!n)

export function toMatch(r: MatchRow): Match {
  return {
    id: r.id,
    date: r.date,
    playerAId: r.player_a_id,
    playerBId: r.player_b_id,
    games: JSON.parse(r.games) as Game[],
    type: r.type as MatchType,
    venue: r.venue,
    notes: r.notes,
    status: r.status as Match['status'],
    unranked: !!r.unranked,
    autoConfirmed: !!r.auto_confirmed,
    confirmedAt: r.confirmed_at,
    disputedAt: r.disputed_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    levelABefore: r.level_a_before,
    levelBBefore: r.level_b_before,
    levelAAfter: r.level_a_after,
    levelBAfter: r.level_b_after,
    deltaA: r.delta_a,
    deltaB: r.delta_b,
    provisionalA: boolOrNull(r.provisional_a),
    provisionalB: boolOrNull(r.provisional_b),
  }
}

export interface ChallengeRow {
  id: string
  from_player_id: string
  to_player_id: string
  message: string | null
  proposed_date: string | null
  venue: string | null
  status: string
  created_by: string | null
  created_at: string
  responded_at: string | null
}

export function toChallenge(r: ChallengeRow): Challenge {
  return {
    id: r.id,
    fromPlayerId: r.from_player_id,
    toPlayerId: r.to_player_id,
    message: r.message,
    proposedDate: r.proposed_date,
    venue: r.venue,
    status: r.status as Challenge['status'],
    createdAt: r.created_at,
    respondedAt: r.responded_at,
  }
}

export async function getPlayer(db: D1Database, id: string): Promise<PlayerRow | null> {
  return db.prepare('SELECT * FROM players WHERE id = ?').bind(id).first<PlayerRow>()
}

export async function getMatch(db: D1Database, id: string): Promise<MatchRow | null> {
  return db.prepare('SELECT * FROM matches WHERE id = ?').bind(id).first<MatchRow>()
}

/** Picks `base`, `base-2`, `base-3`… — whichever isn't taken by another player. */
export async function uniqueUsername(db: D1Database, name: string, exceptPlayerId?: string): Promise<string> {
  const base =
    name
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'player'
  const { results } = await db
    .prepare("SELECT username FROM players WHERE (username = ?1 OR username LIKE ?1 || '-%') AND id IS NOT ?2")
    .bind(base, exceptPlayerId ?? null)
    .all<{ username: string }>()
  const taken = new Set(results.map((r) => r.username))
  if (!taken.has(base) && !/^[0-9a-f]{8}-/.test(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}
