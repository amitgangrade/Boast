import { useQueries } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Match, Page, Player } from '../../shared/api'
import { gamesWon, isProvisional, movingAverage, winnerSide } from '../../shared/rating'
import { ageFromBirthYear, fmtDate, fmtLevel, GENDER_LABEL, HAND_LABEL } from '../../shared/util'
import { api, useMatches, usePlayer, usePlayers, useSettings } from '../api'
import { LevelChart, levelHistory, type Series, SeriesSwatch } from '../components/LevelChart'
import { MatchCard } from '../components/MatchCard'
import { ChallengeButton, EditPlayerModal, ShareButton } from '../components/PlayerActions'
import { PlayerSearch } from '../components/PlayerSearch'
import { Avatar, EmptyState, Loading, playerHref, ProvisionalTag, UnclaimedTag, YouTag } from '../components/ui'
import { useViewer } from '../viewer'

const MAX_COMPARE = 7
const HISTORY_STEP = 30

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs muted">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-xs muted">{sub}</div>}
    </div>
  )
}

export function PlayerPage() {
  const { key } = useParams()
  const navigate = useNavigate()
  const { data: player, isLoading, error } = usePlayer(key)
  const { players, byId } = usePlayers()
  const { data: settings } = useSettings()
  const v = useViewer()
  const { data: page, isLoading: matchesLoading } = useMatches({ player: player?.id, limit: 2000 }, { enabled: !!player })
  const matches = useMemo(() => page?.items ?? [], [page])
  const [editing, setEditing] = useState(false)
  const [compare, setCompare] = useState<Array<{ id: string; slot: number }>>([])
  const [opponent, setOpponent] = useState<string | null>(null)
  const [shown, setShown] = useState(HISTORY_STEP)
  const [table, setTable] = useState(false)

  useEffect(() => {
    if (player?.username && key !== player.username) navigate(playerHref(player), { replace: true })
  }, [player, key, navigate])
  useEffect(() => {
    setCompare([])
    setOpponent(null)
    setShown(HISTORY_STEP)
  }, [player?.id])

  const comparedMatches = useQueries({
    queries: compare.map((c) => ({
      queryKey: ['matches', { player: c.id, limit: 2000 }],
      queryFn: () => api<Page<Match>>(`/matches?player=${c.id}&limit=2000`),
    })),
  })

  const stats = useMemo(() => {
    if (!player) return null
    let wins = 0
    let losses = 0
    for (const m of matches) {
      if (m.status !== 'confirmed') continue
      const w = winnerSide(m.games)
      if (w == null) continue
      if ((w === 'a') === (m.playerAId === player.id)) wins++
      else losses++
    }
    return { wins, losses }
  }, [matches, player])

  const series: Series[] = useMemo(() => {
    if (!player) return []
    const out: Series[] = [{ id: player.id, name: player.name, slot: 1, points: levelHistory(player.id, player.startingLevel, player.createdAt, matches) }]
    compare.forEach((c, i) => {
      const p = byId.get(c.id)
      const ms = comparedMatches[i]?.data?.items
      if (p && ms) out.push({ id: p.id, name: p.name, slot: c.slot, points: levelHistory(p.id, p.startingLevel, p.createdAt, ms) })
    })
    return out
  }, [player, matches, compare, comparedMatches, byId])

  const opponents = useMemo(() => {
    const ids = new Set<string>()
    for (const m of matches) ids.add(m.playerAId === player?.id ? m.playerBId : m.playerAId)
    return players.filter((p) => ids.has(p.id))
  }, [matches, players, player])

  const h2h = useMemo(() => {
    if (!player || !opponent) return null
    const ms = matches.filter((m) => m.playerAId === opponent || m.playerBId === opponent)
    let w = 0, l = 0, d = 0, gf = 0, ga = 0, pf = 0, pa = 0
    for (const m of ms) {
      const side = m.playerAId === player.id ? 'a' : 'b'
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
    return { ms, w, l, d, gf, ga, pf, pa }
  }, [matches, opponent, player])

  if (isLoading) return <Loading variant="player" />
  if (error || !player) {
    return (
      <EmptyState title="Player not found" action={<Link to="/" className="btn-secondary btn-sm">Back to leaderboard</Link>}>
        The link may be old, or the player was removed.
      </EmptyState>
    )
  }

  const isMe = v.myPlayer?.id === player.id
  const provisional = !!settings && isProvisional(player, settings)
  const recent = series[0]?.points.map((p) => p.level) ?? []
  const avg = recent.length > 1 && settings ? movingAverage(recent.slice(1), settings.movingAverageWindow) : player.currentLevel
  const decided = (stats?.wins ?? 0) + (stats?.losses ?? 0)
  const age = ageFromBirthYear(player.birthYear)
  const freeSlot = () => [2, 3, 4, 5, 6, 7, 8].find((s) => !compare.some((c) => c.slot === s))!

  return (
    <div className="space-y-6">
      <section className="card space-y-5">
        <div className="flex items-start gap-4">
          <Avatar name={player.name} url={player.avatarUrl} size={72} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate">{player.name}</h1>
              {!player.claimed && <UnclaimedTag />}
              {provisional && <ProvisionalTag full />}
              {isMe && <YouTag />}
            </div>
            <div className="flex flex-wrap gap-x-1.5 text-sm muted">
              {[
                player.club && player.clubSlug && <Link key="club" to={`/clubs/${player.clubSlug}`} className="hover:underline">{player.club}</Link>,
                player.city && <Link key="city" to={`/?city=${encodeURIComponent(player.city)}`} className="hover:underline">{player.city}</Link>,
                player.country && <Link key="country" to={`/?country=${encodeURIComponent(player.country)}`} className="hover:underline">{player.country}</Link>,
              ]
                .filter(Boolean)
                .flatMap((el, i) => (i ? [<span key={`sep${i}`} aria-hidden>·</span>, el] : [el]))}
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs muted">
              {player.gender && <span>{GENDER_LABEL[player.gender]}</span>}
              {player.dominantHand && <span>{HAND_LABEL[player.dominantHand]}-handed</span>}
              {age != null && <span>Age {age}</span>}
              {player.email && <span>{player.email}</span>}
              {player.phone && <span>{player.phone}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isMe && <Link to="/profile" className="btn-secondary btn-sm">Edit profile</Link>}
          {!isMe && v.myPlayer && <ChallengeButton to={player} />}
          {!isMe && v.myPlayer && <Link to={`/log?opponent=${player.id}`} className="btn-secondary btn-sm">Log a match vs {player.name.split(' ')[0]}</Link>}
          <ShareButton title={`${player.name} on Boast`} path={playerHref(player)} />
          {v.canEditPlayer(player) && !isMe && (
            <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>
              Edit (admin)
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 dark:border-ink-800 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <div className="text-xs muted">Current level</div>
            <div className="text-4xl font-extrabold">{fmtLevel(player.currentLevel)}</div>
            <div className="text-xs muted">
              Started at {fmtLevel(player.startingLevel)} · {fmtDate(player.createdAt)}
            </div>
          </div>
          <Stat label={`${settings?.movingAverageWindow ?? 4}-match average`} value={fmtLevel(avg)} />
          <Stat label="Rated matches" value={String(player.matchesPlayed)} />
          <Stat label="Win rate" value={decided ? `${Math.round(((stats?.wins ?? 0) / decided) * 100)}%` : '—'} sub={decided ? `${stats!.wins}W · ${stats!.losses}L` : undefined} />
        </div>
        {player.notes && <p className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-ink-800">Admin notes: {player.notes}</p>}
      </section>

      {(series[0]?.points.length ?? 0) > 1 && (
        <section className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2>Level over time</h2>
            <button className="text-sm link" onClick={() => setTable((t) => !t)}>
              {table ? 'Show chart' : 'Show as table'}
            </button>
          </div>
          {table ? (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs muted">
                  <tr>
                    <th className="py-1">Date</th>
                    <th className="py-1 text-right">{player.name}’s level</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {series[0].points
                    .slice()
                    .reverse()
                    .map((p, i) => (
                      <tr key={i} className="border-t border-slate-100 dark:border-ink-800">
                        <td className="py-1">{fmtDate(new Date(p.t).toISOString())}</td>
                        <td className="py-1 text-right font-medium">{fmtLevel(p.level)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <LevelChart series={series} />
          )}
          {series.length > 1 && (
            <ul className="flex flex-wrap gap-2" aria-label="Legend">
              {series.map((s) => (
                <li key={s.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-xs font-medium dark:bg-ink-800">
                  <SeriesSwatch slot={s.slot} />
                  {s.name}
                  {s.id !== player.id ? (
                    <button className="grid h-6 w-6 place-items-center rounded-full hover:bg-slate-200 dark:hover:bg-ink-700" aria-label={`Stop comparing ${s.name}`} onClick={() => setCompare((cs) => cs.filter((c) => c.id !== s.id))}>
                      ×
                    </button>
                  ) : (
                    <span className="w-1" />
                  )}
                </li>
              ))}
            </ul>
          )}
          {compare.length < MAX_COMPARE && (
            <PlayerSearch
              label="Compare with another player"
              players={players}
              value={null}
              exclude={[player.id, ...compare.map((c) => c.id)]}
              placeholder="Compare with another player…"
              onChange={(id) => id && setCompare((cs) => [...cs, { id, slot: freeSlot() }])}
            />
          )}
        </section>
      )}

      <section className="card space-y-3">
        <h2>Head to head</h2>
        {opponents.length === 0 ? (
          <p className="text-sm muted">No opponents yet.</p>
        ) : (
          <select className="input sm:max-w-sm" value={opponent ?? ''} onChange={(e) => setOpponent(e.target.value || null)} aria-label="Pick an opponent">
            <option value="">Pick a past opponent…</option>
            {opponents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {h2h && (
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Won – lost" value={`${h2h.w}–${h2h.l}`} sub={h2h.d ? `${h2h.d} drawn` : undefined} />
            <Stat label="Games" value={`${h2h.gf}–${h2h.ga}`} />
            <Stat label="Points" value={`${h2h.pf}–${h2h.pa}`} />
          </div>
        )}
        {h2h && h2h.ms.map((m) => <MatchCard key={m.id} match={m} perspective={player.id} />)}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2>Matches</h2>
          <span className="text-sm muted">{matches.length} total</span>
        </div>
        {matchesLoading ? (
          <Loading variant="matches" />
        ) : matches.length === 0 ? (
          <EmptyState title="No matches yet" action={isMe ? <Link to="/log" className="btn-primary btn-sm">Log a match</Link> : undefined}>
            {isMe ? 'Log your first match to start tracking your level.' : `${player.name} hasn’t played on Boast yet.`}
          </EmptyState>
        ) : (
          <>
            {matches.slice(0, shown).map((m) => (
              <MatchCard key={m.id} match={m} perspective={player.id} />
            ))}
            {shown < matches.length && (
              <button className="btn-secondary w-full" onClick={() => setShown((n) => n + HISTORY_STEP)}>
                Show more
              </button>
            )}
          </>
        )}
      </section>
      {editing && <EditPlayerModal player={player as Player} onClose={() => setEditing(false)} />}
    </div>
  )
}
