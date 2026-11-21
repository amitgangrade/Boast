import { Hono } from 'hono'
import { z } from 'zod'
import { type AdminUser, type AuditEvent, SettingsInput } from '../../shared/api'
import { normEmail, slugify } from '../../shared/util'
import { auditStmt } from '../audit'
import { type AppEnv, bad, body, notFound, nowIso, requireAdmin, requireViewer } from '../lib'
import { loadSettings, recomputeLevels } from '../levels'
import { MAX_AVATAR_BYTES, storeAvatar } from './players'

export const adminRoutes = new Hono<AppEnv>()

adminRoutes.get('/settings', async (c) => c.json(await loadSettings(c.env.DB)))

adminRoutes.put('/settings', async (c) => {
  const v = requireAdmin(c)
  const input = await body(c, SettingsInput)
  const db = c.env.DB
  const before = await loadSettings(db)
  await db.batch([
    db
      .prepare(
        "INSERT INTO settings (id, data, updated_at) VALUES ('algorithm', ?1, ?2) ON CONFLICT(id) DO UPDATE SET data = ?1, updated_at = ?2",
      )
      .bind(JSON.stringify(input), nowIso()),
    auditStmt(db, v, {
      entityType: 'settings',
      entityId: 'algorithm',
      op: 'update',
      summary: 'Changed rating settings',
      changed: { before, after: input },
      privileged: true,
    }),
  ])
  await recomputeLevels(db)
  return c.json(input)
})

adminRoutes.post('/admin/rebuild', async (c) => {
  const v = requireAdmin(c)
  const started = Date.now()
  const res = await recomputeLevels(c.env.DB)
  await auditStmt(c.env.DB, v, {
    entityType: 'settings',
    entityId: 'rebuild',
    op: 'update',
    summary: `Rebuilt levels (${res.players} players and ${res.matches} matches changed)`,
    changed: { ...res, durationMs: Date.now() - started },
    privileged: true,
  }).run()
  return c.json(res)
})

