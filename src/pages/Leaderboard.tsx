import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Player } from '../../shared/api'
import { ACTIVE_DAYS, AGE_GROUPS, inAgeGroup, isActive } from '../../shared/stats'
import { signIn, useActivity, usePlayers } from '../api'
import { LeaderboardTable, type Movement } from '../components/LeaderboardTable'
import { matchesQuery, playerHay } from '../components/PlayerSearch'
import { EmptyState, ErrorText, Loading, Segmented } from '../components/ui'
import { useViewer } from '../viewer'

const PLACE_FILTERS = ['club', 'country', 'city'] as const
/** Every filter lives in the URL, so Back, refresh and shared links keep it. */
const ALL_KEYS = [...PLACE_FILTERS, 'gender', 'age', 'all', 'q', 'page'] as const
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

const distinct = (players: Player[], key: 'club' | 'country' | 'city') =>
  [...new Set(players.map((p) => p[key]).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b))

const FILTER_LABEL: Record<string, string> = { club: 'Club', country: 'Country', city: 'City', gender: 'Gender', age: 'Age' }
const GENDER_VALUE: Record<string, string> = { male: 'Men', female: 'Women' }

export function LeaderboardPage() {
  const { players, isLoading, error } = usePlayers()
  const v = useViewer()
  const { data: activity } = useActivity(v.signedIn && !!v.myPlayer)
  const [params, setParams] = useSearchParams()
  const [panelOpen, setPanelOpen] = useState(false)

  const q = params.get('q') ?? ''
  const page = Math.max(0, Number(params.get('page') ?? 1) - 1) || 0
  const gender = params.get('gender') ?? ''
  const age = params.get('age') ?? ''
  const showInactive = params.get('all') === '1'

  const update = (changes: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, val] of Object.entries(changes)) {
      if (val) next.set(k, val)
      else next.delete(k)
    }
    if (resetPage && !('page' in changes)) next.delete('page')
    setParams(next, { replace: true })
  }

  const activeFilters = [...PLACE_FILTERS, 'gender', 'age'].filter((k) => params.get(k))

  const { rows, movement, hiddenInactive } = useMemo(() => {
    const ranked = [...players].sort((a, b) => b.currentLevel - a.currentLevel || a.name.localeCompare(b.name))
    let inactive = 0
    const rows = ranked.filter((p) => {
      for (const k of PLACE_FILTERS) {
        const want = params.get(k)
        if (want && (p[k] ?? '').toLowerCase() !== want.toLowerCase()) return false
      }
      if (gender && p.gender !== gender) return false
      if (age && !inAgeGroup(p, age)) return false
      if (!matchesQuery(playerHay(p), q)) return false
      if (!showInactive && !isActive(p)) {
        inactive++
        return false
      }
      return true
    })
    // Movement: rank now vs rank a week ago, within the same filtered list.
    const before = rows.filter((p) => p.prevLevel != null).sort((a, b) => b.prevLevel! - a.prevLevel! || a.name.localeCompare(b.name))
    const prevRank = new Map(before.map((p, i) => [p.id, i]))
    const movement = new Map<string, Movement>(rows.map((p, i) => [p.id, prevRank.has(p.id) ? prevRank.get(p.id)! - i : 'new']))
    return { rows, movement, hiddenInactive: inactive }
  }, [players, params, q, gender, age, showInactive])

  const pending = activity?.pendingForMe.length ?? 0
  const pages = Math.ceil(rows.length / PAGE)
  const safePage = Math.min(page, Math.max(0, pages - 1))

  const clearAll = () => update(Object.fromEntries(ALL_KEYS.map((k) => [k, null])))

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

        {players.length > 0 && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="search"
                className="input sm:max-w-sm"
                placeholder="Search by name, club, city, country…"
                value={q}
                onChange={(e) => update({ q: e.target.value || null })}
                aria-label="Search players"
              />
              <button
                type="button"
                className="btn-secondary shrink-0 sm:hidden"
                aria-expanded={panelOpen}
                aria-controls="leaderboard-filters"
                onClick={() => setPanelOpen((o) => !o)}
              >
                Filters{activeFilters.length > 0 && <span className="tag bg-ball-400 text-black">{activeFilters.length}</span>}
              </button>
            </div>
            <div
              id="leaderboard-filters"
              className={clsx('card grid-cols-2 gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_auto_1fr_auto]', panelOpen ? 'grid' : 'hidden')}
            >
              {PLACE_FILTERS.map((k) => (
                <label key={k} className={clsx('block min-w-0', k === 'club' && 'col-span-2 sm:col-span-1')}>
                  <span className="label">{FILTER_LABEL[k]}</span>
                  <select className="input" value={params.get(k) ?? ''} onChange={(e) => update({ [k]: e.target.value || null })}>
                    <option value="">All</option>
                    {distinct(
                      k === 'city' && params.get('country') ? players.filter((p) => p.country?.toLowerCase() === params.get('country')!.toLowerCase()) : players,
                      k,
                    ).map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <div className="col-span-2 sm:col-span-1">
                <span className="label">Gender</span>
                <Segmented
                  label="Gender"
                  value={gender || 'all'}
                  onChange={(g) => update({ gender: g === 'all' ? null : g })}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'male', label: 'Men' },
                    { value: 'female', label: 'Women' },
                  ]}
                />
              </div>
              <label className="block min-w-0">
                <span className="label">Age group</span>
                <select className="input" value={age} onChange={(e) => update({ age: e.target.value || null })}>
                  <option value="">All ages</option>
                  {AGE_GROUPS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={showInactive} onChange={(e) => update({ all: e.target.checked ? '1' : null })} />
                Include inactive
              </label>
            </div>
            {(gender || age) && <p className="hint">Players who haven’t added their {[gender && 'gender', age && 'year of birth'].filter(Boolean).join(' or ')} to their profile aren’t shown.</p>}
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilters.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full bg-ink-100 py-1 pl-3 pr-1 text-xs font-medium text-ink-800 dark:bg-ink-800 dark:text-ink-100">
                <span className="muted">{FILTER_LABEL[k]}:</span>{' '}
                {k === 'gender' ? GENDER_VALUE[params.get(k)!] : k === 'age' ? AGE_GROUPS.find((g) => g.value === age)?.label : params.get(k)}
                <button className="grid h-5 w-5 place-items-center rounded-full hover:bg-ink-200 dark:hover:bg-ink-700" onClick={() => update({ [k]: null })} aria-label={`Remove ${FILTER_LABEL[k]} filter`}>
                  ×
                </button>
              </span>
            ))}
            <button className="text-xs link" onClick={clearAll}>
              Clear all
            </button>
          </div>
        )}

        <ErrorText error={error} />
        {isLoading ? (
          <Loading variant="rows" />
        ) : players.length === 0 ? (
          <EmptyState title="No players yet">Sign in and log a match to get the leaderboard going.</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nobody matches"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {!showInactive && hiddenInactive > 0 && (
                  <button className="btn-secondary btn-sm" onClick={() => update({ all: '1' })}>
                    Include {hiddenInactive} inactive
                  </button>
                )}
                <button className="btn-secondary btn-sm" onClick={clearAll}>
                  Clear search and filters
                </button>
              </div>
            }
          >
            Try a different name, club or place.
          </EmptyState>
        ) : (
          <>
            <p className="text-xs muted">
              {rows.length.toLocaleString()} {showInactive ? '' : 'active '}
              {rows.length === 1 ? 'player' : 'players'}
              {!showInactive && hiddenInactive > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <button className="link" onClick={() => update({ all: '1' })}>
                    show {hiddenInactive} who haven’t played in {Math.round(ACTIVE_DAYS / 30)} months
                  </button>
                </>
              )}
              {' · ▲▼ = places moved this week'}
            </p>
            <LeaderboardTable players={rows.slice(safePage * PAGE, (safePage + 1) * PAGE)} offset={safePage * PAGE} movement={movement} />
            {pages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <button className="btn-secondary btn-sm" disabled={safePage === 0} onClick={() => { update({ page: safePage > 1 ? String(safePage) : null }); window.scrollTo({ top: 0 }) }}>
                  ← Previous
                </button>
                <span className="muted">
                  {safePage * PAGE + 1}–{Math.min(rows.length, (safePage + 1) * PAGE)} of {rows.length}
                </span>
                <button className="btn-secondary btn-sm" disabled={safePage + 1 >= pages} onClick={() => { update({ page: String(safePage + 2) }); window.scrollTo({ top: 0 }) }}>
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
