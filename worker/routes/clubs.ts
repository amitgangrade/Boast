import { Hono } from 'hono'
import { z } from 'zod'
import { type ClubAdminGrant, type ClubDetail, ClubInput, type ClubSummary, ImportMembersInput, type ImportMembersResult } from '../../shared/api'
import { canonicalCountry } from '../../shared/countries'
import { DEFAULT_STARTING_LEVEL } from '../../shared/rating'
import { normEmail, slugify, validBirthYear } from '../../shared/util'
import { auditStmt } from '../audit'
import { cachedDirectory } from '../cache'
import { type AppEnv, bad, body, forbidden, notFound, requireAdmin, requireViewer, uuid } from '../lib'
import { meResponse } from './players'

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
function allClubs(db: D1Database): Promise<Array<ClubSummary & { memberIds: string[] }>> {
  return cachedDirectory(db, 'clubs', () => loadClubs(db))
}

async function loadClubs(db: D1Database): Promise<Array<ClubSummary & { memberIds: string[] }>> {
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

/** Sets the signed-in player's club (from a club's invite link or poster). */
clubRoutes.post('/clubs/:slug/join', async (c) => {
  const v = requireViewer(c)
  const p = v.player
  if (!p) throw bad('Finish setting up your profile first')
  const club = (await allClubs(c.env.DB)).find((x) => x.slug === c.req.param('slug'))
  if (!club) throw notFound('Club not found')
  if (p.club_slug === club.slug) return c.json(meResponse(v, c.env))
  const db = c.env.DB
  await db.batch([
    db.prepare('UPDATE players SET club = ?, club_slug = ? WHERE id = ?').bind(club.name, club.slug, p.id),
    auditStmt(db, v, {
      entityType: 'players',
      entityId: p.id,
      op: 'update',
      summary: `${p.name} joined ${club.name}`,
      changed: { club: [p.club, club.name] },
      players: [p.id],
      clubs: [p.club_slug, club.slug],
    }),
  ])
  v.player = { ...p, club: club.name, club_slug: club.slug }
  return c.json(meResponse(v, c.env))
})

/**
 * Club admins (and global admins) add their members in bulk from a spreadsheet. New
 * emails become unclaimed players in this club; anyone already on Boast is left alone.
 */
clubRoutes.post('/clubs/:slug/import', async (c) => {
  const v = requireViewer(c)
  const slug = c.req.param('slug')
  if (!v.isAdmin && !v.clubAdminSlugs.has(slug)) throw forbidden('Only this club’s admins can import members')
  const club = (await allClubs(c.env.DB)).find((x) => x.slug === slug)
  if (!club) throw notFound('Club not found')
  const { members } = await body(c, ImportMembersInput)
  const db = c.env.DB
  const byNorm = new Map(members.map((m) => [normEmail(m.email)!, m]))
  const { results: found } = await db
    .prepare('SELECT id, name, email_norm, club_slug FROM players WHERE email_norm IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...byNorm.keys()]))
    .all<{ id: string; name: string; email_norm: string; club_slug: string | null }>()
  const taken = new Set(found.map((f) => f.email_norm))
  const rows = [...byNorm.entries()]
    .filter(([key]) => !taken.has(key))
    .map(([key, m]) => {
      const country = (m.country && canonicalCountry(m.country)) || club.country
      return {
        id: uuid(),
        name: m.name,
        email: m.email,
        email_norm: key,
        club: club.name,
        club_slug: club.slug,
        starting_level: m.rating ?? DEFAULT_STARTING_LEVEL,
        seeded_rating: m.rating ? 1 : 0,
        gender: m.gender,
        birth_year: m.birthYear != null && validBirthYear(m.birthYear) ? m.birthYear : null,
        phone: m.phone,
        city: m.city || club.city,
        country,
        dominant_hand: m.dominantHand,
      }
    })
  if (rows.length) {
    const cols = Object.keys(rows[0]) as Array<keyof (typeof rows)[0]>
    await db.batch([
      db
        .prepare(
          `INSERT INTO players (${cols.join(', ')}, current_level, created_by)
           SELECT ${cols.map((k) => `j.value->>'$.${k}'`).join(', ')}, j.value->>'$.starting_level', ?2 FROM json_each(?1) j`,
        )
        .bind(JSON.stringify(rows), v.userId),
      auditStmt(db, v, {
        entityType: 'players',
        entityId: null,
        op: 'insert',
        summary: `Imported ${rows.length} ${rows.length === 1 ? 'member' : 'members'} into ${club.name}`,
        changed: { players: rows.map((r) => ({ id: r.id, name: r.name, email: r.email })) },
        players: rows.map((r) => r.id),
        clubs: [club.slug],
      }),
    ])
  }
  const result: ImportMembersResult = {
    added: rows.map((r) => ({ id: r.id, name: r.name })),
    existing: found.map((f) => ({ id: f.id, name: f.name, inClub: f.club_slug === club.slug })),
  }
  return c.json(result)
})
