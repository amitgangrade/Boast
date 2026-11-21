import type { Viewer } from './perms'
import { actorLabel } from './perms'

export interface AuditInput {
  entityType: 'players' | 'matches' | 'challenges' | 'clubs' | 'club_admins' | 'groups' | 'group_members' | 'settings' | 'users'
  entityId: string | null
  op: 'insert' | 'update' | 'delete'
  summary?: string
  changed?: unknown
  players?: Array<string | null | undefined>
  clubs?: Array<string | null | undefined>
  groups?: Array<string | null | undefined>
  /** Hidden from club/group admins regardless of scope. */
  privileged?: boolean
}

const clean = (xs: Array<string | null | undefined> | undefined) => JSON.stringify([...new Set((xs ?? []).filter(Boolean))])

/** Audit rows are added to the same batch as the write they describe. */
export function auditStmt(db: D1Database, viewer: Viewer | null, e: AuditInput): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_events (actor_user_id, actor_label, entity_type, entity_id, op, summary, changed,
         subject_player_ids, subject_club_slugs, subject_group_ids, privileged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      viewer?.userId ?? null,
      actorLabel(viewer),
      e.entityType,
      e.entityId,
      e.op,
      e.summary ?? null,
      e.changed === undefined ? null : JSON.stringify(e.changed),
      clean(e.players),
      clean(e.clubs),
      clean(e.groups),
      e.privileged ? 1 : 0,
    )
}

/** Only the fields that actually changed, as { field: [before, after] }. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {}
  for (const k of Object.keys(after)) {
    const a = before[k] ?? null
    const b = after[k] ?? null
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a, b]
  }
  return out
}
