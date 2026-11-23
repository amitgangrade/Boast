import { api } from './api'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

const iso = (v: unknown, fallback = new Date().toISOString()) => {
  const d = new Date(String(v ?? ''))
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString()
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const oneOf = (v: unknown, allowed: string[]) => (typeof v === 'string' && allowed.includes(v) ? v : null)
const bit = (v: unknown) => (v ? 1 : 0)

/** Converts a SquashLevel (previous app) backup file into Boast table rows. */
function fromSquashLevel(d: Record<string, unknown>): Tables {
  const profiles = (d.profiles as Row[] | undefined) ?? []
  const profileByUser = new Map(profiles.map((p) => [p.id as string, p]))
  const settings = d.settings as Row | undefined
  return {
    users: profiles.map((p) => ({
      id: p.id,
      email: p.email,
      google_name: str(p.fullName),
      is_admin: bit(p.isAdmin),
      created_at: iso(p.createdAt),
    })),
    players: ((d.players as Row[]) ?? []).map((p) => {
      const prof = p.userId ? profileByUser.get(p.userId as string) : undefined
      return {
        id: p.id,
        user_id: str(p.userId),
        username: str(prof?.username),
        name: str(p.name) ?? 'Unnamed player',
        email: str(p.email)?.toLowerCase() ?? null,
        phone: str(p.phone),
        country: str(p.country),
        city: str(p.city),
        club: str(p.club),
        avatar_url: str(p.avatarUrl),
        birth_year: typeof p.birthYear === 'number' ? p.birthYear : null,
        gender: oneOf(p.gender, ['male', 'female']),
        dominant_hand: oneOf(p.dominantHand, ['right', 'left', 'ambi']),
        notes: str(p.notes),
        starting_level: Number(p.startingLevel) > 0 ? Number(p.startingLevel) : 1000,
        seeded_rating: bit(p.seededRating ?? prof?.seededRating),
        current_level: null,
        matches_played: 0,
        created_by: null,
        created_at: iso(p.createdAt),
      }
    }),
    matches: ((d.matches as Row[]) ?? []).map((m) => ({
      id: m.id,
      date: String(m.date).slice(0, 10),
      player_a_id: m.playerAId,
      player_b_id: m.playerBId,
      games: JSON.stringify(m.games ?? []),
      type: oneOf(m.type, ['friendly', 'box', 'league', 'tournament']) ?? 'friendly',
      venue: str(m.venue),
      notes: str(m.notes),
      status: oneOf(m.status, ['pending', 'confirmed', 'disputed']) ?? 'confirmed',
      unranked: bit(m.unranked),
      auto_confirmed: bit(m.autoConfirmed),
      confirmed_at: m.confirmedAt ? iso(m.confirmedAt) : null,
      disputed_at: m.disputedAt ? iso(m.disputedAt) : null,
      created_by: str(m.createdBy),
      created_at: iso(m.createdAt, iso(`${String(m.date).slice(0, 10)}T12:00:00Z`)),
    })),
    challenges: ((d.challenges as Row[] | undefined) ?? []).map((c) => ({
      id: c.id,
      from_player_id: c.fromPlayerId,
      to_player_id: c.toPlayerId,
      message: str(c.message),
      proposed_date: str(c.proposedDate),
      venue: str(c.venue),
      status: oneOf(c.status, ['pending', 'accepted', 'declined', 'cancelled', 'expired']) ?? 'expired',
      created_by: str(c.createdBy),
      created_at: iso(c.createdAt),
      responded_at: c.respondedAt ? iso(c.respondedAt) : null,
    })),
    clubs: ((d.clubs as Row[] | undefined) ?? []).map((c) => ({
      slug: c.slug,
      name: c.name,
      city: str(c.city),
      country: str(c.country),
      description: str(c.description),
      created_by: str(c.createdBy),
      created_at: iso(c.createdAt),
    })),
    club_admins: ((d.clubAdmins as Row[] | undefined) ?? []).map((c) => ({ user_id: c.userId, club_slug: c.clubSlug, granted_at: iso(c.grantedAt) })),
    groups: ((d.groups as Row[] | undefined) ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      slug: str(g.slug),
      description: str(g.description),
      is_private: bit(g.isPrivate),
      created_by: str(g.createdBy),
      created_at: iso(g.createdAt),
    })),
    group_members: ((d.groupMembers as Row[] | undefined) ?? []).map((m) => ({
      group_id: m.groupId,
      player_id: m.playerId,
      is_admin: bit(m.isAdmin),
      added_by: str(m.addedBy),
      added_at: iso(m.addedAt),
    })),
    settings: settings ? [{ id: 'algorithm', data: JSON.stringify(settings), updated_at: new Date().toISOString() }] : [],
  }
}

const ORDER = ['users', 'players', 'clubs', 'club_admins', 'groups', 'group_members', 'box_rounds', 'box_entries', 'matches', 'challenges', 'settings', 'audit_events']

export interface ImportSummary {
  source: 'boast' | 'squashlevel'
  counts: Record<string, number>
}

/** Reads a backup file (Boast or SquashLevel) and returns its rows without touching the server. */
export function parseBackup(text: string): { tables: Tables; summary: ImportSummary } {
  const d = JSON.parse(text) as Record<string, unknown>
  let tables: Tables
  let source: ImportSummary['source']
  if (d.format === 'boast') {
    source = 'boast'
    tables = Object.fromEntries(ORDER.map((t) => [t, (d[t] as Row[] | undefined) ?? []]))
  } else if (Array.isArray(d.players) && Array.isArray(d.matches)) {
    source = 'squashlevel'
    tables = fromSquashLevel(d)
  } else {
    throw new Error('This doesn’t look like a Boast or SquashLevel backup file.')
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))
  return { tables, summary: { source, counts } }
}

/** Replaces everything on the server with the backup, then copies avatars into Boast's storage. */
export async function runImport(tables: Tables, onStep: (msg: string) => void) {
  onStep('Clearing existing data…')
  await api('/admin/import/begin', { method: 'POST', body: { confirm: 'REPLACE' } })
  for (const table of ORDER) {
    const rows = tables[table] ?? []
    for (let i = 0; i < rows.length; i += 250) {
      onStep(`Importing ${table.replace('_', ' ')}: ${Math.min(i + 250, rows.length)} of ${rows.length}`)
      await api('/admin/import/rows', { method: 'POST', body: { table, rows: rows.slice(i, i + 250) } })
    }
  }
  onStep('Recalculating every level…')
  const result = await api<{ counts: Record<string, number>; merged: boolean }>('/admin/import/finish', { method: 'POST', body: {} })
  let remaining = result.counts.external_avatars ?? 0
  while (remaining > 0) {
    onStep(`Copying profile photos… ${remaining} left`)
    const r = await api<{ remaining: number }>('/admin/import/avatars', { method: 'POST', body: {} })
    remaining = r.remaining
  }
  return result
}
