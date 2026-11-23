import { Hono } from 'hono'
import { z } from 'zod'
import { type Activity, ChallengeInput } from '../../shared/api'
import { auditStmt } from '../audit'
import { sendChallengeEmail, sendChallengeResponseEmail } from '../email'
import {
  type AppEnv,
  bad,
  body,
  type ChallengeRow,
  forbidden,
  getPlayer,
  type MatchRow,
  notFound,
  nowIso,
  requireViewer,
  toChallenge,
  toMatch,
  uuid,
} from '../lib'

export const challengeRoutes = new Hono<AppEnv>()

challengeRoutes.get('/challenges', async (c) => {
  const player = c.req.query('player')
  if (!player) throw bad('player required')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM challenges WHERE from_player_id = ?1 OR to_player_id = ?1 ORDER BY created_at DESC LIMIT 100',
  )
    .bind(player)
    .all<ChallengeRow>()
  return c.json(results.map(toChallenge))
})

challengeRoutes.post('/challenges', async (c) => {
  const v = requireViewer(c)
  const input = await body(c, ChallengeInput)
  const db = c.env.DB
  let fromId = v.player?.id
  if (input.fromPlayerId && input.fromPlayerId !== fromId) {
    if (!v.isAdmin) throw forbidden('You cannot challenge as someone else')
    fromId = input.fromPlayerId
  }
  if (!fromId) throw bad('Finish setting up your profile first')
  if (fromId === input.toPlayerId) throw bad('You cannot challenge yourself')
  const [from, to] = await Promise.all([getPlayer(db, fromId), getPlayer(db, input.toPlayerId)])
  if (!from || !to) throw notFound('Opponent not found')
  const open = await db
    .prepare(
      `SELECT 1 FROM challenges WHERE status = 'pending' AND
       ((from_player_id = ?1 AND to_player_id = ?2) OR (from_player_id = ?2 AND to_player_id = ?1))`,
    )
    .bind(from.id, to.id)
    .first()
  if (open) throw bad('There is already an open challenge between you two')
  const row = {
    id: uuid(),
    from_player_id: from.id,
    to_player_id: to.id,
    message: input.message,
    proposed_date: input.proposedDate,
    venue: input.venue,
    created_by: v.userId,
  }
  await db.batch([
    db
      .prepare(
        'INSERT INTO challenges (id, from_player_id, to_player_id, message, proposed_date, venue, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(...Object.values(row)),
    auditStmt(db, v, {
      entityType: 'challenges',
      entityId: row.id,
      op: 'insert',
      summary: `${from.name} challenged ${to.name}`,
      changed: row,
      players: [from.id, to.id],
      clubs: [from.club_slug, to.club_slug],
    }),
  ])
  const saved = (await db.prepare('SELECT * FROM challenges WHERE id = ?').bind(row.id).first<ChallengeRow>())!
  c.executionCtx.waitUntil(sendChallengeEmail(c.env, saved, from, to, new URL(c.req.url).origin).catch((e) => console.error(e)))
  return c.json(toChallenge(saved), 201)
})

challengeRoutes.post('/challenges/:id/respond', async (c) => {
  const v = requireViewer(c)
  const { response } = await body(c, z.object({ response: z.enum(['accepted', 'declined', 'cancelled']) }))
  const db = c.env.DB
  const ch = await db.prepare('SELECT * FROM challenges WHERE id = ?').bind(c.req.param('id')).first<ChallengeRow>()
  if (!ch) throw notFound('Challenge not found')
  if (ch.status !== 'pending') throw bad(`This challenge is already ${ch.status}`)
  const me = v.player?.id
  if (!v.isAdmin) {
    if (me !== ch.from_player_id && me !== ch.to_player_id) throw forbidden()
    if (response === 'cancelled' && me !== ch.from_player_id) throw forbidden('Only the sender can cancel')
    if (response !== 'cancelled' && me !== ch.to_player_id) throw forbidden('Only the recipient can accept or decline')
  }
  const [from, to] = await Promise.all([getPlayer(db, ch.from_player_id), getPlayer(db, ch.to_player_id)])
  await db.batch([
    db.prepare('UPDATE challenges SET status = ?, responded_at = ? WHERE id = ?').bind(response, nowIso(), ch.id),
    auditStmt(db, v, {
      entityType: 'challenges',
      entityId: ch.id,
      op: 'update',
      summary: `Challenge ${from!.name} → ${to!.name} ${response}`,
      changed: { status: ['pending', response] },
      players: [ch.from_player_id, ch.to_player_id],
      clubs: [from!.club_slug, to!.club_slug],
    }),
  ])
  c.executionCtx.waitUntil(sendChallengeResponseEmail(c.env, response, from!, to!, new URL(c.req.url).origin).catch((e) => console.error(e)))
  return c.json(toChallenge((await db.prepare('SELECT * FROM challenges WHERE id = ?').bind(ch.id).first<ChallengeRow>())!))
})

/** Everything waiting on the viewer, plus admin queues. */
challengeRoutes.get('/activity', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const me = v.player?.id ?? ''
  const [mine, challenges, admin] = await db.batch([
    db
      .prepare(
        "SELECT * FROM matches WHERE status = 'pending' AND (player_a_id = ?1 OR player_b_id = ?1) ORDER BY created_at",
      )
      .bind(me),
    db
      .prepare('SELECT * FROM challenges WHERE from_player_id = ?1 OR to_player_id = ?1 ORDER BY created_at DESC LIMIT 60')
      .bind(me),
    db
      .prepare(
        `SELECT * FROM matches WHERE ?1 = 1 AND (status = 'disputed' OR
           (status = 'pending' AND player_a_id <> ?2 AND player_b_id <> ?2)) ORDER BY created_at DESC LIMIT 200`,
      )
      .bind(v.isAdmin ? 1 : 0, me),
  ])
  const myMatches = (mine.results as MatchRow[]).map(toMatch)
  const chs = (challenges.results as ChallengeRow[]).map(toChallenge)
  const adminRows = (admin.results as MatchRow[]).map(toMatch)
  const activity: Activity = {
    pendingForMe: myMatches.filter((m) => m.createdBy !== v.userId),
    myPending: myMatches.filter((m) => m.createdBy === v.userId),
    incomingChallenges: chs.filter((x) => x.status === 'pending' && x.toPlayerId === me),
    outgoingChallenges: chs.filter((x) => x.status === 'pending' && x.fromPlayerId === me),
    pastChallenges: chs.filter((x) => x.status !== 'pending').slice(0, 20),
    adminPending: adminRows.filter((m) => m.status === 'pending').reverse(),
    disputed: adminRows.filter((m) => m.status === 'disputed'),
  }
  return c.json(activity)
})
