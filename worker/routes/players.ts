import { Hono } from 'hono'
import { type Me, NotificationPrefsInput, OnboardingInput, PlayerCreateInput, PlayerUpdateInput, ProfileInput, type UnsubscribeInfo } from '../../shared/api'
import { DEFAULT_STARTING_LEVEL } from '../../shared/rating'
import { normEmail, parseLocation, slugify, validBirthYear } from '../../shared/util'
import { auditStmt, diff } from '../audit'
import { cachedDirectory } from '../cache'
import { z } from 'zod'
import {
  type AppEnv,
  bad,
  body,
  forbidden,
  getPlayer,
  HttpError,
  type MatchRow,
  notFound,
  nowIso,
  type PlayerRow,
  requireAdmin,
  requireViewer,
  toMatch,
  toPlayer,
  uniqueUsername,
  uuid,
} from '../lib'
import { recomputeLevels } from '../levels'
import { canEditPlayer, canSeeContact, type Viewer } from '../perms'

export const playerRoutes = new Hono<AppEnv>()

function identity(input: {
  phone: string | null
  country: string
  city: string
  club: string | null
  birthYear: number | null
  gender: string | null
  dominantHand: string | null
}) {
  const loc = parseLocation(input)
  if (!loc.ok) throw bad(loc.error)
  if (input.birthYear != null && !validBirthYear(input.birthYear)) throw bad('Year of birth looks wrong')
  return {
    phone: input.phone,
    country: loc.value.country,
    city: loc.value.city,
    club: input.club,
    club_slug: slugify(input.club) || null,
    birth_year: input.birthYear,
    gender: input.gender,
    dominant_hand: input.dominantHand,
  }
}

export function meResponse(v: Viewer, env: Env): Me {
  const scope: Record<string, string[]> = {}
  for (const [g, members] of v.groupAdminScope) scope[g] = [...members]
  return {
    user: { id: v.userId, email: v.email, isAdmin: v.isAdmin },
    player: v.player ? toPlayer(v.player, true) : null,
    clubAdminSlugs: [...v.clubAdminSlugs],
    groupAdminScope: scope,
    ownerHint: !!env.OWNER_EMAIL && normEmail(env.OWNER_EMAIL) === normEmail(v.email),
    notifications: v.player ? prefsOf(v.player) : null,
  }
}

const prefsOf = (p: PlayerRow) => ({
  matches: p.notify_matches !== 0,
  challenges: p.notify_challenges !== 0,
  reminders: p.notify_reminders !== 0,
  digest: p.notify_digest !== 0,
  leagues: p.notify_leagues !== 0,
})

playerRoutes.get('/me', (c) => {
  const v = c.get('viewer')
  return c.json(v ? meResponse(v, c.env) : null)
})

playerRoutes.get('/players', async (c) => {
  const v = c.get('viewer')
  const rows = await cachedDirectory(c.env.DB, 'players', async () => {
    const { results } = await c.env.DB.prepare('SELECT * FROM players ORDER BY current_level DESC, name').all<PlayerRow>()
    return results
  })
  return c.json(rows.map((r) => toPlayer(r, canSeeContact(v, r))))
})

playerRoutes.get('/players/:key', async (c) => {
  const key = c.req.param('key')
  const row = await c.env.DB.prepare('SELECT * FROM players WHERE id = ?1 OR username = ?1').bind(key).first<PlayerRow>()
  if (!row) throw notFound('Player not found')
  return c.json(toPlayer(row, canSeeContact(c.get('viewer'), row)))
})

/**
 * Creates a placeholder ("unclaimed") player, e.g. an opponent who isn't on
 * Boast yet. Email is required: it's how the real person claims the record
 * when they first sign in (with Google, or an email link for any address).
 * Re-using an email returns the existing player.
 */
