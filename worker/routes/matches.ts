import { Hono } from 'hono'
import { z } from 'zod'
import { MatchInput, MatchUpdateInput, type Page, type Match } from '../../shared/api'
import { gamesWon } from '../../shared/rating'
import { auditStmt, diff } from '../audit'
import { sendMatchEmail } from '../email'
import {
  type AppEnv,
  bad,
  body,
  forbidden,
  getMatch,
  getPlayer,
  type MatchRow,
  notFound,
  nowIso,
  type PlayerRow,
  requireViewer,
  toMatch,
  uuid,
} from '../lib'
import { recomputeLevels } from '../levels'
import { canWriteMatch, isClubAdminFor, type Viewer } from '../perms'

export const matchRoutes = new Hono<AppEnv>()

const DAY_MS = 86_400_000

/**
 * A match can't predate either player joining (their starting level is their
 * level on that day) and can't be in the future. One day of slack lets
 * players ahead of UTC log today's match.
 */
function validateDate(date: string, a: PlayerRow, b: PlayerRow) {
  const tomorrowUtc = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10)
  if (date > tomorrowUtc) throw bad('Match date is in the future')
  const floor = [a.created_at, b.created_at].map((d) => d.slice(0, 10)).sort().at(-1)!
  if (date < floor) {
    const who = a.created_at.slice(0, 10) === floor ? a : b
    throw bad(`Match date is before ${who.name} joined Boast (${floor})`)
  }
}

function sideOf(v: Viewer, m: { player_a_id: string; player_b_id: string }): 'a' | 'b' | null {
  if (!v.player) return null
  return v.player.id === m.player_a_id ? 'a' : v.player.id === m.player_b_id ? 'b' : null
}

