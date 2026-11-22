import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { AuditEvent } from '../../shared/api'
import { api } from '../api'
import { EmptyState, ErrorText, Loading, StatPill } from '../components/ui'
import { useViewer } from '../viewer'

const ENTITIES: Array<[string, string]> = [
  ['', 'Everything'],
  ['matches', 'Matches'],
  ['players', 'Players'],
  ['challenges', 'Challenges'],
  ['groups', 'Groups'],
  ['group_members', 'Group members'],
  ['clubs', 'Clubs'],
  ['club_admins', 'Club admins'],
  ['users', 'Admin changes'],
  ['settings', 'Settings & maintenance'],
]

function Changes({ changed }: { changed: unknown }) {
  const [open, setOpen] = useState(false)
  if (!changed) return null
  return (
    <div>
      <button className="text-xs link" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide details' : 'Details'}
      </button>
      {open && <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px] leading-snug dark:bg-ink-800">{JSON.stringify(changed, null, 2)}</pre>}
    </div>
  )
}

export function AuditPage() {
  const v = useViewer()
  const [entity, setEntity] = useState('')
  const q = useInfiniteQuery({
    queryKey: ['audit', entity],
    initialPageParam: 0,
    enabled: v.hasAdminScope,
    queryFn: ({ pageParam }) => api<AuditEvent[]>(`/audit?entity=${entity}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1].id : undefined),
  })
  if (!v.hasAdminScope) return <EmptyState title="Admins only">Global, club and group admins can see the audit log.</EmptyState>
  const events = q.data?.pages.flat() ?? []
  return (
    <div className="space-y-4">
      <div>
        <h1>Audit log</h1>
        <p className="text-sm muted">{v.isAdmin ? 'Every change across Boast, newest first.' : 'Changes involving your clubs, groups and their members, newest first.'}</p>
      </div>
      <select className="input sm:max-w-xs" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter by type">
        {ENTITIES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <ErrorText error={q.error} />
      {q.isLoading ? (
        <Loading variant="rows" />
      ) : events.length === 0 ? (
        <EmptyState title="Nothing here yet" />
      ) : (
        <ul className="card divide-y divide-slate-100 p-0 dark:divide-ink-800">
          {events.map((e) => (
            <li key={e.id} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatPill kind={e.op === 'delete' ? 'disputed' : e.op === 'insert' ? 'confirmed' : 'neutral'}>{e.op}</StatPill>
                <span className="font-medium">{e.summary ?? `${e.entityType} ${e.entityId}`}</span>
              </div>
              <div className="text-xs muted">
                {new Date(e.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · {e.actorLabel ?? 'System'}
              </div>
              <Changes changed={e.changed} />
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <button className="btn-secondary w-full" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          Load older
        </button>
      )}
    </div>
  )
}