playerRoutes.post('/players', async (c) => {
  const v = requireViewer(c)
  const input = await body(c, PlayerCreateInput)
  const db = c.env.DB
  const existing = await db.prepare('SELECT * FROM players WHERE lower(email) = ?').bind(input.email).first<PlayerRow>()
  if (existing) return c.json({ player: toPlayer(existing, canSeeContact(v, existing)), existed: true })
  const fields = identity(input)
  if (!v.isAdmin && v.clubAdminSlugs.size === 0 && !v.player) throw forbidden('Finish setting up your profile first')
  let startingLevel = DEFAULT_STARTING_LEVEL
  if (input.ratingKnown) {
    if (!input.startingLevel) throw bad("Enter the player's known rating")
    startingLevel = input.startingLevel
  }
  const id = uuid()
  const row = {
    id,
    name: input.name,
    email: input.email,
    email_norm: normEmail(input.email),
    notes: input.notes,
    starting_level: startingLevel,
    seeded_rating: input.ratingKnown ? 1 : 0,
    current_level: startingLevel,
    created_by: v.userId,
    ...fields,
  }
  const cols = Object.keys(row)
  await db.batch([
    db
      .prepare(`INSERT INTO players (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .bind(...Object.values(row)),
    auditStmt(db, v, {
      entityType: 'players',
      entityId: id,
      op: 'insert',
      summary: `Added player ${input.name}`,
      changed: row,
      players: [id],
      clubs: [row.club_slug],
    }),
  ])
  const created = (await getPlayer(db, id))!
  return c.json({ player: toPlayer(created, true), existed: false }, 201)
})

playerRoutes.patch('/players/:id', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const before = await getPlayer(db, c.req.param('id'))
  if (!before) throw notFound('Player not found')
  if (!canEditPlayer(v, before)) throw forbidden()
  const input = await body(c, PlayerUpdateInput)
  const next: Record<string, unknown> = {
    name: input.name,
    notes: input.notes,
    starting_level: input.startingLevel,
    seeded_rating: input.seededRating ? 1 : 0,
    ...identity(input),
  }
  // A claimed player's email is their Google account; it can't be reassigned.
  if (!before.user_id && input.email) {
    next.email = input.email
    next.email_norm = normEmail(input.email)
  }
  if (input.createdAt) {
    if (!v.isAdmin) throw forbidden('Only global admins can change when a player joined')
    next.created_at = `${input.createdAt}T00:00:00.000Z`
  }
  const changes = diff(before as unknown as Record<string, unknown>, next)
  if (Object.keys(changes).length === 0) return c.json(toPlayer(before, true))
  const sets = Object.keys(next)
  try {
    await db.batch([
      db
        .prepare(`UPDATE players SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .bind(...Object.values(next), before.id),
      auditStmt(db, v, {
        entityType: 'players',
        entityId: before.id,
        op: 'update',
        summary: `Edited player ${input.name}`,
        changed: changes,
        players: [before.id],
        clubs: [before.club_slug, next.club_slug as string | null],
      }),
    ])
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new HttpError(409, `A player already exists with the email ${input.email}`)
    throw e
  }
  if ('starting_level' in changes || 'seeded_rating' in changes || 'created_at' in changes) await recomputeLevels(db)
  return c.json(toPlayer((await getPlayer(db, before.id))!, true))
})

/**
 * Global admins only. Soft delete removes the account but keeps the player
 * (and all history) as an unclaimed record the person can reclaim by signing
 * in again. Hard delete removes the player and every match they played.
 */
