import clsx from 'clsx'
import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Challenge } from '../../shared/api'
import { fmtDate } from '../../shared/util'
import { api, signIn, useActivity, useApiMutation, usePlayers } from '../api'
import { daysLeftToConfirm, MatchCard } from '../components/MatchCard'
import { ActionButton, Avatar, EmptyState, ErrorText, Loading, PlayerLink, StatPill } from '../components/ui'
import { useViewer } from '../viewer'

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2>{title}</h2>
        {note && <p className="text-sm muted">{note}</p>}
      </div>
      {children}
    </section>
  )
}

function ChallengeCard({ c, me }: { c: Challenge; me: string }) {
  const { byId } = usePlayers()
  const navigate = useNavigate()
  const incoming = c.toPlayerId === me
  const other = byId.get(incoming ? c.fromPlayerId : c.toPlayerId)
  const respond = useApiMutation((response: 'accepted' | 'declined' | 'cancelled') => api(`/challenges/${c.id}/respond`, { method: 'POST', body: { response } }))
  const act = (response: 'accepted' | 'declined' | 'cancelled') =>
    respond.mutate(response, {
      onSuccess: () => {
        if (response !== 'accepted') return
        const qs = new URLSearchParams({ opponent: incoming ? c.fromPlayerId : c.toPlayerId })
        if (c.proposedDate) qs.set('date', c.proposedDate)
        if (c.venue) qs.set('venue', c.venue)
        navigate(`/log?${qs}`)
      },
    })
  return (
    <div className="card space-y-2">
      <div className="flex items-center gap-3">
        <Avatar name={other?.name ?? '?'} url={other?.avatarUrl} size={36} />
        <div className="min-w-0 flex-1 text-sm">
          {incoming ? (
            <>
              <PlayerLink player={other} className="font-semibold" /> challenged you
            </>
          ) : (
            <>
              You challenged <PlayerLink player={other} className="font-semibold" />
            </>
          )}
          <div className="text-xs muted">
            {fmtDate(c.createdAt)}
            {c.proposedDate && ` · for ${fmtDate(c.proposedDate)}`}
            {c.venue && ` · ${c.venue}`}
          </div>
        </div>
        {c.status !== 'pending' && <StatPill kind={c.status === 'accepted' ? 'confirmed' : 'neutral'}>{c.status}</StatPill>}
      </div>
      {c.message && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm italic dark:bg-ink-800">“{c.message}”</p>}
      <ErrorText error={respond.error} />
      {c.status === 'pending' && (
        <div className="flex gap-2">
          {incoming ? (
            <>
              <ActionButton className="btn-primary btn-sm" status={respond.status} onClick={() => act('accepted')}>
                Accept & log result
              </ActionButton>
              <ActionButton className="btn-secondary btn-sm" status={respond.status} onClick={() => act('declined')}>
                Decline
              </ActionButton>
            </>
          ) : (
            <ActionButton className="btn-secondary btn-sm" status={respond.status} onClick={() => act('cancelled')}>
              Cancel challenge
            </ActionButton>
          )}
        </div>
      )}
    </div>
  )
}

export function ActivityPage() {
  const v = useViewer()
  const { byId } = usePlayers()
  const { data, isLoading, error } = useActivity(v.signedIn && !!v.myPlayer)
  if (!v.signedIn) {
    return (
      <EmptyState title="Sign in to see your activity" action={<button className="btn-primary" onClick={() => signIn('/activity')}>Sign in with Google</button>}>
        Challenges and matches waiting for your confirmation show up here.
      </EmptyState>
    )
  }
  if (isLoading || !data) return error ? <ErrorText error={error} /> : <Loading variant="matches" />
  const me = v.myPlayer!.id
  const action = data.pendingForMe.length + data.incomingChallenges.length
  const waiting = data.myPending.length + data.outgoingChallenges.length
  const empty = action + waiting + data.pastChallenges.length + data.adminPending.length + data.disputed.length === 0

  return (
    <div className="space-y-8">
      <div>
        <h1>Activity</h1>
        <p className={clsx('mt-1 text-sm', action ? 'font-semibold text-ink-800 dark:text-ball-300' : 'muted')}>
          {action ? `${action} ${action === 1 ? 'thing needs' : 'things need'} your response.` : 'Nothing needs your response right now.'} Matches recorded against you confirm automatically after 3 days.
        </p>
      </div>
      {empty && <EmptyState title="All caught up">New challenges and matches to confirm will show up here.</EmptyState>}
      {action > 0 && (
        <Section title="Needs your response">
          {data.incomingChallenges.map((c) => <ChallengeCard key={c.id} c={c} me={me} />)}
          {data.pendingForMe.map((m) => (
            <MatchCard key={m.id} match={m} perspective={me} highlight hint={`Confirms automatically in ${daysLeftToConfirm(m)} ${daysLeftToConfirm(m) === 1 ? 'day' : 'days'} unless you dispute it.`} />
          ))}
        </Section>
      )}
      {waiting > 0 && (
        <Section title="Waiting on others">
          {data.outgoingChallenges.map((c) => <ChallengeCard key={c.id} c={c} me={me} />)}
          {data.myPending.map((m) => (
            <MatchCard key={m.id} match={m} perspective={me} hint={(() => {
              const other = byId.get(m.playerAId === me ? m.playerBId : m.playerAId)
              return other && !other.claimed ? `${other.name} isn’t on Boast yet, so an admin needs to confirm this.` : `Waiting for your opponent — counts automatically in ${daysLeftToConfirm(m)} days.`
            })()} />
          ))}
        </Section>
      )}
      {data.adminPending.length > 0 && (
        <Section title={`Admin: pending matches (${data.adminPending.length})`} note="Matches you’re not in. Most resolve themselves, but matches against players who aren’t on Boast yet need an admin.">
          {data.adminPending.map((m) => {
            const unclaimed = [m.playerAId, m.playerBId].some((id) => byId.get(id) && !byId.get(id)!.claimed)
            return <MatchCard key={m.id} match={m} hint={unclaimed ? 'One player isn’t on Boast yet, so this won’t confirm by itself. Confirm it if you trust the report.' : `Auto-confirms in ${daysLeftToConfirm(m)} days.`} />
          })}
        </Section>
      )}
      {data.disputed.length > 0 && (
        <Section title={`Admin: disputed (${data.disputed.length})`} note="Disputed matches don’t count. Edit the score and set it to confirmed, or delete it.">
          {data.disputed.map((m) => <MatchCard key={m.id} match={m} />)}
        </Section>
      )}
      {data.pastChallenges.length > 0 && (
        <Section title="Recent challenges">
          {data.pastChallenges.map((c) => <ChallengeCard key={c.id} c={c} me={me} />)}
        </Section>
      )}
    </div>
  )
}
