import { Hono } from 'hono'
import { z } from 'zod'
import { type ClubAdminGrant, type ClubDetail, ClubInput, type ClubSummary } from '../../shared/api'
import { slugify } from '../../shared/util'
import { auditStmt } from '../audit'
import { type AppEnv, bad, body, notFound, requireAdmin } from '../lib'

export const clubRoutes = new Hono<AppEnv>()

interface RegistryRow {
  slug: string
  name: string
  city: string | null
  country: string | null
  description: string | null
}

const mode = (xs: Array<string | null>) => {
  const counts = new Map<string, number>()
  for (const x of xs) if (x) counts.set(x, (counts.get(x) ?? 0) + 1)
  let best: string | null = null
  for (const [k, n] of counts) if (best == null || n > counts.get(best)!) best = k
  return best
}

/**
 * Clubs are derived from players' free-text club names (grouped by slug),
 * merged with the admin-curated registry, which can add clubs with no members
 * yet and overrides display name, city, country and description.
 */
async function allClubs(db: D1Database): Promise<Array<ClubSummary & { memberIds: string[] }>> {
  const [players, registry] = await db.batch([
    db.prepare('SELECT id, club, club_slug, city, country FROM players WHERE club_slug IS NOT NULL ORDER BY created_at'),
    db.prepare('SELECT slug, name, city, country, description FROM clubs'),
  ])
  const derived = new Map<string, { name: string; ids: string[]; cities: Array<string | null>; countries: Array<string | null> }>()
  for (const p of players.results as Array<{ id: string; club: string; club_slug: string; city: string | null; country: string | null }>) {
    const d = derived.get(p.club_slug) ?? { name: p.club, ids: [], cities: [], countries: [] }
    d.ids.push(p.id)
    d.cities.push(p.city)
    d.countries.push(p.country)
    derived.set(p.club_slug, d)
  }
  const out = new Map<string, ClubSummary & { memberIds: string[] }>()
  for (const [slug, d] of derived) {
    out.set(slug, {
      slug,
      name: d.name,
      city: mode(d.cities),
      country: mode(d.countries),
      description: null,
      members: d.ids.length,
      registered: false,
      memberIds: d.ids,
    })
  }
  for (const r of registry.results as RegistryRow[]) {
    const d = out.get(r.slug)
    out.set(r.slug, {
      slug: r.slug,
      name: r.name,
      city: r.city ?? d?.city ?? null,
      country: r.country ?? d?.country ?? null,
      description: r.description,
      members: d?.members ?? 0,
      registered: true,
      memberIds: d?.memberIds ?? [],
    })
  }
  return [...out.values()].sort((a, b) => b.members - a.members || a.name.localeCompare(b.name))
}

clubRoutes.get('/clubs', async (c) => {
  const clubs = await allClubs(c.env.DB)
  return c.json(clubs.map(({ memberIds: _ids, ...rest }) => rest))
})

clubRoutes.get('/clubs/:slug', async (c) => {
  const slug = c.req.param('slug')
  const club = (await allClubs(c.env.DB)).find((x) => x.slug === slug)
  if (!club) throw notFound('Club not found')
  const { results } = await c.env.DB.prepare(
    `SELECT ca.user_id, COALESCE(p.name, u.email) AS name FROM club_admins ca
     JOIN users u ON u.id = ca.user_id LEFT JOIN players p ON p.user_id = ca.user_id
     WHERE ca.club_slug = ? ORDER BY name`,
  )
    .bind(slug)
    .all<{ user_id: string; name: string }>()
  const detail: ClubDetail = { ...club, admins: results.map((r) => ({ userId: r.user_id, name: r.name })) }
  return c.json(detail)
})

clubRoutes.post('/clubs', async (c) => {
  const v = requireAdmin(c)
  const input = await body(c, ClubInput)
  const slug = slugify(input.name)
  if (!slug) throw bad('Club name needs at least one letter or number')
  const db = c.env.DB
  await db.batch([
    db
      .prepare(
        `INSERT INTO clubs (slug, name, city, country, description, created_by) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET name = excluded.name,
           city = COALESCE(excluded.city, clubs.city), country = COALESCE(excluded.country, clubs.country),
           description = COALESCE(excluded.description, clubs.description)`,
      )
      .bind(slug, input.name, input.city, input.country, input.description, v.userId),
    auditStmt(db, v, { entityType: 'clubs', entityId: slug, op: 'insert', summary: `Added club ${input.name}`, changed: input, clubs: [slug] }),
  ])
  return c.json({ slug }, 201)
})

clubRoutes.delete('/clubs/:slug', async (c) => {
  const v = requireAdmin(c)
  const slug = c.req.param('slug')
  const db = c.env.DB
  await db.batch([
    db.prepare('DELETE FROM clubs WHERE slug = ?').bind(slug),
    auditStmt(db, v, { entityType: 'clubs', entityId: slug, op: 'delete', summary: `Removed club ${slug} from the directory`, clubs: [slug] }),
  ])
  return c.json({ ok: true })
})

clubRoutes.get('/admin/club-admins', async (c) => {
  requireAdmin(c)
  const { results } = await c.env.DB.prepare(
    `SELECT ca.user_id, ca.club_slug, ca.granted_at, u.email, COALESCE(p.name, u.google_name, u.email) AS name
     FROM club_admins ca JOIN users u ON u.id = ca.user_id LEFT JOIN players p ON p.user_id = ca.user_id
     ORDER BY ca.club_slug, name`,
  ).all<{ user_id: string; club_slug: string; granted_at: string; email: string; name: string }>()
  const grants: ClubAdminGrant[] = results.map((r) => ({
    userId: r.user_id,
    clubSlug: r.club_slug,
    name: r.name,
    email: r.email,
    grantedAt: r.granted_at,
  }))
  return c.json(grants)
})

clubRoutes.post('/admin/club-admins', async (c) => {
  const v = requireAdmin(c)
  const input = await body(c, z.object({ userId: z.string(), clubSlug: z.string().min(1), value: z.boolean() }))
  const db = c.env.DB
  const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(input.userId).first<{ email: string }>()
  if (!user) throw notFound('User not found')
  await db.batch([
    input.value
      ? db
          .prepare('INSERT OR IGNORE INTO club_admins (user_id, club_slug, granted_by) VALUES (?, ?, ?)')
          .bind(input.userId, input.clubSlug, v.userId)
      : db.prepare('DELETE FROM club_admins WHERE user_id = ? AND club_slug = ?').bind(input.userId, input.clubSlug),
    auditStmt(db, v, {
      entityType: 'club_admins',
      entityId: `${input.userId}:${input.clubSlug}`,
      op: input.value ? 'insert' : 'delete',
      summary: `${input.value ? 'Made' : 'Removed'} ${user.email} ${input.value ? 'an admin of' : 'as admin of'} ${input.clubSlug}`,
      clubs: [input.clubSlug],
      privileged: true,
    }),
  ])
  return c.json({ ok: true })
})
