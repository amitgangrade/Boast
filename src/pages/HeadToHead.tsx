import clsx from 'clsx'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Player } from '../../shared/api'
import { expectedPerformance, gamesWon } from '../../shared/rating'
import { fmtDate, fmtLevel } from '../../shared/util'
import { useMatches, usePlayers, useSettings } from '../api'
import { LevelChart, levelHistory, type Series, SeriesSwatch } from '../components/LevelChart'
import { MatchCard } from '../components/MatchCard'
import { PlayerSearch } from '../components/PlayerSearch'
import { Avatar, EmptyState, Loading, PlayerLink, playerHref } from '../components/ui'
import { useViewer } from '../viewer'

function Side({ p, align }: { p: Player; align: 'left' | 'right' }) {
  return (
    <Link to={playerHref(p)} className={clsx('flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center sm:flex-row sm:gap-3', align === 'right' && 'sm:flex-row-reverse sm:text-right', align === 'left' && 'sm:text-left')}>
      <Avatar name={p.name} url={p.avatarUrl} size={56} />
      <div className="min-w-0">
        <div className="truncate font-semibold hover:underline">{p.name}</div>
        <div className="text-sm tabular-nums muted">Level {fmtLevel(p.currentLevel)}</div>
      </div>
    </Link>
  )
}

function Tally({ label, a, b }: { label: string; a: number | string; b: number | string }) {
  const na = Number(a)
  const nb = Number(b)
  return (
    <div className="text-center">
      <div className="text-xs muted">{label}</div>
      <div className="text-xl font-bold tabular-nums">
        <span className={clsx(na > nb && 'text-ink-800 dark:text-ball-300')}>{a}</span>
        <span className="mx-1 muted">–</span>
        <span className={clsx(nb > na && 'text-ink-800 dark:text-ball-300')}>{b}</span>
      </div>
    </div>
  )
}

