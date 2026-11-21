import { Hono } from 'hono'
import { type Me, OnboardingInput, PlayerCreateInput, PlayerUpdateInput, ProfileInput } from '../../shared/api'
import { DEFAULT_STARTING_LEVEL } from '../../shared/rating'
import { isGoogleMail, normEmail, parseLocation, slugify, validBirthYear } from '../../shared/util'
import { auditStmt, diff } from '../audit'
import {
  type AppEnv,
  bad,
  body,
  forbidden,
  getPlayer,
  HttpError,
  notFound,
  type PlayerRow,
  requireAdmin,
  requireViewer,
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
  }
}

playerRoutes.get('/me', (c) => {
  const v = c.get('viewer')
  return c.json(v ? meResponse(v, c.env) : null)
})

playerRoutes.get('/players', async (c) => {
  const v = c.get('viewer')
  const { results } = await c.env.DB.prepare('SELECT * FROM players ORDER BY current_level DESC, name').all<PlayerRow>()
  return c.json(results.map((r) => toPlayer(r, canSeeContact(v, r))))
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
 * when they first sign in. Re-using an email returns the existing player.
 */
playerRoutes.post('/players', async (c) => {
  const v = requireViewer(c)
  const input = await body(c, PlayerCreateInput)
  const db = c.env.DB
  const existing = await db.prepare('SELECT * FROM players WHERE lower(email) = ?').bind(input.email).first<PlayerRow>()
  if (existing) return c.json({ player: toPlayer(existing, canSeeContact(v, existing)), existed: true })
  if (!isGoogleMail(input.email)) {
    throw bad('Email must be @gmail.com or @googlemail.com — Boast signs in with Google, so that is how they will claim this player')
  }
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
    if (!isGoogleMail(input.email) && input.email !== before.email?.toLowerCase()) {
      throw bad('Email must be @gmail.com or @googlemail.com')
    }
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
