import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import type { Match, Page } from '../../shared/api'
import { api, usePlayers } from '../api'
import { MatchCard } from '../components/MatchCard'
import { PlayerSearch } from '../components/PlayerSearch'
import { EmptyState, ErrorText, Loading, Segmented } from '../components/ui'

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'disputed'

/** Paginated match feed filtered by player and status. Shared by club and group pages too. */
export function MatchFeed({ filter, empty }: { filter: Record<string, string | undefined>; empty?: string }) {
  const q = useInfiniteQuery({
    queryKey: ['matches', 'feed', filter],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(Object.entries({ ...filter, cursor: pageParam, limit: '30' }).filter(([, v]) => v) as Array<[string, string]>)
      return api<Page<Match>>(`/matches?${params}`)
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const items = q.data?.pages.flatMap((p) => p.items) ?? []
  if (q.isLoading) return <Loading variant="matches" />
  return (
    <div className="space-y-3">
      <ErrorText error={q.error} />
      {items.length === 0 ? (
        <EmptyState title="No matches">{empty ?? 'Nothing matches these filters yet.'}</EmptyState>
      ) : (
        items.map((m) => <MatchCard key={m.id} match={m} perspective={filter.player} />)
      )}
      {q.hasNextPage && (
        <button className="btn-secondary w-full" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}

export function HistoryPage() {
  const { players } = usePlayers()
  // Filters live in the URL so Back, refresh and shared links keep them.
  const [params, setParams] = useSearchParams()
  const player = params.get('player')
  const raw = params.get('status')
  const status: StatusFilter = raw === 'pending' || raw === 'confirmed' || raw === 'disputed' ? raw : 'all'
  const set = (k: string, val: string | null) => {
    const next = new URLSearchParams(params)
    if (val) next.set(k, val)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const setPlayer = (id: string | null) => set('player', id)
  const setStatus = (st: StatusFilter) => set('status', st === 'all' ? null : st)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>Match history</h1>
        <Link to="/h2h" className="text-sm link">
          Compare two players →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <PlayerSearch label="Filter by player" players={players} value={player} onChange={setPlayer} placeholder="Filter by player…" />
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'pending', label: 'Pending' },
            { value: 'disputed', label: 'Disputed' },
          ]}
        />
      </div>
      <MatchFeed filter={{ player: player ?? undefined, status: status === 'all' ? undefined : status }} />
    </div>
  )
}