playerRoutes.delete('/players/:id', async (c) => {
  const v = requireAdmin(c)
  const db = c.env.DB
  const p = await getPlayer(db, c.req.param('id'))
  if (!p) throw notFound('Player not found')
  if (p.user_id && p.user_id === v.userId) throw bad('You cannot delete yourself')
  const mode = c.req.query('mode') === 'hard' ? 'hard' : 'soft'
  const audit = (summary: string) =>
    auditStmt(db, v, {
      entityType: 'players',
      entityId: p.id,
      op: 'delete',
      summary,
      changed: p,
      players: [p.id],
      clubs: [p.club_slug],
    })
  if (p.user_id && mode === 'soft') {
    await db.batch([
      db.prepare('UPDATE players SET user_id = NULL, username = NULL WHERE id = ?').bind(p.id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(p.user_id),
      audit(`Removed ${p.name}'s account (player kept as unclaimed)`),
    ])
    return c.json({ ok: true })
  }
  const stmts = [db.prepare('DELETE FROM players WHERE id = ?').bind(p.id)]
  if (p.user_id) stmts.push(db.prepare('DELETE FROM users WHERE id = ?').bind(p.user_id))
  await db.batch([...stmts, audit(`Deleted player ${p.name} and their matches`)])
  await recomputeLevels(db)
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// The signed-in user's own player
// ---------------------------------------------------------------------------

playerRoutes.get('/onboarding/suggestion', async (c) => {
  const v = requireViewer(c)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM players WHERE user_id IS NULL AND email_norm = ? ORDER BY created_at LIMIT 5',
  )
    .bind(normEmail(v.email))
    .all<PlayerRow>()
  return c.json(results.map((r) => toPlayer(r, true)))
})

/**
 * Creates the user's player, or claims the placeholder with their email. The
 * claimed placeholder keeps its id, history and created_at; the user's own
 * answers win, and the placeholder's details fill anything they left blank.
 */
playerRoutes.post('/onboarding', async (c) => {
  const v = requireViewer(c)
  if (v.player) throw new HttpError(409, 'Your profile already exists')
  const input = await body(c, OnboardingInput)
  const db = c.env.DB
  const fields = identity(input)
  const seeded = input.ratingSource !== 'none'
  let startingLevel = DEFAULT_STARTING_LEVEL
  if (seeded) {
    if (!input.startingLevel) throw bad('Enter your starting rating, or pick "I don\'t have a rating yet"')
    startingLevel = input.startingLevel
  }
  const stub = await db
    .prepare('SELECT * FROM players WHERE user_id IS NULL AND email_norm = ? ORDER BY created_at LIMIT 1')
    .bind(normEmail(v.email))
    .first<PlayerRow>()
  if (stub) {
    const username = await uniqueUsername(db, input.fullName, stub.id)
    const merged = {
      user_id: v.userId,
      username,
      name: input.fullName,
      email: v.email,
      email_norm: normEmail(v.email),
      starting_level: startingLevel,
      seeded_rating: seeded ? 1 : 0,
      phone: fields.phone ?? stub.phone,
      country: fields.country,
      city: fields.city,
      club: fields.club ?? stub.club,
      club_slug: fields.club ? fields.club_slug : stub.club_slug,
      birth_year: fields.birth_year ?? stub.birth_year,
      gender: fields.gender ?? stub.gender,
      dominant_hand: fields.dominant_hand ?? stub.dominant_hand,
    }
    await db.batch([
      db
        .prepare(`UPDATE players SET ${Object.keys(merged).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .bind(...Object.values(merged), stub.id),
      auditStmt(db, v, {
        entityType: 'players',
        entityId: stub.id,
        op: 'update',
        summary: `${input.fullName} signed up and claimed their player`,
        changed: diff(stub as unknown as Record<string, unknown>, merged),
        players: [stub.id],
        clubs: [merged.club_slug, stub.club_slug],
      }),
    ])
    await recomputeLevels(db)
  } else {
    const id = uuid()
    const row = {
      id,
      user_id: v.userId,
      username: await uniqueUsername(db, input.fullName),
      name: input.fullName,
      email: v.email,
      email_norm: normEmail(v.email),
      starting_level: startingLevel,
      seeded_rating: seeded ? 1 : 0,
      current_level: startingLevel,
      created_by: v.userId,
      ...fields,
    }
    const cols = Object.keys(row)
    await db.batch([
      db
        .prepare(`INSERT INTO players (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .bind(...Object.values(row)),
      auditStmt(db, v, {
        entityType: 'players',
        entityId: id,
        op: 'insert',
        summary: `${input.fullName} signed up`,
        changed: row,
        players: [id],
        clubs: [row.club_slug],
      }),
    ])
  }
  v.player = await c.env.DB.prepare('SELECT * FROM players WHERE user_id = ?').bind(v.userId).first<PlayerRow>()
  return c.json(meResponse(v, c.env))
})

playerRoutes.patch('/me/profile', async (c) => {
  const v = requireViewer(c)
  const before = v.player
  if (!before) throw bad('Finish setting up your profile first')
  const input = await body(c, ProfileInput)
  const db = c.env.DB
  const next = { name: input.fullName, ...identity(input) }
  const changes = diff(before as unknown as Record<string, unknown>, next)
  if (Object.keys(changes).length > 0) {
    await db.batch([
      db
        .prepare(`UPDATE players SET ${Object.keys(next).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .bind(...Object.values(next), before.id),
      auditStmt(db, v, {
        entityType: 'players',
        entityId: before.id,
        op: 'update',
        summary: `${next.name} edited their profile`,
        changed: changes,
        players: [before.id],
        clubs: [before.club_slug, next.club_slug],
      }),
    ])
  }
  v.player = (await getPlayer(db, before.id))!
  return c.json(meResponse(v, c.env))
})

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

playerRoutes.put('/me/avatar', async (c) => {
  const v = requireViewer(c)
  if (!v.player) throw bad('Finish setting up your profile first')
  const type = c.req.header('content-type') ?? ''
  if (!AVATAR_TYPES.includes(type)) throw bad('Photo must be a JPEG, PNG or WebP image')
  const bytes = await c.req.arrayBuffer()
  if (bytes.byteLength > MAX_AVATAR_BYTES) throw new HttpError(413, 'Photo must be 1 MB or smaller')
  const url = await storeAvatar(c.env.DB, v.player.id, bytes, type)
  await removeOwnedAvatar(c.env.DB, v.player.avatar_url)
  await c.env.DB.prepare('UPDATE players SET avatar_url = ? WHERE id = ?').bind(url, v.player.id).run()
  v.player.avatar_url = url
  return c.json(meResponse(v, c.env))
})

playerRoutes.delete('/me/avatar', async (c) => {
  const v = requireViewer(c)
  if (!v.player) throw bad('No profile')
  await removeOwnedAvatar(c.env.DB, v.player.avatar_url)
  await c.env.DB.prepare('UPDATE players SET avatar_url = NULL WHERE id = ?').bind(v.player.id).run()
  v.player.avatar_url = null
  return c.json(meResponse(v, c.env))
})

playerRoutes.get('/avatars/:key', async (c) => {
  const row = await c.env.DB.prepare('SELECT content_type, bytes FROM avatars WHERE key = ?')
    .bind(c.req.param('key'))
    .first<{ content_type: string; bytes: number[] | ArrayBuffer }>()
  if (!row) throw notFound()
  return new Response(new Uint8Array(row.bytes as ArrayBuffer), {
    headers: {
      'content-type': row.content_type,
      // Each upload gets a fresh random key, so the bytes behind a URL never change.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})

export const MAX_AVATAR_BYTES = 1_000_000

export async function storeAvatar(db: D1Database, playerId: string, bytes: ArrayBuffer, type: string): Promise<string> {
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'
  const key = `${crypto.randomUUID()}.${ext}`
  await db.prepare('INSERT INTO avatars (key, player_id, content_type, bytes) VALUES (?, ?, ?, ?)').bind(key, playerId, type, bytes).run()
  return `/api/avatars/${key}`
}

async function removeOwnedAvatar(db: D1Database, url: string | null) {
  if (url?.startsWith('/api/avatars/')) await db.prepare('DELETE FROM avatars WHERE key = ?').bind(url.slice('/api/avatars/'.length)).run()
}

// ---------------------------------------------------------------------------
// Email preferences and unsubscribe links
// ---------------------------------------------------------------------------

playerRoutes.patch('/me/notifications', async (c) => {
  const v = requireViewer(c)
  const before = v.player
  if (!before) throw bad('Finish setting up your profile first')
  const input = await body(c, NotificationPrefsInput)
  const next = {
    notify_matches: +input.matches,
    notify_challenges: +input.challenges,
    notify_reminders: +input.reminders,
    notify_digest: +input.digest,
    notify_leagues: +input.leagues,
  }
  const changes = diff(before as unknown as Record<string, unknown>, next)
  if (Object.keys(changes).length > 0) {
    const db = c.env.DB
    await db.batch([
      db.prepare(`UPDATE players SET ${Object.keys(next).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(next), before.id),
      auditStmt(db, v, {
        entityType: 'players',
        entityId: before.id,
        op: 'update',
        summary: `${before.name} changed their email settings`,
        changed: changes,
        players: [before.id],
      }),
    ])
    Object.assign(before, next)
  }
  return c.json(meResponse(v, c.env))
})

const UNSUB_KINDS = {
  matches: 'notify_matches',
  challenges: 'notify_challenges',
  reminders: 'notify_reminders',
  digest: 'notify_digest',
  leagues: 'notify_leagues',
} as const
type UnsubKind = keyof typeof UNSUB_KINDS

async function playerByToken(db: D1Database, token: string | undefined): Promise<PlayerRow> {
  if (!token || token.length < 16) throw notFound('This unsubscribe link is not valid')
  const p = await db.prepare('SELECT * FROM players WHERE email_token = ?').bind(token).first<PlayerRow>()
  if (!p) throw notFound('This unsubscribe link is not valid')
  return p
}

const unsubInfo = (p: PlayerRow): UnsubscribeInfo => ({ firstName: p.name.split(' ')[0] || p.name, prefs: prefsOf(p) })

/** Turns off one kind of email (or all) for the player owning the token. No sign-in needed. */
async function unsubscribe(db: D1Database, p: PlayerRow, kind: UnsubKind | 'all') {
  const cols = kind === 'all' ? Object.values(UNSUB_KINDS) : [UNSUB_KINDS[kind]]
  await db.batch([
    db.prepare(`UPDATE players SET ${cols.map((col) => `${col} = 0`).join(', ')} WHERE id = ?`).bind(p.id),
    auditStmt(db, null, {
      entityType: 'players',
      entityId: p.id,
      op: 'update',
      summary: `${p.name} unsubscribed from ${kind === 'all' ? 'all emails' : `${kind} emails`} via email link`,
      changed: Object.fromEntries(cols.map((col) => [col, [1, 0]])),
      players: [p.id],
    }),
  ])
  return (await getPlayer(db, p.id))!
}

playerRoutes.get('/unsubscribe', async (c) => c.json(unsubInfo(await playerByToken(c.env.DB, c.req.query('t')))))

playerRoutes.post('/unsubscribe', async (c) => {
  const input = await body(c, z.object({ token: z.string(), kind: z.enum(['matches', 'challenges', 'reminders', 'digest', 'leagues', 'all']) }))
  const p = await playerByToken(c.env.DB, input.token)
  return c.json(unsubInfo(await unsubscribe(c.env.DB, p, input.kind)))
})

/** RFC 8058 one-click unsubscribe, POSTed by mail providers (exempt from the x-boast header check). */
playerRoutes.post('/unsubscribe/one-click', async (c) => {
  const p = await playerByToken(c.env.DB, c.req.query('t'))
  await unsubscribe(c.env.DB, p, 'all')
  return c.text('Unsubscribed')
})

// ---------------------------------------------------------------------------
// Self-service privacy: download my data, delete my account
// ---------------------------------------------------------------------------

playerRoutes.get('/me/export', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const pid = v.player?.id ?? ''
  const [user, matches, challenges, groups, boxes] = await db.batch([
    db.prepare('SELECT id, email, google_name, is_admin, created_at FROM users WHERE id = ?').bind(v.userId),
    db.prepare('SELECT * FROM matches WHERE player_a_id = ?1 OR player_b_id = ?1 ORDER BY date, created_at').bind(pid),
    db.prepare('SELECT * FROM challenges WHERE from_player_id = ?1 OR to_player_id = ?1 ORDER BY created_at').bind(pid),
    db
      .prepare('SELECT g.name, g.slug, m.is_admin, m.added_at FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.player_id = ?')
      .bind(pid),
    db
      .prepare('SELECT r.name, r.starts_on, r.ends_on, e.box, g.name AS group_name FROM box_entries e JOIN box_rounds r ON r.id = e.round_id JOIN groups g ON g.id = r.group_id WHERE e.player_id = ?')
      .bind(pid),
  ])
  const player = v.player ? { ...v.player, email_token: undefined } : null
  const dump = {
    format: 'boast-personal-data',
    exportedAt: nowIso(),
    account: user.results[0] ?? null,
    player,
    matches: (matches.results as MatchRow[]).map(toMatch),
    challenges: challenges.results,
    groups: groups.results,
    boxLeagueRounds: boxes.results,
  }
  return new Response(JSON.stringify(dump, null, 2), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="boast-my-data-${nowIso().slice(0, 10)}.json"`,
    },
  })
})

/**
 * Deletes the signed-in user's account. Their player stays (unclaimed) so opponents'
 * levels and match history don't change, but personal details and the photo are
 * removed and emails stop. Signing in again with the same Google account reclaims it.
 */
playerRoutes.delete('/me', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  if (v.isAdmin) {
    const admins = await db.prepare('SELECT COUNT(*) n FROM users WHERE is_admin = 1').first<{ n: number }>()
    if ((admins?.n ?? 0) <= 1) throw bad('You are the only admin. Make someone else an admin first.')
  }
  const p = v.player
  const stmts: D1PreparedStatement[] = []
  if (p) {
    stmts.push(
      db
        .prepare(
          `UPDATE players SET user_id = NULL, username = NULL, phone = NULL, birth_year = NULL, gender = NULL, dominant_hand = NULL,
             avatar_url = NULL, notify_matches = 0, notify_challenges = 0, notify_reminders = 0, notify_digest = 0, notify_leagues = 0 WHERE id = ?`,
        )
        .bind(p.id),
      db.prepare('DELETE FROM avatars WHERE player_id = ?').bind(p.id),
    )
  }
  stmts.push(
    db.prepare('DELETE FROM users WHERE id = ?').bind(v.userId),
    auditStmt(db, v, {
      entityType: 'players',
      entityId: p?.id ?? v.userId,
      op: 'delete',
      summary: `${p?.name ?? v.email} deleted their account${p ? ' (match history kept as an unclaimed player)' : ''}`,
      changed: p ? { player: p.id } : null,
      players: [p?.id],
      clubs: [p?.club_slug],
    }),
  )
  await db.batch(stmts)
  return c.json({ ok: true })
})