adminRoutes.get('/admin/users', async (c) => {
  requireAdmin(c)
  const q = `%${(c.req.query('q') ?? '').trim().toLowerCase()}%`
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.is_admin, u.created_at, p.id AS player_id, p.name, p.club
     FROM users u LEFT JOIN players p ON p.user_id = u.id
     WHERE lower(u.email) LIKE ?1 OR lower(COALESCE(p.name, u.google_name, '')) LIKE ?1 OR lower(COALESCE(p.club, '')) LIKE ?1
     ORDER BY u.is_admin DESC, COALESCE(p.name, u.email) LIMIT 300`,
  )
    .bind(q)
    .all<{ id: string; email: string; is_admin: number; created_at: string; player_id: string | null; name: string | null; club: string | null }>()
  const users: AdminUser[] = results.map((r) => ({
    id: r.id,
    email: r.email,
    isAdmin: !!r.is_admin,
    createdAt: r.created_at,
    playerId: r.player_id,
    name: r.name,
    club: r.club,
  }))
  return c.json(users)
})

adminRoutes.post('/admin/users/:id/admin', async (c) => {
  const v = requireAdmin(c)
  const { value } = await body(c, z.object({ value: z.boolean() }))
  const db = c.env.DB
  const id = c.req.param('id')
  const user = await db.prepare('SELECT email, is_admin FROM users WHERE id = ?').bind(id).first<{ email: string; is_admin: number }>()
  if (!user) throw notFound('User not found')
  if (!value) {
    const others = await db.prepare('SELECT COUNT(*) n FROM users WHERE is_admin = 1 AND id <> ?').bind(id).first<{ n: number }>()
    if (!others?.n) throw bad('Boast needs at least one admin — promote someone else first')
  }
  await db.batch([
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').bind(value ? 1 : 0, id),
    auditStmt(db, v, {
      entityType: 'users',
      entityId: id,
      op: 'update',
      summary: `${value ? 'Made' : 'Removed'} ${user.email} ${value ? 'a global admin' : 'as global admin'}`,
      changed: { is_admin: [!!user.is_admin, value] },
      privileged: true,
    }),
  ])
  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

adminRoutes.get('/audit', async (c) => {
  const v = requireViewer(c)
  const before = Number(c.req.query('before') ?? Number.MAX_SAFE_INTEGER)
  const entity = c.req.query('entity') || null
  const db = c.env.DB
  let scopeSql = ''
  const args: unknown[] = [before, entity]
  if (!v.isAdmin) {
    const groupIds = [...v.groupAdminScope.keys()]
    const groupPlayers = [...v.groupAdminScope.values()].flatMap((s) => [...s])
    const slugs = [...v.clubAdminSlugs]
    if (slugs.length === 0 && groupIds.length === 0) return c.json([])
    // Club/group admins see events touching their clubs, groups or members.
    scopeSql = `AND privileged = 0 AND (
      EXISTS (SELECT 1 FROM json_each(subject_player_ids) s WHERE s.value IN (SELECT value FROM json_each(?3))
                OR s.value IN (SELECT id FROM players WHERE club_slug IN (SELECT value FROM json_each(?4))))
      OR EXISTS (SELECT 1 FROM json_each(subject_club_slugs) s WHERE s.value IN (SELECT value FROM json_each(?4)))
      OR EXISTS (SELECT 1 FROM json_each(subject_group_ids) s WHERE s.value IN (SELECT value FROM json_each(?5))))`
    args.push(JSON.stringify(groupPlayers), JSON.stringify(slugs), JSON.stringify(groupIds))
  }
  const { results } = await db
    .prepare(
      `SELECT id, at, actor_user_id, actor_label, entity_type, entity_id, op, summary, changed FROM audit_events
       WHERE id < ?1 AND (?2 IS NULL OR entity_type = ?2) ${scopeSql}
       ORDER BY id DESC LIMIT 50`,
    )
    .bind(...args)
    .all<{ id: number; at: string; actor_user_id: string | null; actor_label: string | null; entity_type: string; entity_id: string | null; op: AuditEvent['op']; summary: string | null; changed: string | null }>()
  const events: AuditEvent[] = results.map((r) => ({
    id: r.id,
    at: r.at,
    actorUserId: r.actor_user_id,
    actorLabel: r.actor_label,
    entityType: r.entity_type,
    entityId: r.entity_id,
    op: r.op,
    summary: r.summary,
    changed: r.changed ? JSON.parse(r.changed) : null,
  }))
  return c.json(events)
})

// ---------------------------------------------------------------------------
// Backup & restore. Export is a dump of every table; import loads rows table
// by table in chunks sent by the browser (which also converts SquashLevel
// exports into these rows).
// ---------------------------------------------------------------------------

const TABLES = {
  users: ['id', 'email', 'email_norm', 'google_sub', 'google_name', 'is_admin', 'created_at'],
  players: [
    'id', 'user_id', 'username', 'name', 'email', 'email_norm', 'phone', 'country', 'city', 'club', 'club_slug',
    'avatar_url', 'birth_year', 'gender', 'dominant_hand', 'notes', 'starting_level', 'seeded_rating',
    'current_level', 'matches_played', 'created_by', 'created_at',
  ],
  matches: [
    'id', 'date', 'player_a_id', 'player_b_id', 'games', 'type', 'venue', 'notes', 'status', 'unranked',
    'auto_confirmed', 'confirmed_at', 'disputed_at', 'created_by', 'created_at',
  ],
  challenges: [
    'id', 'from_player_id', 'to_player_id', 'message', 'proposed_date', 'venue', 'status', 'created_by', 'created_at', 'responded_at',
  ],
  clubs: ['slug', 'name', 'city', 'country', 'description', 'created_by', 'created_at'],
  club_admins: ['user_id', 'club_slug', 'granted_by', 'granted_at'],
  groups: ['id', 'name', 'slug', 'description', 'is_private', 'created_by', 'created_at'],
  group_members: ['group_id', 'player_id', 'is_admin', 'added_by', 'added_at'],
  settings: ['id', 'data', 'updated_at'],
  audit_events: [
    'at', 'actor_user_id', 'actor_label', 'entity_type', 'entity_id', 'op', 'summary', 'changed',
    'subject_player_ids', 'subject_club_slugs', 'subject_group_ids', 'privileged',
  ],
} as const
type Table = keyof typeof TABLES

/** Optional references to users: unknown ids become NULL instead of failing. */
const USER_REFS = new Set(['created_by', 'granted_by', 'added_by'])

/** Rows whose parent row didn't make it are skipped. */
const REQUIRED_REFS: Partial<Record<Table, Array<[string, string]>>> = {
  matches: [['player_a_id', 'players'], ['player_b_id', 'players']],
  challenges: [['from_player_id', 'players'], ['to_player_id', 'players']],
  club_admins: [['user_id', 'users']],
  group_members: [['group_id', 'groups'], ['player_id', 'players']],
}

const ImportRows = z.object({
  table: z.enum(Object.keys(TABLES) as [Table, ...Table[]]),
  rows: z.array(z.record(z.string(), z.unknown())).max(1000),
})

adminRoutes.get('/admin/export', async (c) => {
  requireAdmin(c)
  const db = c.env.DB
  const names = Object.keys(TABLES) as Table[]
  const results = await db.batch(names.map((t) => db.prepare(`SELECT ${TABLES[t].join(', ')} FROM ${t}`)))
  const dump: Record<string, unknown> = { format: 'boast', version: 1, exportedAt: nowIso() }
  names.forEach((t, i) => (dump[t] = results[i].results))
  return new Response(JSON.stringify(dump), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="boast-backup-${nowIso().slice(0, 10)}.json"`,
    },
  })
})

