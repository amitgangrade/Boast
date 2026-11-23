import { Hono } from 'hono'
import { z } from 'zod'
import { type GroupDetail, GroupInput, type GroupSummary } from '../../shared/api'
import { slugify } from '../../shared/util'
import { auditStmt } from '../audit'
import { type AppEnv, bad, body, forbidden, HttpError, notFound, requireViewer, uuid } from '../lib'
import type { Viewer } from '../perms'

export const groupRoutes = new Hono<AppEnv>()

interface GroupRow {
  id: string
  name: string
  slug: string
  description: string | null
  is_private: number
  created_at: string
  member_count: number
  admin_names: string | null
  viewer_member: number
  viewer_admin: number
}

const SUMMARY_SQL = `
  SELECT g.*,
    (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count,
    (SELECT json_group_array(p.name) FROM group_members m JOIN players p ON p.id = m.player_id
       WHERE m.group_id = g.id AND m.is_admin = 1) AS admin_names,
    EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.player_id = ?1) AS viewer_member,
    EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.player_id = ?1 AND m.is_admin = 1) AS viewer_admin
  FROM groups g`

function toSummary(r: GroupRow, v: Viewer | null): GroupSummary {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    isPrivate: !!r.is_private,
    memberCount: r.member_count,
    adminNames: r.admin_names ? (JSON.parse(r.admin_names) as string[]) : [],
    viewerIsMember: !!r.viewer_member,
    viewerIsAdmin: !!r.viewer_admin || !!v?.isAdmin,
    createdAt: r.created_at,
  }
}

const visible = (r: GroupRow, v: Viewer | null) => !r.is_private || !!r.viewer_member || !!v?.isAdmin

export async function loadGroup(db: D1Database, v: Viewer | null, where: string, key: string) {
  const row = await db.prepare(`${SUMMARY_SQL} WHERE ${where} = ?2`).bind(v?.player?.id ?? '', key).first<GroupRow>()
  if (!row || !visible(row, v)) throw notFound('Group not found')
  return row
}

export async function requireGroupAdmin(db: D1Database, v: Viewer, groupId: string) {
  const row = await loadGroup(db, v, 'g.id', groupId)
  if (!row.viewer_admin && !v.isAdmin) throw forbidden('Group admins only')
  return row
}

groupRoutes.get('/groups', async (c) => {
  const v = c.get('viewer')
  const { results } = await c.env.DB.prepare(`${SUMMARY_SQL} ORDER BY g.name`).bind(v?.player?.id ?? '').all<GroupRow>()
  return c.json(results.filter((r) => visible(r, v)).map((r) => toSummary(r, v)))
})

groupRoutes.get('/groups/:slug', async (c) => {
  const v = c.get('viewer')
  const row = await loadGroup(c.env.DB, v, 'g.slug', c.req.param('slug'))
  const { results } = await c.env.DB.prepare(
    'SELECT player_id, is_admin, added_at FROM group_members WHERE group_id = ? ORDER BY is_admin DESC, added_at',
  )
    .bind(row.id)
    .all<{ player_id: string; is_admin: number; added_at: string }>()
  const detail: GroupDetail = {
    ...toSummary(row, v),
    members: results.map((m) => ({ playerId: m.player_id, isAdmin: !!m.is_admin, addedAt: m.added_at })),
  }
  return c.json(detail)
})

