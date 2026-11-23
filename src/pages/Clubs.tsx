import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ClubInput } from '../../shared/api'
import { api, useApiMutation, useClub, useClubs, usePlayers } from '../api'
import { LeaderboardTable } from '../components/LeaderboardTable'
import { matchesQuery } from '../components/PlayerSearch'
import { ActionButton, BackLink, EmptyState, ErrorText, Loading, OrgTile } from '../components/ui'
import { useViewer } from '../viewer'
import { MatchFeed } from './History'
import { askConfirm, toast } from '../components/feedback'

function AddClub() {
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const add = useApiMutation((input: ClubInput) => api('/clubs', { method: 'POST', body: input }))
  return (
    <form
      className="card grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault()
        add.mutate({ name, city, country }, { onSuccess: () => { setName(''); setCity(''); setCountry('') } })
      }}
    >
      <input className="input" placeholder="Club name" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Club name" />
      <input className="input" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City" />
      <input className="input" placeholder="Country" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country" />
      <ActionButton className="btn-primary" type="submit" status={add.status} disabled={!name.trim()}>
        Add club
      </ActionButton>
      <div className="sm:col-span-4">
        <ErrorText error={add.error} />
      </div>
    </form>
  )
}

export function ClubsPage() {
  const { data, isLoading, error } = useClubs()
  const v = useViewer()
  const [q, setQ] = useState('')
  const remove = useApiMutation((slug: string) => api(`/clubs/${slug}`, { method: 'DELETE' }))
  const clubs = useMemo(() => (data ?? []).filter((c) => matchesQuery([c.name, c.city, c.country], q)), [data, q])
  return (
    <div className="space-y-4">
      <h1>Clubs</h1>
      <p className="text-sm muted">Clubs form automatically from the club players put on their profile.</p>
      {v.isAdmin && <AddClub />}
      <input type="search" className="input sm:max-w-sm" placeholder="Search clubs by name, city or country…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorText error={error ?? remove.error} />
      {isLoading ? (
        <Loading variant="tiles" />
      ) : clubs.length === 0 ? (
        <EmptyState title="No clubs yet">Set your home club on your profile to start one.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {clubs.map((c) => (
            <li key={c.slug} className="card flex items-center gap-3">
              <OrgTile name={c.name} kind="club" />
              <Link to={`/clubs/${c.slug}`} className="min-w-0 flex-1">
                <div className="truncate font-semibold hover:underline">{c.name}</div>
                <div className="truncate text-xs muted">
                  {[c.city, c.country].filter(Boolean).join(', ') || '—'} · {c.members} {c.members === 1 ? 'member' : 'members'}
                </div>
              </Link>
              {v.isAdmin && c.registered && (
                <ActionButton status={remove.status} className="btn-ghost btn-sm" title="Remove from directory (players keep their club)" onClick={async () =>
                    (await askConfirm({ title: `Remove ${c.name} from the directory?`, message: 'Players keep their club name, and the club reappears automatically while anyone lists it.', confirmLabel: 'Remove club' })) &&
                    remove.mutate(c.slug, { onSuccess: () => toast(`${c.name} removed from the directory`) })
                  }>
                  Remove
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ClubPage() {
  const { slug } = useParams()
  const { data: club, isLoading, error } = useClub(slug)
  const { players } = usePlayers()
  const members = useMemo(() => {
    const ids = new Set(club?.memberIds ?? [])
    return players.filter((p) => ids.has(p.id)).sort((a, b) => b.currentLevel - a.currentLevel)
  }, [club, players])
  if (isLoading) return <Loading variant="page" />
  if (error || !club) return <EmptyState title="Club not found" action={<Link to="/clubs" className="btn-secondary btn-sm">Browse clubs</Link>} />
  return (
    <div className="space-y-6">
      <BackLink to="/clubs">Clubs</BackLink>
      <section className="card flex items-start gap-4">
        <OrgTile name={club.name} kind="club" size={56} />
        <div className="min-w-0 flex-1 space-y-1">
          <h1>{club.name}</h1>
          <p className="text-sm muted">
            {[club.city, club.country].filter(Boolean).join(', ')}
            {club.city || club.country ? ' · ' : ''}
            {club.members} {club.members === 1 ? 'member' : 'members'}
          </p>
          {club.description && <p className="text-sm">{club.description}</p>}
          {club.admins.length > 0 && <p className="text-xs muted">Club admins: {club.admins.map((a) => a.name).join(', ')}</p>}
        </div>
      </section>
      <section className="space-y-3">
        <h2>Club leaderboard</h2>
        {members.length ? <LeaderboardTable players={members} /> : <EmptyState title="No members yet" />}
      </section>
      <section className="space-y-3">
        <h2>Recent matches</h2>
        <MatchFeed filter={{ club: club.slug }} empty="Matches involving members of this club will appear here." />
      </section>
    </div>
  )
}
