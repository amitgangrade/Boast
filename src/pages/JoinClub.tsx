import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Me } from '../../shared/api'
import { api, queryClient, signIn, useApiMutation, useClub, usePlayers } from '../api'
import { askConfirm, toast } from '../components/feedback'
import { LeaderboardTable } from '../components/LeaderboardTable'
import { QrCode } from '../components/QrCode'
import { ActionButton, EmptyState, ErrorText, Loading, OrgTile } from '../components/ui'
import { useViewer } from '../viewer'

const PENDING_KEY = 'boast-join-club'

/** Remembers which club a signed-out visitor wanted, so onboarding can pre-fill it. */
export function pendingClub(): { slug: string; name: string } | null {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null')
  } catch {
    return null
  }
}
export function clearPendingClub() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    // Storage blocked: nothing to clear.
  }
}

export const clubJoinUrl = (slug: string) => `${location.origin}/join/${slug}`

/** Landing page for a club's invite link or poster QR code. */
export function JoinClubPage() {
  const { slug } = useParams()
  const { data: club, isLoading, error } = useClub(slug)
  const { players } = usePlayers()
  const v = useViewer()
  const join = useApiMutation(() => api<Me>(`/clubs/${slug}/join`, { method: 'POST' }))
  const top = useMemo(() => {
    const ids = new Set(club?.memberIds ?? [])
    return players.filter((p) => ids.has(p.id)).sort((a, b) => b.currentLevel - a.currentLevel)
  }, [club, players])

  if (isLoading) return <Loading variant="page" />
  if (error || !club) return <EmptyState title="Club not found" action={<Link to="/clubs" className="btn-secondary btn-sm">Browse clubs</Link>} />
  const member = v.myPlayer?.clubSlug === club.slug

  const start = () => {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ slug: club.slug, name: club.name }))
    } catch {
      // Without storage they just type the club during setup.
    }
    signIn(`/join/${club.slug}`)
  }
  const switchClub = async () => {
    if (v.myPlayer?.club && !(await askConfirm({ title: `Switch to ${club.name}?`, message: `Your club is currently ${v.myPlayer.club}. Your matches and level don’t change.`, confirmLabel: `Join ${club.name}` }))) return
    join.mutate(undefined, {
      onSuccess: (me) => {
        queryClient.setQueryData(['me'], me)
        clearPendingClub()
        toast(`Welcome to ${club.name}`)
      },
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="overflow-hidden rounded-2xl bg-ink-900 px-6 py-8 text-white sm:px-10">
        <div className="flex items-center gap-4">
          <OrgTile name={club.name} kind="club" size={56} />
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-widest text-ball-300">Squash ratings</p>
            <h1 className="truncate text-2xl font-extrabold sm:text-3xl">{club.name}</h1>
          </div>
        </div>
        <p className="mt-4 text-ink-200">
          {club.members > 0 ? `${club.members} ${club.members === 1 ? 'player' : 'players'} already track their level here.` : 'Be the first to put your club on the map.'} Log
          your matches, have your opponent confirm, and see where you rank. Free.
        </p>
        <div className="mt-6">
          {member ? (
            <Link to={`/clubs/${club.slug}`} className="btn-accent">
              You’re a member — see the club ladder →
            </Link>
          ) : !v.signedIn ? (
            <button className="btn-accent" onClick={start}>
              Join {club.name}
            </button>
          ) : (
            <ActionButton className="btn-accent" status={join.status} onClick={switchClub}>
              Make {club.name} my club
            </ActionButton>
          )}
        </div>
      </section>
      <ErrorText error={join.error} />
      {top.length > 0 && (
        <section className="space-y-3">
          <h2>Top of the club</h2>
          <LeaderboardTable players={top.slice(0, 5)} compact />
          {top.length > 5 && (
            <Link to={`/clubs/${club.slug}`} className="text-sm link">
              See all {top.length} players →
            </Link>
          )}
        </section>
      )}
    </div>
  )
}

/** Share card on a club page: invite link, WhatsApp, QR and a printable poster. */
export function ClubInvite({ slug, name }: { slug: string; name: string }) {
  const url = clubJoinUrl(slug)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast('Invite link copied')
    } catch {
      toast('Couldn’t copy — long-press the link instead')
    }
  }
  const message = `Join ${name} on Boast — log your squash matches and see where you rank: ${url}`
  return (
    <section className="card flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="shrink-0 self-center">
        <QrCode value={url} size={120} label={`QR code linking to ${url}`} />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h2>Invite players</h2>
          <p className="text-sm muted">Anyone who opens this link or scans the code can join {name} in a minute.</p>
        </div>
        <p className="truncate rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs dark:bg-ink-800">{url}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={copy}>
            Copy link
          </button>
          <a className="btn-accent btn-sm" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
            Share on WhatsApp
          </a>
          <Link className="btn-secondary btn-sm" to={`/clubs/${slug}/poster`}>
            Printable poster
          </Link>
        </div>
      </div>
    </section>
  )
}

/** A4 poster for the club noticeboard: big QR code to the join page. */
export function ClubPosterPage() {
  const { slug } = useParams()
  const { data: club, isLoading } = useClub(slug)
  if (isLoading) return <Loading variant="page" />
  if (!club) return <EmptyState title="Club not found" />
  const url = clubJoinUrl(club.slug)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={`/clubs/${club.slug}`} className="text-sm link">
          ← {club.name}
        </Link>
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print poster
        </button>
      </div>
      <article className="poster mx-auto flex aspect-[210/297] w-full max-w-[560px] flex-col items-center justify-between rounded-2xl bg-ink-800 p-8 text-center text-white shadow-lg print:max-w-none print:rounded-none print:shadow-none sm:p-12">
        <div className="space-y-3">
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-ball-300">{club.name}</p>
          <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">Where do you rank?</h1>
          <p className="text-lg text-ink-100">Log your squash matches. Watch your level move. Free.</p>
        </div>
        <div className="rounded-2xl bg-white p-4">
          <QrCode value={url} size={240} label={`QR code linking to ${url}`} />
        </div>
        <div className="space-y-1">
          <p className="text-xl font-bold text-ball-300">Scan to join the club ladder</p>
          <p className="break-all font-mono text-sm text-ink-100">{url.replace(/^https?:\/\//, '')}</p>
          <p className="pt-2 text-xs font-semibold tracking-widest text-ink-200">BOAST · SQUASH RATINGS</p>
        </div>
      </article>
    </div>
  )
}
