import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router-dom'
import type { Match } from '../../shared/api'
import { api, usePlayers } from '../api'
import { daysLeftToConfirm, MatchCard } from '../components/MatchCard'
import { ShareButton } from '../components/PlayerActions'
import { Alert, BackLink, EmptyState, Loading } from '../components/ui'

export function MatchPage() {
  const { id } = useParams()
  const { state } = useLocation() as { state: { justLogged?: boolean } | null }
  const { data: m, isLoading, error } = useQuery({ queryKey: ['match', id], queryFn: () => api<Match>(`/matches/${id}`) })
  const { byId } = usePlayers()
  if (isLoading) return <Loading />
  if (error || !m) return <EmptyState title="Match not found">It may have been deleted.</EmptyState>
  const a = byId.get(m.playerAId)
  const b = byId.get(m.playerBId)
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <BackLink to="/history">All matches</BackLink>
      {state?.justLogged && (
        <Alert kind="ok">
          Match saved.{' '}
          {m.status === 'pending'
            ? b && !b.claimed
              ? 'An admin will confirm it because your opponent isn’t on Boast yet.'
              : `It counts once your opponent confirms, or automatically in ${daysLeftToConfirm(m)} days.`
            : 'Levels are updated.'}{' '}
          <Link to="/log" className="link">Log another</Link>
        </Alert>
      )}
      <MatchCard match={m} />
      <ShareButton title={`${a?.name ?? 'Match'} vs ${b?.name ?? ''} on Boast`} path={`/matches/${m.id}`} />
    </div>
  )
}