adminRoutes.post('/admin/import/begin', async (c) => {
  const v = requireAdmin(c)
  const { confirm } = await body(c, z.object({ confirm: z.literal('REPLACE') }))
  if (confirm !== 'REPLACE') throw bad('Confirmation required')
  const db = c.env.DB
  await db.batch([
    db.prepare('DELETE FROM matches'),
    db.prepare('DELETE FROM challenges'),
    db.prepare('DELETE FROM group_members'),
    db.prepare('DELETE FROM groups'),
    db.prepare('DELETE FROM club_admins'),
    db.prepare('DELETE FROM clubs'),
    db.prepare('DELETE FROM avatars'),
    db.prepare('DELETE FROM players'),
    db.prepare('DELETE FROM settings'),
    db.prepare('DELETE FROM audit_events'),
    db.prepare('DELETE FROM users WHERE id <> ?').bind(v.userId),
  ])
  return c.json({ ok: true })
})

adminRoutes.post('/admin/import/rows', async (c) => {
  const v = requireAdmin(c)
  const { table, rows } = await body(c, ImportRows)
  const cols = [...TABLES[table]]
  const prepared = rows
    .map((r) => {
      const out: Record<string, unknown> = {}
      for (const col of cols) out[col] = r[col] ?? null
      if ('email_norm' in out) out.email_norm = normEmail(out.email as string | null)
      if (table === 'players') out.club_slug = slugify(out.club as string | null) || null
      if (table === 'groups' && !out.slug) out.slug = slugify(out.name as string)
      // The importing admin keeps their own account; an imported copy of it is merged in /finish.
      if (table === 'users' && out.id === v.userId) return null
      return out
    })
    .filter(Boolean)
  if (prepared.length === 0) return c.json({ inserted: 0 })
  const exprs = cols.map((col) => {
    const val = `j.value->>'$.${col}'`
    if (USER_REFS.has(col) || (table === 'players' && col === 'user_id')) {
      return `(SELECT id FROM users WHERE id = ${val})`
    }
    return val
  })
  const conds = (REQUIRED_REFS[table] ?? []).map(
    ([col, parent]) => `EXISTS (SELECT 1 FROM ${parent} WHERE id = j.value->>'$.${col}')`,
  )
  const sql = `INSERT OR IGNORE INTO ${table} (${cols.join(', ')})
    SELECT ${exprs.join(', ')} FROM json_each(?) j ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}`
  const res = await c.env.DB.prepare(sql).bind(JSON.stringify(prepared)).run()
  return c.json({ inserted: res.meta.changes ?? 0, received: rows.length })
})

