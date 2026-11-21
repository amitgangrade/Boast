import type { PlayerRow } from './lib'

export interface Viewer {
  userId: string
  email: string
  isAdmin: boolean
  googleName: string | null
  player: PlayerRow | null
  clubAdminSlugs: Set<string>
  /** groupId → member player ids, for groups this viewer administers. */
  groupAdminScope: Map<string, Set<string>>
}

export async function loadViewer(db: D1Database, userId: string): Promise<Viewer | null> {
  const [user, player, clubs, groups] = await db.batch([
    db.prepare('SELECT id, email, is_admin, google_name FROM users WHERE id = ?').bind(userId),
    db.prepare('SELECT * FROM players WHERE user_id = ?').bind(userId),
    db.prepare('SELECT club_slug FROM club_admins WHERE user_id = ?').bind(userId),
    db
      .prepare(
        `SELECT gm.group_id, gm.player_id FROM group_members gm
         WHERE gm.group_id IN (
           SELECT a.group_id FROM group_members a JOIN players p ON p.id = a.player_id
           WHERE p.user_id = ? AND a.is_admin = 1)`,
      )
      .bind(userId),
  ])
  const u = user.results[0] as { id: string; email: string; is_admin: number; google_name: string | null } | undefined
  if (!u) return null
  const scope = new Map<string, Set<string>>()
  for (const r of groups.results as Array<{ group_id: string; player_id: string }>) {
    if (!scope.has(r.group_id)) scope.set(r.group_id, new Set())
    scope.get(r.group_id)!.add(r.player_id)
  }
  return {
    userId: u.id,
    email: u.email,
    isAdmin: !!u.is_admin,
    googleName: u.google_name,
    player: (player.results[0] as PlayerRow | undefined) ?? null,
    clubAdminSlugs: new Set((clubs.results as Array<{ club_slug: string }>).map((r) => r.club_slug)),
    groupAdminScope: scope,
  }
}

type PlayerRef = Pick<PlayerRow, 'id' | 'club_slug'>

export function isClubAdminFor(v: Viewer | null, p: PlayerRef): boolean {
  return !!v && !!p.club_slug && v.clubAdminSlugs.has(p.club_slug)
}

export function isGroupAdminForPair(v: Viewer | null, a: string, b: string): boolean {
  if (!v) return false
  for (const members of v.groupAdminScope.values()) if (members.has(a) && members.has(b)) return true
  return false
}

/**
 * Global admins, club admins of either player's club, and admins of a group
 * containing both players may edit, delete, or confirm a match.
 */
export function canWriteMatch(v: Viewer | null, a: PlayerRef, b: PlayerRef): boolean {
  if (!v) return false
  return v.isAdmin || isClubAdminFor(v, a) || isClubAdminFor(v, b) || isGroupAdminForPair(v, a.id, b.id)
}

export function canEditPlayer(v: Viewer | null, p: PlayerRef): boolean {
  if (!v) return false
  return v.isAdmin || isClubAdminFor(v, p)
}

export function canSeeContact(v: Viewer | null, p: PlayerRef): boolean {
  if (!v) return false
  return v.isAdmin || v.player?.id === p.id || isClubAdminFor(v, p)
}

export function ownsPlayer(v: Viewer | null, playerId: string): boolean {
  return !!v?.player && v.player.id === playerId
}

export function actorLabel(v: Viewer | null): string | null {
  if (!v) return null
  return `${v.player?.name ?? v.googleName ?? ''} <${v.email}>`.trim()
}
