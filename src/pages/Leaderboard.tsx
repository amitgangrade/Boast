import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { signIn, useActivity, usePlayers } from '../api'
import { LeaderboardTable } from '../components/LeaderboardTable'
import { matchesQuery, playerHay } from '../components/PlayerSearch'
import { EmptyState, ErrorText, Loading } from '../components/ui'
import { useViewer } from '../viewer'

const FILTERS = ['club', 'country', 'city'] as const
const PAGE = 50

function Hero({ count }: { count: number }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-ink-900 px-6 py-8 text-white sm:px-10 sm:py-12">
      <p className="text-sm font-semibold uppercase tracking-widest text-ball-300">Squash ratings</p>
      <h1 className="mt-2 max-w-xl text-3xl font-extrabold leading-tight sm:text-4xl">Every match moves your level.</h1>
      <p className="mt-3 max-w-xl text-ink-200">
        Log your matches, have your opponent confirm, and see exactly where you stand against {count > 0 ? `${count.toLocaleString()} players` : 'everyone you play'}. Free.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button className="btn-accent" onClick={() => signIn()}>
          Sign in with Google
        </button>
        <Link to="/about" className="btn text-white ring-1 ring-white/30 hover:bg-white/10">
          How levels work
        </Link>
      </div>
    </section>
  )
}

export function LeaderboardPage() {
  const { players, isLoading, error } = usePlayers()
  const v = useViewer()
  const { data: activity } = useActivity(v.signedIn && !!v.myPlayer)
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)

  const active = FILTERS.filter((k) => params.get(k))
  const rows = useMemo(() => {
    const ranked = [...players].sort((a, b) => b.currentLevel - a.currentLevel || a.name.localeCompare(b.name))
    return ranked.filter((p) => {
      for (const k of active) if ((p[k] ?? '').toLowerCase() !== params.get(k)!.toLowerCase()) return false
      return matchesQuery(playerHay(p), q)
    })
  }, [players, params, q, active])

  const clear = (k?: string) => {
    const next = new URLSearchParams(params)
    for (const f of k ? [k] : FILTERS) next.delete(f)
    setParams(next, { replace: true })
    setPage(0)
  }

  const pending = activity?.pendingForMe.length ?? 0

  return (
    <div className="space-y-6">
      {!v.signedIn && <Hero count={players.length} />}
      {pending > 0 && (
        <Link to="/activity" className="card flex items-center gap-3 ring-2 ring-ball-400 hover:bg-ball-300/25 dark:ring-ball-400 dark:hover:bg-ink-800">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-ball-400 font-bold text-black">{pending}</span>
          <span className="flex-1 text-sm">
            <strong>{pending === 1 ? 'A match is' : `${pending} matches are`} waiting for you to confirm.</strong>
            <span className="block text-xs muted">They confirm automatically after 3 days.</span>
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1>Leaderboard</h1>
          <Link to="/about" className="text-sm link">
            How levels work
          </Link>
        </div>
        {active.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {active.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full bg-ink-100 py-1 pl-3 pr-1 text-xs font-medium text-ink-800 dark:bg-ink-800 dark:text-ink-100">
                <span className="capitalize muted">{k}:</span> {params.get(k)}
                <button className="grid h-5 w-5 place-items-center rounded-full hover:bg-ink-200 dark:hover:bg-ink-700" onClick={() => clear(k)} aria-label={`Remove ${k} filter`}>
                  ×
                </button>
              </span>
            ))}
            <button className="text-xs link" onClick={() => clear()}>
              Clear all
            </button>
          </div>
        )}
        {players.length > 0 && (
          <input
            type="search"
            className="input sm:max-w-sm"
            placeholder="Search by name, club, city, country…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(0)
            }}
          />
        )}
        <ErrorText error={error} />
        {isLoading ? (
          <Loading variant="rows" />
        ) : players.length === 0 ? (
          <EmptyState title="No players yet">Sign in and log a match to get the leaderboard going.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title="Nobody matches" action={<button className="btn-secondary btn-sm" onClick={() => { clear(); setQ('') }}>Clear search and filters</button>}>
            Try a different name, club or place.
          </EmptyState>
        ) : (
          <>
            <LeaderboardTable players={rows.slice(page * PAGE, (page + 1) * PAGE)} offset={page * PAGE} />
            {rows.length > PAGE && (
              <div className="flex items-center justify-between text-sm">
                <button className="btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  ← Previous
                </button>
                <span className="muted">
                  {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}
                </span>
                <button className="btn-secondary btn-sm" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