/**
 * If the import contained the importing admin's own account (same email),
 * their session moves over to that imported account and their temporary
 * account is removed. Then every level is recomputed.
 */
adminRoutes.post('/admin/import/finish', async (c) => {
  const v = requireAdmin(c)
  const db = c.env.DB
  const me = await db.prepare('SELECT google_sub, google_name, email_norm FROM users WHERE id = ?').bind(v.userId).first<{ google_sub: string | null; google_name: string | null; email_norm: string }>()
  const twin = await db
    .prepare('SELECT id FROM users WHERE email_norm = ? AND id <> ? ORDER BY created_at LIMIT 1')
    .bind(me!.email_norm, v.userId)
    .first<{ id: string }>()
  if (twin) {
    await db.batch([
      db.prepare('UPDATE users SET google_sub = NULL WHERE id = ?').bind(v.userId),
      db
        .prepare('UPDATE users SET google_sub = COALESCE(google_sub, ?), google_name = COALESCE(google_name, ?), is_admin = 1 WHERE id = ?')
        .bind(me!.google_sub, me!.google_name, twin.id),
      db.prepare('UPDATE sessions SET user_id = ? WHERE user_id = ?').bind(twin.id, v.userId),
      db.prepare('DELETE FROM users WHERE id = ?').bind(v.userId),
    ])
  }
  const levels = await recomputeLevels(db)
  const counts = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM players) players, (SELECT COUNT(*) FROM matches) matches,
              (SELECT COUNT(*) FROM groups) groups, (SELECT COUNT(*) FROM players WHERE avatar_url LIKE 'http%') external_avatars`,
    )
    .first<Record<string, number>>()
  await auditStmt(db, { ...v, userId: twin?.id ?? v.userId }, {
    entityType: 'settings',
    entityId: 'import',
    op: 'update',
    summary: `Imported data (${counts!.players} players, ${counts!.matches} matches)`,
    changed: { counts, levels },
    privileged: true,
  }).run()
  return c.json({ counts, merged: !!twin })
})

/** Copies avatars still hosted elsewhere (e.g. old Supabase storage) into Boast, a few per call. */
adminRoutes.post('/admin/import/avatars', async (c) => {
  requireAdmin(c)
  const db = c.env.DB
  const { results } = await db
    .prepare("SELECT id, avatar_url FROM players WHERE avatar_url LIKE 'http%' LIMIT 8")
    .all<{ id: string; avatar_url: string }>()
  let copied = 0
  for (const p of results) {
    let url: string | null = null
    try {
      const res = await fetch(p.avatar_url)
      const type = (res.headers.get('content-type') ?? '').split(';')[0]
      if (res.ok && ['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
        const bytes = await res.arrayBuffer()
        if (bytes.byteLength <= MAX_AVATAR_BYTES) {
          url = await storeAvatar(db, p.id, bytes, type)
          copied++
        }
      }
    } catch (e) {
      console.error('avatar copy failed', p.avatar_url, e)
    }
    await db.prepare('UPDATE players SET avatar_url = ? WHERE id = ?').bind(url, p.id).run()
  }
  const left = await db.prepare("SELECT COUNT(*) n FROM players WHERE avatar_url LIKE 'http%'").first<{ n: number }>()
  return c.json({ copied, processed: results.length, remaining: left?.n ?? 0 })
})

