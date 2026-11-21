import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { GroupDetail, GroupInput } from '../../shared/api'
import { winnerSide } from '../../shared/rating'
import { api, signIn, useApiMutation, useGroup, useGroups, useMatches, usePlayers } from '../api'
import { LeaderboardTable } from '../components/LeaderboardTable'
import { matchesQuery, PlayerSearch } from '../components/PlayerSearch'
import { Alert, Avatar, BackLink, EmptyState, ErrorText, Field, Loading, OrgTile, PlayerLink, StatPill } from '../components/ui'
import { useViewer } from '../viewer'
import { MatchFeed } from './History'

function GroupForm({ initial, onSubmit, busy, submitLabel }: { initial?: GroupInput; onSubmit: (g: GroupInput) => void; busy: boolean; submitLabel: string }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [isPrivate, setPrivate] = useState(initial?.isPrivate ?? false)
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ name, description, isPrivate })
      }}
    >
      <Field label="Group name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tuesday night crew" required />
      </Field>
      <Field label="Description" optional>
        <input className="input" value={description ?? ''} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
        Private — only members can see the group
      </label>
      <button className="btn-primary" disabled={busy || !name.trim()}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

export function GroupsPage() {
  const { data, isLoading, error } = useGroups()
  const v = useViewer()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const create = useApiMutation((g: GroupInput) => api<{ slug: string }>('/groups', { method: 'POST', body: g }))
  const groups = useMemo(() => (data ?? []).filter((g) => matchesQuery([g.name, g.description], q)), [data, q])
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>Groups</h1>
        {v.myPlayer ? (
          <button className="btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
            {creating ? 'Close' : '+ New group'}
          </button>
        ) : (
          !v.signedIn && <button className="btn-secondary btn-sm" onClick={() => signIn('/groups')}>Sign in to start a group</button>
        )}
      </div>
      <p className="text-sm muted">A group is your own mini-leaderboard — a box league, a Tuesday crew, a coaching squad. Group admins can fix scores for matches between members.</p>
      {creating && (
        <div className="card">
          <GroupForm busy={create.isPending} submitLabel="Create group" onSubmit={(g) => create.mutate(g, { onSuccess: (r) => navigate(`/groups/${r.slug}`) })} />
          <ErrorText error={create.error} />
        </div>
      )}
      <input type="search" className="input sm:max-w-sm" placeholder="Search groups…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorText error={error} />
      {isLoading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <EmptyState title="No groups yet">Start one for the people you play with.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link to={`/groups/${g.slug}`} className="card flex items-center gap-3 hover:ring-ink-300">
                <OrgTile name={g.name} kind="group" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{g.name}</span>
                    {g.isPrivate && <StatPill kind="neutral">private</StatPill>}
                    {g.viewerIsMember && <StatPill kind="confirmed">{g.viewerIsAdmin ? 'you admin' : 'member'}</StatPill>}
                  </div>
                  <div className="truncate text-xs muted">
                    {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
                    {g.adminNames.length > 0 && ` · run by ${g.adminNames.join(', ')}`}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Manage({ group }: { group: GroupDetail }) {
  const { players, byId } = usePlayers()
  const navigate = useNavigate()
  const [adding, setAdding] = useState<string | null>(null)
  const memberIds = group.members.map((m) => m.playerId)
  const save = useApiMutation((g: GroupInput) => api<{ slug: string }>(`/groups/${group.id}`, { method: 'PATCH', body: g }))
  const setMember = useApiMutation((x: { playerId: string; isAdmin: boolean }) => api(`/groups/${group.id}/members`, { method: 'POST', body: x }))
  const removeMember = useApiMutation((playerId: string) => api(`/groups/${group.id}/members/${playerId}`, { method: 'DELETE' }))
  const del = useApiMutation(() => api(`/groups/${group.id}`, { method: 'DELETE' }))
  return (
    <section className="card space-y-5">
      <h2>Manage group</h2>
      <GroupForm
        initial={{ name: group.name, description: group.description, isPrivate: group.isPrivate }}
        busy={save.isPending}
        submitLabel="Save changes"
        onSubmit={(g) => save.mutate(g, { onSuccess: (r) => r.slug !== group.slug && navigate(`/groups/${r.slug}`, { replace: true }) })}
      />
      <div className="space-y-2">
        <span className="label">Add a member</span>
        <PlayerSearch
          label="Add a member"
          players={players}
          value={adding}
          exclude={memberIds}
          onChange={(id) => {
            setAdding(null)
            if (id) setMember.mutate({ playerId: id, isAdmin: false })
          }}
          placeholder="Search players to add…"
        />
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-ink-800">
        {group.members.map((m) => {
          const p = byId.get(m.playerId)
          return (
            <li key={m.playerId} className="flex flex-wrap items-center gap-2 py-2">
              <Avatar name={p?.name ?? '?'} url={p?.avatarUrl} size={28} />
              <PlayerLink player={p} className="flex-1 text-sm font-medium" />
              {m.isAdmin && <StatPill kind="confirmed">admin</StatPill>}
              <button className="btn-ghost btn-sm" onClick={() => setMember.mutate({ playerId: m.playerId, isAdmin: !m.isAdmin })}>
                {m.isAdmin ? 'Remove admin' : 'Make admin'}
              </button>
              <button className="btn-ghost btn-sm text-red-600" onClick={() => window.confirm(`Remove ${p?.name} from ${group.name}?`) && removeMember.mutate(m.playerId)}>
                Remove
              </button>
            </li>
          )
        })}
      </ul>
      <ErrorText error={save.error ?? setMember.error ?? removeMember.error ?? del.error} />
      <button className="btn-danger btn-sm" onClick={() => window.confirm(`Delete ${group.name}? Matches aren’t affected.`) && del.mutate(undefined, { onSuccess: () => navigate('/groups') })}>
        Delete group
      </button>
    </section>
  )
}

export function GroupPage() {
  const { slug } = useParams()
  const { data: group, isLoading, error } = useGroup(slug)
  const { players, byId } = usePlayers()
  const v = useViewer()
  const navigate = useNavigate()
  const { data: page } = useMatches({ group: group?.id, status: 'confirmed', limit: 1000 }, { enabled: !!group })
  const leave = useApiMutation(() => api(`/groups/${group!.id}/members/${v.myPlayer!.id}`, { method: 'DELETE' }))

  const members = useMemo(() => {
    const ids = new Set(group?.members.map((m) => m.playerId))
    return players.filter((p) => ids.has(p.id)).sort((a, b) => b.currentLevel - a.currentLevel)
  }, [group, players])

  const stats = useMemo(() => {
    const ms = page?.items ?? []
    const count = new Map<string, number>()
    const streak = new Map<string, number>()
    const settled = new Set<string>()
    for (const m of ms) {
      for (const id of [m.playerAId, m.playerBId]) count.set(id, (count.get(id) ?? 0) + 1)
      // Matches are newest first: a player's current streak ends at their first non-win.
      const w = winnerSide(m.games)
      for (const [id, side] of [[m.playerAId, 'a'], [m.playerBId, 'b']] as const) {
        if (settled.has(id)) continue
        if (w === side) streak.set(id, (streak.get(id) ?? 0) + 1)
        else settled.add(id)
      }
    }
    const top = (mp: Map<string, number>) => [...mp.entries()].sort((a, b) => b[1] - a[1])[0]
    return { total: ms.length, active: top(count), hot: top(streak) }
  }, [page])

  if (isLoading) return <Loading />
  if (error || !group) {
    return (
      <EmptyState title="Group not found" action={<Link to="/groups" className="btn-secondary btn-sm">Browse groups</Link>}>
        Private groups are only visible to their members.
      </EmptyState>
    )
  }
  const meMember = group.members.find((m) => m.playerId === v.myPlayer?.id)
  return (
    <div className="space-y-6">
      <BackLink to="/groups">Groups</BackLink>
      <section className="card flex items-start gap-4">
        <OrgTile name={group.name} kind="group" size={56} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1>{group.name}</h1>
            {group.isPrivate && <StatPill kind="neutral">private</StatPill>}
          </div>
          {group.description && <p className="text-sm">{group.description}</p>}
          <p className="text-xs muted">
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
            {group.adminNames.length > 0 && ` · admins: ${group.adminNames.join(', ')}`}
          </p>
          {meMember && !group.viewerIsAdmin && (
            <button className="btn-ghost btn-sm -ml-2" onClick={() => window.confirm(`Leave ${group.name}?`) && leave.mutate(undefined, { onSuccess: () => navigate('/groups') })}>
              Leave group
            </button>
          )}
        </div>
      </section>
      <ErrorText error={leave.error} />
      <section className="grid grid-cols-3 gap-3">
        <div className="card">
          <div className="text-xs muted">Internal matches</div>
          <div className="text-xl font-bold">{stats.total}</div>
        </div>
        <div className="card min-w-0">
          <div className="text-xs muted">Most active</div>
          <div className="truncate font-semibold">{stats.active ? byId.get(stats.active[0])?.name : '—'}</div>
          {stats.active && <div className="text-xs muted">{stats.active[1]} matches</div>}
        </div>
        <div className="card min-w-0">
          <div className="text-xs muted">Hot streak</div>
          <div className="truncate font-semibold">{stats.hot ? byId.get(stats.hot[0])?.name : '—'}</div>
          {stats.hot && <div className="text-xs muted">{stats.hot[1]} wins in a row</div>}
        </div>
      </section>
      <section className="space-y-3">
        <h2>Group leaderboard</h2>
        {members.length ? <LeaderboardTable players={members} /> : <EmptyState title="No members yet" />}
      </section>
      {group.viewerIsAdmin && <Manage group={group} />}
      {!group.viewerIsAdmin && !meMember && v.signedIn && <Alert kind="info">Ask a group admin to add you.</Alert>}
      <section className="space-y-3">
        <h2>Matches between members</h2>
        <MatchFeed filter={{ group: group.id }} empty="When two members play each other, the match shows up here." />
      </section>
    </div>
  )
}