/** Any two players side by side: record, prediction, both level lines and every match between them. */
export function HeadToHeadPage() {
  const [params, setParams] = useSearchParams()
  const aId = params.get('a')
  const bId = params.get('b')
  const { players, byId, isLoading } = usePlayers()
  const { data: settings } = useSettings()
  const v = useViewer()
  const a = aId ? byId.get(aId) : undefined
  const b = bId ? byId.get(bId) : undefined
  const both = !!a && !!b
  const between = useMatches({ player: aId ?? undefined, vs: bId ?? undefined, limit: 2000 }, { enabled: both })
  const histA = useMatches({ player: aId ?? undefined, limit: 2000 }, { enabled: both })
  const histB = useMatches({ player: bId ?? undefined, limit: 2000 }, { enabled: both })

  const set = (k: 'a' | 'b', id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set(k, id)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const swap = () => setParams(new URLSearchParams({ ...(bId && { a: bId }), ...(aId && { b: aId }) }), { replace: true })

  const matches = useMemo(() => (between.data?.items ?? []).filter((m) => m.status !== 'disputed'), [between.data])
  const record = useMemo(() => {
    if (!a) return null
    let w = 0, l = 0, d = 0, gf = 0, ga = 0, pf = 0, pa = 0
    for (const m of matches) {
      if (m.status !== 'confirmed') continue
      const side = m.playerAId === a.id ? 'a' : 'b'
      const other = side === 'a' ? 'b' : 'a'
      const mine = gamesWon(m.games, side)
      const theirs = gamesWon(m.games, other)
      if (mine > theirs) w++
      else if (theirs > mine) l++
      else d++
      gf += mine
      ga += theirs
      for (const g of m.games) {
        pf += g[side]
        pa += g[other]
      }
    }
    return { w, l, d, gf, ga, pf, pa, played: w + l + d }
  }, [matches, a])

  const series: Series[] = useMemo(() => {
    if (!a || !b || !histA.data || !histB.data) return []
    return [
      { id: a.id, name: a.name, slot: 1, points: levelHistory(a.id, a.startingLevel, a.createdAt, histA.data.items) },
      { id: b.id, name: b.name, slot: 2, points: levelHistory(b.id, b.startingLevel, b.createdAt, histB.data.items) },
    ]
  }, [a, b, histA.data, histB.data])

  const expected = a && b && settings ? expectedPerformance(a.currentLevel, b.currentLevel, settings) : null
  const favourite = expected == null ? null : expected >= 0.5 ? a! : b!
  const share = expected == null ? 0 : Math.round(Math.max(expected, 1 - expected) * 100)

  return (
    <div className="space-y-5">
      <h1>Head to head</h1>
      <div className="card grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div>
          <span className="label">Player</span>
          <PlayerSearch label="First player" players={players} value={aId} onChange={(id) => set('a', id)} exclude={bId ? [bId] : []} placeholder="Pick a player…" />
        </div>
        <button type="button" className="btn-ghost btn-sm justify-self-center" onClick={swap} disabled={!aId && !bId} aria-label="Swap players">
          ⇄ Swap
        </button>
        <div>
          <span className="label">Opponent</span>
          <PlayerSearch label="Second player" players={players} value={bId} onChange={(id) => set('b', id)} exclude={aId ? [aId] : []} placeholder="Pick an opponent…" />
        </div>
      </div>

      {isLoading ? (
        <Loading variant="player" />
      ) : !both ? (
        <EmptyState title="Pick two players">Compare any two players — their record against each other, who’s favoured today, and how their levels have moved.</EmptyState>
      ) : (
        <>
          <section className="card space-y-5">
            <div className="flex items-center gap-3">
              <Side p={a} align="left" />
              <span className="shrink-0 text-sm font-bold uppercase tracking-widest muted">vs</span>
              <Side p={b} align="right" />
            </div>
            {between.isLoading ? (
              <Loading variant="rows" count={1} />
            ) : record && record.played > 0 ? (
              <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 dark:border-ink-800">
                <Tally label="Matches won" a={record.w} b={record.l} />
                <Tally label="Games" a={record.gf} b={record.ga} />
                <Tally label="Points" a={record.pf} b={record.pa} />
              </div>
            ) : (
              <p className="border-t border-slate-100 pt-4 text-sm muted dark:border-ink-800">
                {a.name.split(' ')[0]} and {b.name.split(' ')[0]} haven’t played a confirmed match yet.
              </p>
            )}
            {record && record.d > 0 && <p className="-mt-3 text-center text-xs muted">{record.d} drawn</p>}
            {favourite && (
              <p className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-ink-800">
                {share <= 52 ? (
                  <>On today’s levels this is a <strong>coin flip</strong>.</>
                ) : (
                  <>
                    On today’s levels, <PlayerLink player={favourite} className="font-semibold" /> is favoured to win about <strong>{share}%</strong> of the play (points and games
                    combined).
                  </>
                )}{' '}
                {matches[0] && <span className="muted">Last met {fmtDate(matches[0].date)}.</span>}
              </p>
            )}
          </section>

          {series.length === 2 && series.every((s) => s.points.length > 0) && (
            <section className="card space-y-3">
              <h2>Levels over time</h2>
              <LevelChart series={series} />
              <ul className="flex flex-wrap gap-3 text-xs" aria-label="Legend">
                {series.map((s) => (
                  <li key={s.id} className="inline-flex items-center gap-2 font-medium">
                    <SeriesSwatch slot={s.slot} />
                    {s.name}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3">
            <h2>Matches between them</h2>
            {between.isLoading ? (
              <Loading variant="matches" count={2} />
            ) : matches.length === 0 ? (
              <EmptyState
                title="No matches yet"
                action={
                  v.myPlayer && (v.myPlayer.id === a.id || v.myPlayer.id === b.id) ? (
                    <Link className="btn-primary btn-sm" to={`/log?opponent=${v.myPlayer.id === a.id ? b.id : a.id}`}>
                      Log a match
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              matches.map((m) => <MatchCard key={m.id} match={m} perspective={a.id} />)
            )}
          </section>
        </>
      )}
    </div>
  )
}
