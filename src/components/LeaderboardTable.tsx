import clsx from 'clsx'
import { Link } from 'react-router-dom'
import type { Player } from '../../shared/api'
import { isProvisional, type Settings } from '../../shared/rating'
import { ageFromBirthYear, fmtDate, fmtLevel } from '../../shared/util'
import { useSettings } from '../api'
import { useViewer } from '../viewer'
import { Avatar, PlayerLink, playerHref, ProvisionalTag, UnclaimedTag, YouTag } from './ui'

function Rank({ n }: { n: number }) {
  return (
    <span
      className={clsx(
        'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums',
        n === 1 && 'bg-ball-400 text-ink-950',
        n === 2 && 'bg-ink-200 text-ink-950',
        n === 3 && 'bg-ink-800 text-ball-300 dark:bg-ink-600 dark:text-ball-300',
        n > 3 && 'text-slate-500 dark:text-slate-400',
      )}
    >
      {n}
    </span>
  )
}

/** Places moved since last week (positive = up), or 'new' for players who joined since. */
export type Movement = number | 'new'

function MovementTag({ m }: { m: Movement | undefined }) {
  if (m === undefined) return null
  if (m === 'new') return <span className="text-[10px] font-bold uppercase tracking-wide text-ink-600 dark:text-ball-300" title="Joined this week">new</span>
  if (m === 0) return <span className="w-6 text-center text-xs muted" aria-label="No change this week">–</span>
  const up = m > 0
  return (
    <span
      className={clsx('inline-flex items-center text-xs font-bold tabular-nums', up ? 'text-ink-700 dark:text-ball-300' : 'muted')}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(m)} ${Math.abs(m) === 1 ? 'place' : 'places'} this week`}
    >
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      {Math.abs(m)}
      <span className="sr-only">{up ? ' places up' : ' places down'} this week</span>
    </span>
  )
}

const lastPlayedText = (p: Player) => (p.lastPlayed ? `Last played ${fmtDate(p.lastPlayed)}` : 'No matches yet')

const filterLink = (key: string, value: string | null) => (value ? <Link to={`/?${key}=${encodeURIComponent(value)}`} className="hover:underline">{value}</Link> : null)

/** Ranked list of players: cards on phones, a table on wider screens. */
export function LeaderboardTable({ players, offset = 0, compact, movement }: { players: Player[]; offset?: number; compact?: boolean; movement?: Map<string, Movement> }) {
  const { data: settings } = useSettings()
  const { myPlayer } = useViewer()
  const prov = (p: Player) => !!settings && isProvisional(p, settings as Settings)
  return (
    <>
      <ul className={clsx('space-y-2', !compact && 'sm:hidden')}>
        {players.map((p, i) => (
          <li key={p.id} className={clsx('card flex items-center gap-3 py-3', myPlayer?.id === p.id && 'ring-2 ring-ball-400/70')}>
            <div className="flex w-7 shrink-0 flex-col items-center gap-0.5">
              <Rank n={offset + i + 1} />
              <MovementTag m={movement?.get(p.id)} />
            </div>
            <Link to={playerHref(p)} aria-hidden tabIndex={-1}>
              <Avatar name={p.name} url={p.avatarUrl} size={36} />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <PlayerLink player={p} className="truncate font-medium" />
                {!p.claimed && <UnclaimedTag />}
                {prov(p) && <ProvisionalTag />}
                {myPlayer?.id === p.id && <YouTag />}
              </div>
              <div className="truncate text-xs muted">{[p.club, p.city, p.country].filter(Boolean).join(' · ')}</div>
              <div className="truncate text-[11px] muted">{lastPlayedText(p)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-lg font-bold leading-none tabular-nums">{fmtLevel(p.currentLevel)}</div>
              <div className="mt-1 text-[11px] tabular-nums muted">
                {p.matchesPlayed} {p.matchesPlayed === 1 ? 'match' : 'matches'}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!compact && (
        <div className="card hidden overflow-x-auto p-0 sm:block">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide muted">
              <tr className="border-b border-slate-100 dark:border-ink-800">
                <th className="px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">Player</th>
                <th className="px-3 py-2.5">Club</th>
                <th className="px-3 py-2.5">Location</th>
                <th className="hidden px-3 py-2.5 text-right lg:table-cell">Age</th>
                <th className="px-3 py-2.5 text-right">Matches</th>
                <th className="hidden px-3 py-2.5 text-right lg:table-cell">Last played</th>
                <th className="px-3 py-2.5 text-right">Level</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => (
                <tr key={p.id} className={clsx('border-b border-slate-100 last:border-0 dark:border-ink-800', myPlayer?.id === p.id && 'bg-ball-300/15')}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Rank n={offset + i + 1} />
                      <MovementTag m={movement?.get(p.id)} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={p.name} url={p.avatarUrl} size={28} />
                      <PlayerLink player={p} className="font-medium" />
                      {!p.claimed && <UnclaimedTag />}
                      {prov(p) && <ProvisionalTag />}
                      {myPlayer?.id === p.id && <YouTag />}
                    </div>
                  </td>
                  <td className="max-w-48 truncate px-3 py-2 muted">{filterLink('club', p.club)}</td>
                  <td className="max-w-48 truncate px-3 py-2 muted">
                    {filterLink('city', p.city)}
                    {p.city && p.country && ', '}
                    {filterLink('country', p.country)}
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular-nums muted lg:table-cell">{ageFromBirthYear(p.birthYear) ?? ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums muted">{p.matchesPlayed}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums muted lg:table-cell">{p.lastPlayed ? fmtDate(p.lastPlayed) : '—'}</td>
                  <td className="px-3 py-2 text-right text-base font-bold tabular-nums">{fmtLevel(p.currentLevel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