const ListQuery = z.object({
  player: z.string().optional(),
  vs: z.string().optional(),
  club: z.string().optional(),
  group: z.string().optional(),
  status: z.enum(['pending', 'confirmed', 'disputed']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(50),
})

matchRoutes.get('/matches', async (c) => {
  const q = ListQuery.parse(c.req.query())
  const where: string[] = []
  const args: unknown[] = []
  if (q.player) {
    where.push('(m.player_a_id = ? OR m.player_b_id = ?)')
    args.push(q.player, q.player)
  }
  if (q.vs) {
    where.push('(m.player_a_id = ? OR m.player_b_id = ?)')
    args.push(q.vs, q.vs)
  }
  if (q.club) {
    where.push('(pa.club_slug = ? OR pb.club_slug = ?)')
    args.push(q.club, q.club)
  }
  if (q.group) {
    const v = c.get('viewer')
    const g = await c.env.DB.prepare('SELECT is_private FROM groups WHERE id = ?').bind(q.group).first<{ is_private: number }>()
    if (!g) throw notFound('Group not found')
    if (g.is_private && !v?.isAdmin) {
      const member = v?.player
        ? await c.env.DB.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND player_id = ?').bind(q.group, v.player.id).first()
        : null
      if (!member) throw notFound('Group not found')
    }
    where.push(
      `m.player_a_id IN (SELECT player_id FROM group_members WHERE group_id = ?)
       AND m.player_b_id IN (SELECT player_id FROM group_members WHERE group_id = ?)`,
    )
    args.push(q.group, q.group)
  }
  if (q.status) {
    where.push('m.status = ?')
    args.push(q.status)
  }
  if (q.cursor) {
    const [date, createdAt, id] = atob(q.cursor).split('|')
    where.push('(m.date, m.created_at, m.id) < (?, ?, ?)')
    args.push(date, createdAt, id)
  }
  const sql = `SELECT m.* FROM matches m
    JOIN players pa ON pa.id = m.player_a_id JOIN players pb ON pb.id = m.player_b_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.date DESC, m.created_at DESC, m.id DESC LIMIT ?`
  const { results } = await c.env.DB.prepare(sql).bind(...args, q.limit + 1).all<MatchRow>()
  const items = results.slice(0, q.limit).map(toMatch)
  const last = results.length > q.limit ? items[items.length - 1] : null
  const page: Page<Match> = {
    items,
    nextCursor: last ? btoa(`${last.date}|${last.createdAt}|${last.id}`) : null,
  }
  return c.json(page)
})

matchRoutes.get('/matches/:id', async (c) => {
  const m = await getMatch(c.env.DB, c.req.param('id'))
  if (!m) throw notFound('Match not found')
  return c.json(toMatch(m))
})

matchRoutes.post('/matches', async (c) => {
  const v = requireViewer(c)
  const input = await body(c, MatchInput)
  const db = c.env.DB
  if (input.playerAId === input.playerBId) throw bad('Players must be different')
  const [a, b] = await Promise.all([getPlayer(db, input.playerAId), getPlayer(db, input.playerBId)])
  if (!a || !b) throw notFound('Player not found')
  const side = v.player?.id === a.id ? 'a' : v.player?.id === b.id ? 'b' : null
  if (!side && !v.isAdmin && !isClubAdminFor(v, a) && !isClubAdminFor(v, b)) {
    throw forbidden('You can only record matches you played in')
  }
  validateDate(input.date, a, b)
  // Admins are trusted, and nobody fakes their own loss.
  const lost = side != null && gamesWon(input.games, side) < gamesWon(input.games, side === 'a' ? 'b' : 'a')
  const autoConfirm = v.isAdmin || lost
  const now = nowIso()
  const row = {
    id: uuid(),
    date: input.date,
    player_a_id: a.id,
    player_b_id: b.id,
    games: JSON.stringify(input.games),
    type: input.type,
    venue: input.venue,
    notes: input.notes,
    status: autoConfirm ? 'confirmed' : 'pending',
    unranked: input.unranked ? 1 : 0,
    auto_confirmed: autoConfirm ? 1 : 0,
    confirmed_at: autoConfirm ? now : null,
    created_by: v.userId,
    created_at: now,
  }
  const cols = Object.keys(row)
  await db.batch([
    db.prepare(`INSERT INTO matches (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...Object.values(row)),
    auditStmt(db, v, {
      entityType: 'matches',
      entityId: row.id,
      op: 'insert',
      summary: `Recorded ${a.name} vs ${b.name}`,
      changed: { ...row, games: input.games },
      players: [a.id, b.id],
      clubs: [a.club_slug, b.club_slug],
    }),
  ])
  if (autoConfirm) await recomputeLevels(db)
  const saved = toMatch((await getMatch(db, row.id))!)
  c.executionCtx.waitUntil(sendMatchEmail(c.env, saved, a, b, new URL(c.req.url).origin).catch((e) => console.error(e)))
  return c.json(saved, 201)
})

matchRoutes.post('/matches/:id/confirm', async (c) => {
  const v = requireViewer(c)
  const { dispute } = await body(c, z.object({ dispute: z.boolean().default(false) }))
  const db = c.env.DB
  const m = await getMatch(db, c.req.param('id'))
  if (!m) throw notFound('Match not found')
  if (m.status !== 'pending') throw bad(`This match is already ${m.status}`)
  const [a, b] = await Promise.all([getPlayer(db, m.player_a_id), getPlayer(db, m.player_b_id)])
  if (!canWriteMatch(v, a!, b!)) {
    if (!sideOf(v, m)) throw forbidden('Only a participant can confirm or dispute')
    if (m.created_by === v.userId) throw forbidden('You cannot confirm a match you recorded')
  }
  const now = nowIso()
  const status = dispute ? 'disputed' : 'confirmed'
  await db.batch([
    db
      .prepare('UPDATE matches SET status = ?, confirmed_at = ?, disputed_at = ?, auto_confirmed = 0 WHERE id = ?')
      .bind(status, dispute ? null : now, dispute ? now : null, m.id),
    auditStmt(db, v, {
      entityType: 'matches',
      entityId: m.id,
      op: 'update',
      summary: `${dispute ? 'Disputed' : 'Confirmed'} ${a!.name} vs ${b!.name}`,
      changed: { status: ['pending', status] },
      players: [a!.id, b!.id],
      clubs: [a!.club_slug, b!.club_slug],
    }),
  ])
  if (!dispute) await recomputeLevels(db)
  return c.json(toMatch((await getMatch(db, m.id))!))
})

matchRoutes.patch('/matches/:id', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const m = await getMatch(db, c.req.param('id'))
  if (!m) throw notFound('Match not found')
  const [a, b] = await Promise.all([getPlayer(db, m.player_a_id), getPlayer(db, m.player_b_id)])
  if (!canWriteMatch(v, a!, b!)) throw forbidden('Only admins can edit a recorded match')
  const input = await body(c, MatchUpdateInput)
  if (input.date !== m.date) validateDate(input.date, a!, b!)
  const now = nowIso()
  const next: Record<string, unknown> = {
    date: input.date,
    type: input.type,
    games: JSON.stringify(input.games),
    venue: input.venue,
    notes: input.notes,
    unranked: input.unranked ? 1 : 0,
  }
  if (input.status && input.status !== m.status) {
    next.status = input.status
    if (input.status === 'confirmed') next.confirmed_at = now
    if (input.status === 'disputed') next.disputed_at = now
  }
  const changes = diff(m as unknown as Record<string, unknown>, next)
  if (Object.keys(changes).length === 0) return c.json(toMatch(m))
  await db.batch([
    db.prepare(`UPDATE matches SET ${Object.keys(next).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(next), m.id),
    auditStmt(db, v, {
      entityType: 'matches',
      entityId: m.id,
      op: 'update',
      summary: `Edited ${a!.name} vs ${b!.name}`,
      changed: changes,
      players: [a!.id, b!.id],
      clubs: [a!.club_slug, b!.club_slug],
    }),
  ])
  await recomputeLevels(db)
  return c.json(toMatch((await getMatch(db, m.id))!))
})

matchRoutes.delete('/matches/:id', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const m = await getMatch(db, c.req.param('id'))
  if (!m) throw notFound('Match not found')
  const [a, b] = await Promise.all([getPlayer(db, m.player_a_id), getPlayer(db, m.player_b_id)])
  if (!canWriteMatch(v, a!, b!)) throw forbidden('Only admins can delete a match')
  await db.batch([
    db.prepare('DELETE FROM matches WHERE id = ?').bind(m.id),
    auditStmt(db, v, {
      entityType: 'matches',
      entityId: m.id,
      op: 'delete',
      summary: `Deleted ${a!.name} vs ${b!.name} (${m.date})`,
      changed: { ...m, games: JSON.parse(m.games) },
      players: [a!.id, b!.id],
      clubs: [a!.club_slug, b!.club_slug],
    }),
  ])
  if (m.status === 'confirmed') await recomputeLevels(db)
  return c.json({ ok: true })
})

/**
 * Confirms pending matches older than three days. Matches against an
 * unclaimed player are skipped: nobody can dispute on their behalf, so a
 * global admin has to confirm those by hand.
 */
export async function autoConfirmAged(env: Env): Promise<number> {
  const db = env.DB
  const cutoff = new Date(Date.now() - 3 * DAY_MS).toISOString()
  const { results } = await db
    .prepare(
      `SELECT m.id, m.player_a_id, m.player_b_id, pa.club_slug ca, pb.club_slug cb FROM matches m
       JOIN players pa ON pa.id = m.player_a_id JOIN players pb ON pb.id = m.player_b_id
       WHERE m.status = 'pending' AND m.created_at < ? AND pa.user_id IS NOT NULL AND pb.user_id IS NOT NULL`,
    )
    .bind(cutoff)
    .all<{ id: string; player_a_id: string; player_b_id: string; ca: string | null; cb: string | null }>()
  if (results.length === 0) return 0
  const now = nowIso()
  await db.batch([
    db
      .prepare(
        `UPDATE matches SET status = 'confirmed', auto_confirmed = 1, confirmed_at = ?
         WHERE status = 'pending' AND id IN (SELECT value FROM json_each(?))`,
      )
      .bind(now, JSON.stringify(results.map((r) => r.id))),
    ...results.map((r) =>
      auditStmt(db, null, {
        entityType: 'matches',
        entityId: r.id,
        op: 'update',
        summary: 'Auto-confirmed after 3 days',
        changed: { status: ['pending', 'confirmed'] },
        players: [r.player_a_id, r.player_b_id],
        clubs: [r.ca, r.cb],
      }),
    ),
  ])
  await recomputeLevels(db)
  return results.length
}

