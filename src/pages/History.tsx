import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
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
  if (q.isLoading) return <Loading />
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
  const [player, setPlayer] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('all')
  return (
    <div className="space-y-4">
      <h1>Match history</h1>
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
