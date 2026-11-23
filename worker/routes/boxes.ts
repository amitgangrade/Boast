import { Hono } from 'hono'
import { type BoxRound, BoxRoundInput } from '../../shared/api'
import { auditStmt } from '../audit'
import { type AppEnv, bad, body, notFound, requireViewer, uuid } from '../lib'
import { loadGroup, requireGroupAdmin } from './groups'

/** Box leagues: rounds inside a group, each splitting members into numbered boxes. */
export const boxRoutes = new Hono<AppEnv>()

interface RoundRow {
  id: string
  group_id: string
  name: string
  starts_on: string
  ends_on: string
  created_at: string
}

async function roundsFor(db: D1Database, groupId: string): Promise<BoxRound[]> {
  const [rounds, entries] = await db.batch([
    db.prepare('SELECT * FROM box_rounds WHERE group_id = ? ORDER BY starts_on DESC, created_at DESC').bind(groupId),
    db
      .prepare(
        `SELECT e.round_id, e.player_id, e.box FROM box_entries e JOIN box_rounds r ON r.id = e.round_id
         JOIN players p ON p.id = e.player_id WHERE r.group_id = ? ORDER BY e.box, p.current_level DESC`,
      )
      .bind(groupId),
  ])
  const byRound = new Map<string, string[][]>()
  for (const e of entries.results as Array<{ round_id: string; player_id: string; box: number }>) {
    const boxes = byRound.get(e.round_id) ?? []
    ;(boxes[e.box - 1] ??= []).push(e.player_id)
    byRound.set(e.round_id, boxes)
  }
  return (rounds.results as RoundRow[]).map((r) => ({
    id: r.id,
    groupId: r.group_id,
    name: r.name,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    boxes: Array.from(byRound.get(r.id) ?? [], (b) => b ?? []),
    createdAt: r.created_at,
  }))
}

/** Every player must be a group member and appear in at most one box. */
async function validateBoxes(db: D1Database, groupId: string, boxes: string[][]) {
  const all = boxes.flat()
  if (new Set(all).size !== all.length) throw bad('A player can only be in one box per round')
  const { results } = await db
    .prepare('SELECT player_id FROM group_members WHERE group_id = ? AND player_id IN (SELECT value FROM json_each(?))')
    .bind(groupId, JSON.stringify(all))
    .all<{ player_id: string }>()
  if (results.length !== all.length) throw bad('Everyone in a box must be a member of the group')
}

const entriesStmt = (db: D1Database, roundId: string, boxes: string[][]) =>
  db
    .prepare(
      `INSERT INTO box_entries (round_id, player_id, box)
       SELECT ?1, j.value->>'$.p', j.value->>'$.b' FROM json_each(?2) j`,
    )
    .bind(roundId, JSON.stringify(boxes.flatMap((ids, i) => ids.map((p) => ({ p, b: i + 1 })))))

boxRoutes.get('/groups/:id/rounds', async (c) => {
  const g = await loadGroup(c.env.DB, c.get('viewer'), 'g.id', c.req.param('id'))
  return c.json(await roundsFor(c.env.DB, g.id))
})

boxRoutes.post('/groups/:id/rounds', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const g = await requireGroupAdmin(db, v, c.req.param('id'))
  const input = await body(c, BoxRoundInput)
  await validateBoxes(db, g.id, input.boxes)
  const id = uuid()
  await db.batch([
    db
      .prepare('INSERT INTO box_rounds (id, group_id, name, starts_on, ends_on, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, g.id, input.name, input.startsOn, input.endsOn, v.userId),
    entriesStmt(db, id, input.boxes),
    auditStmt(db, v, {
      entityType: 'box_rounds',
      entityId: id,
      op: 'insert',
      summary: `Started box league round “${input.name}” in ${g.name}`,
      changed: input,
      groups: [g.id],
      players: input.boxes.flat(),
    }),
  ])
  return c.json({ id }, 201)
})

async function loadRound(db: D1Database, id: string): Promise<RoundRow> {
  const r = await db.prepare('SELECT * FROM box_rounds WHERE id = ?').bind(id).first<RoundRow>()
  if (!r) throw notFound('Round not found')
  return r
}

boxRoutes.patch('/rounds/:id', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const r = await loadRound(db, c.req.param('id'))
  const g = await requireGroupAdmin(db, v, r.group_id)
  const input = await body(c, BoxRoundInput)
  await validateBoxes(db, g.id, input.boxes)
  await db.batch([
    db.prepare('UPDATE box_rounds SET name = ?, starts_on = ?, ends_on = ? WHERE id = ?').bind(input.name, input.startsOn, input.endsOn, r.id),
    db.prepare('DELETE FROM box_entries WHERE round_id = ?').bind(r.id),
    entriesStmt(db, r.id, input.boxes),
    auditStmt(db, v, {
      entityType: 'box_rounds',
      entityId: r.id,
      op: 'update',
      summary: `Edited box league round “${input.name}” in ${g.name}`,
      changed: input,
      groups: [g.id],
      players: input.boxes.flat(),
    }),
  ])
  return c.json({ id: r.id })
})

boxRoutes.delete('/rounds/:id', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const r = await loadRound(db, c.req.param('id'))
  const g = await requireGroupAdmin(db, v, r.group_id)
  await db.batch([
    db.prepare('DELETE FROM box_rounds WHERE id = ?').bind(r.id),
    auditStmt(db, v, {
      entityType: 'box_rounds',
      entityId: r.id,
      op: 'delete',
      summary: `Deleted box league round “${r.name}” in ${g.name}`,
      changed: r,
      groups: [g.id],
    }),
  ])
  return c.json({ ok: true })
})