groupRoutes.post('/groups', async (c) => {
  const v = requireViewer(c)
  if (!v.player) throw bad('Finish setting up your profile first')
  const input = await body(c, GroupInput)
  const slug = slugify(input.name)
  if (!slug) throw bad('Group name needs at least one letter or number')
  const db = c.env.DB
  const id = uuid()
  try {
    await db.batch([
      db
        .prepare('INSERT INTO groups (id, name, slug, description, is_private, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, input.name, slug, input.description, input.isPrivate ? 1 : 0, v.userId),
      db
        .prepare('INSERT INTO group_members (group_id, player_id, is_admin, added_by) VALUES (?, ?, 1, ?)')
        .bind(id, v.player.id, v.userId),
      auditStmt(db, v, {
        entityType: 'groups',
        entityId: id,
        op: 'insert',
        summary: `Created group ${input.name}`,
        changed: input,
        groups: [id],
        players: [v.player.id],
      }),
    ])
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new HttpError(409, 'A group with that name already exists')
    throw e
  }
  return c.json({ id, slug }, 201)
})

groupRoutes.patch('/groups/:id', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const g = await requireGroupAdmin(db, v, c.req.param('id'))
  const input = await body(c, GroupInput)
  const slug = slugify(input.name)
  if (!slug) throw bad('Group name needs at least one letter or number')
  try {
    await db.batch([
      db
        .prepare('UPDATE groups SET name = ?, slug = ?, description = ?, is_private = ? WHERE id = ?')
        .bind(input.name, slug, input.description, input.isPrivate ? 1 : 0, g.id),
      auditStmt(db, v, { entityType: 'groups', entityId: g.id, op: 'update', summary: `Edited group ${input.name}`, changed: input, groups: [g.id] }),
    ])
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new HttpError(409, 'A group with that name already exists')
    throw e
  }
  return c.json({ id: g.id, slug })
})

groupRoutes.delete('/groups/:id', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const g = await requireGroupAdmin(db, v, c.req.param('id'))
  await db.batch([
    db.prepare('DELETE FROM groups WHERE id = ?').bind(g.id),
    auditStmt(db, v, { entityType: 'groups', entityId: g.id, op: 'delete', summary: `Deleted group ${g.name}`, groups: [g.id] }),
  ])
  return c.json({ ok: true })
})

groupRoutes.post('/groups/:id/members', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const g = await requireGroupAdmin(db, v, c.req.param('id'))
  const input = await body(c, z.object({ playerId: z.string(), isAdmin: z.boolean().default(false) }))
  const p = await db.prepare('SELECT name FROM players WHERE id = ?').bind(input.playerId).first<{ name: string }>()
  if (!p) throw notFound('Player not found')
  if (!input.isAdmin) await assertNotLastAdmin(db, g.id, input.playerId)
  await db.batch([
    db
      .prepare(
        `INSERT INTO group_members (group_id, player_id, is_admin, added_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(group_id, player_id) DO UPDATE SET is_admin = excluded.is_admin`,
      )
      .bind(g.id, input.playerId, input.isAdmin ? 1 : 0, v.userId),
    auditStmt(db, v, {
      entityType: 'group_members',
      entityId: `${g.id}:${input.playerId}`,
      op: 'insert',
      summary: `${p.name} is now ${input.isAdmin ? 'an admin' : 'a member'} of ${g.name}`,
      groups: [g.id],
      players: [input.playerId],
    }),
  ])
  return c.json({ ok: true })
})

groupRoutes.delete('/groups/:id/members/:playerId', async (c) => {
  const v = requireViewer(c)
  const db = c.env.DB
  const playerId = c.req.param('playerId')
  const leaving = v.player?.id === playerId
  const g = leaving ? await loadGroup(db, v, 'g.id', c.req.param('id')) : await requireGroupAdmin(db, v, c.req.param('id'))
  await assertNotLastAdmin(db, g.id, playerId)
  await db.batch([
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND player_id = ?').bind(g.id, playerId),
    auditStmt(db, v, {
      entityType: 'group_members',
      entityId: `${g.id}:${playerId}`,
      op: 'delete',
      summary: `${leaving ? 'Left' : 'Removed a member from'} ${g.name}`,
      groups: [g.id],
      players: [playerId],
    }),
  ])
  return c.json({ ok: true })
})

/** Every group keeps at least one admin who can manage it. */
async function assertNotLastAdmin(db: D1Database, groupId: string, playerId: string) {
  const row = await db
    .prepare(
      `SELECT (SELECT is_admin FROM group_members WHERE group_id = ?1 AND player_id = ?2) AS target_admin,
              (SELECT COUNT(*) FROM group_members WHERE group_id = ?1 AND is_admin = 1 AND player_id <> ?2) AS others`,
    )
    .bind(groupId, playerId)
    .first<{ target_admin: number | null; others: number }>()
  if (row?.target_admin && row.others === 0) {
    throw bad('Promote another admin first — a group needs at least one admin')
  }
}
