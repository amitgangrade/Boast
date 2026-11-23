import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { BoxRound, BoxRoundInput, GroupDetail, Match, Player } from '../../shared/api'
import { BOX_POINTS, boxResults, fillBoxes, pairKey, promoteRelegate } from '../../shared/box'
import { gamesWon } from '../../shared/rating'
import { fmtDate, initials, todayIso } from '../../shared/util'
import { api, useApiMutation, useRounds } from '../api'
import { useViewer } from '../viewer'
import { askConfirm, toast } from './feedback'
import { ActionButton, Alert, Avatar, EmptyState, ErrorText, Field, Loading, Modal, PlayerLink, StatPill } from './ui'

const DAY_MS = 86_400_000
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS)

function roundState(r: BoxRound, today: string): { label: string; kind: 'pending' | 'confirmed' | 'neutral' } {
  if (today < r.startsOn) return { label: `Starts ${fmtDate(r.startsOn)}`, kind: 'neutral' }
  if (today > r.endsOn) return { label: 'Finished', kind: 'neutral' }
  const left = daysBetween(today, r.endsOn)
  return { label: left === 0 ? 'Last day' : `${left} ${left === 1 ? 'day' : 'days'} left`, kind: 'pending' }
}

/** One box: a cross-table in standings order (scores read from the row player's side), then P/W/L/Pts. */
function BoxTable({ round, index, box, last, matches, byId, canLogFor }: {
  round: BoxRound
  index: number
  box: string[]
  last: boolean
  matches: Match[]
  byId: Map<string, Player>
  canLogFor: string | null
}) {
  const { cells, standings, total } = useMemo(() => boxResults(round, box, matches), [round, box, matches])
  const order = standings.map((s) => s.playerId)
  const today = todayIso()
  const live = today >= round.startsOn && today <= round.endsOn
  const started = today >= round.startsOn
  return (
    <div className="card space-y-2 p-0">
      <div className="flex items-center justify-between px-4 pt-3">
        <h3 className="font-semibold">Box {index + 1}</h3>
        <span className="text-xs muted">
          {cells.size} of {total} played
        </span>
      </div>
      <div className="overflow-x-auto pb-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs muted">
              <th className="w-8 px-2 py-1.5 text-left font-medium">#</th>
              <th className="px-2 py-1.5 text-left font-medium">Player</th>
              {order.map((id) => (
                <th key={id} className="w-11 px-1 py-1.5 text-center font-medium" title={byId.get(id)?.name}>
                  {initials(byId.get(id)?.name)}
                </th>
              ))}
              <th className="w-8 px-1 py-1.5 text-center font-medium" title="Played">P</th>
              <th className="w-8 px-1 py-1.5 text-center font-medium" title="Won">W</th>
              <th className="w-8 px-1 py-1.5 text-center font-medium" title="Lost">L</th>
              <th className="w-10 px-2 py-1.5 text-center font-semibold" title="Points">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, row) => {
              const p = byId.get(s.playerId)
              const up = started && index > 0 && row === 0
              const down = started && !last && row === standings.length - 1
              return (
                <tr key={s.playerId} className="border-t border-slate-100 dark:border-ink-800">
                  <td className="px-2 py-1.5 tabular-nums">
                    <span className="inline-flex items-center gap-0.5">
                      {row + 1}
                      {up && <span className="text-[10px] text-ink-700 dark:text-ball-300" title="Promotion place">▲</span>}
                      {down && <span className="text-[10px] muted" title="Relegation place">▼</span>}
                    </span>
                  </td>
                  <td className="max-w-40 px-2 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={p?.name ?? '?'} url={p?.avatarUrl} size={24} />
                      <PlayerLink player={p} className="truncate font-medium" />
                    </div>
                  </td>
                  {order.map((col) => {
                    if (col === s.playerId) return <td key={col} className="bg-slate-50 dark:bg-ink-800/60" aria-hidden />
                    const m = cells.get(pairKey(s.playerId, col))
                    if (m) {
                      const side = m.playerAId === s.playerId ? 'a' : 'b'
                      const mine = gamesWon(m.games, side)
                      const theirs = gamesWon(m.games, side === 'a' ? 'b' : 'a')
                      return (
                        <td key={col} className="px-1 py-1.5 text-center">
                          <Link
                            to={`/matches/${m.id}`}
                            className={clsx(
                              'inline-block min-w-9 rounded px-1 py-0.5 text-xs font-semibold tabular-nums',
                              mine > theirs ? 'bg-ball-400 text-black' : 'bg-slate-100 text-slate-700 dark:bg-ink-800 dark:text-slate-200',
                            )}
                            title={`${p?.name} ${mine}–${theirs} ${byId.get(col)?.name}`}
                          >
                            {mine}–{theirs}
                          </Link>
                        </td>
                      )
                    }
                    const mine = canLogFor === s.playerId
                    return (
                      <td key={col} className="px-1 py-1.5 text-center">
                        {mine && live ? (
                          <Link to={`/log?opponent=${col}&type=box`} className="text-xs font-semibold link" title={`Log your match vs ${byId.get(col)?.name}`}>
                            Log
                          </Link>
                        ) : (
                          <span className="text-xs muted">·</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-1 py-1.5 text-center tabular-nums muted">{s.played}</td>
                  <td className="px-1 py-1.5 text-center tabular-nums muted">{s.won}</td>
                  <td className="px-1 py-1.5 text-center tabular-nums muted">{s.lost}</td>
                  <td className="px-2 py-1.5 text-center font-bold tabular-nums">{s.points}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Create or edit a round: name, dates, and who's in which box. */
function RoundEditor({ group, members, initial, roundId, onClose }: {
  group: GroupDetail
  members: Player[]
  initial: BoxRoundInput
  roundId?: string
  onClose: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [startsOn, setStartsOn] = useState(initial.startsOn)
  const [endsOn, setEndsOn] = useState(initial.endsOn)
  const [boxes, setBoxes] = useState<string[][]>(initial.boxes)
  const [size, setSize] = useState(5)
  const byId = useMemo(() => new Map(members.map((p) => [p.id, p])), [members])
  const placed = new Set(boxes.flat())
  const unplaced = members.filter((p) => !placed.has(p.id))
  const save = useApiMutation((input: BoxRoundInput) =>
    roundId ? api(`/rounds/${roundId}`, { method: 'PATCH', body: input }) : api(`/groups/${group.id}/rounds`, { method: 'POST', body: input }),
  )
  const move = (id: string, to: number) =>
    setBoxes((bs) => {
      const next = bs.map((b) => b.filter((x) => x !== id))
      while (next.length <= to) next.push([])
      next[to] = [...next[to], id]
      return next
    })
  const removeFrom = (id: string) => setBoxes((bs) => bs.map((b) => b.filter((x) => x !== id)))
  const tooSmall = boxes.some((b) => b.length > 0 && b.length < 2)
  const submit = () => {
    const clean = boxes.filter((b) => b.length > 0)
    save.mutate({ name, startsOn, endsOn, boxes: clean }, { onSuccess: () => { toast(roundId ? 'Round updated' : 'Round started'); onClose() } })
  }
  return (
    <Modal title={roundId ? 'Edit round' : 'New box league round'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Starts">
            <input type="date" className="input" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label="Ends">
            <input type="date" className="input" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3 dark:bg-ink-800">
          <label className="block">
            <span className="label">Players per box</span>
            <input type="number" min={2} max={12} className="input w-24" value={size} onChange={(e) => setSize(Number(e.target.value) || 5)} />
          </label>
          <button type="button" className="btn-secondary" onClick={() => setBoxes(fillBoxes(members.map((p) => p.id), size))}>
            Fill all boxes by level
          </button>
          <p className="hint w-full">Puts every member into boxes, strongest first. You can then move people between boxes.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {boxes.map((box, i) => (
            <div key={i} className="rounded-lg p-3 ring-1 ring-slate-200 dark:ring-ink-700">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Box {i + 1}</h3>
                <span className="text-xs muted">{box.length} players</span>
              </div>
              <ul className="space-y-1">
                {box.map((id) => (
                  <li key={id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{byId.get(id)?.name ?? 'Unknown'}</span>
                    <button type="button" className="btn-ghost btn-sm px-2" disabled={i === 0} onClick={() => move(id, i - 1)} aria-label={`Move ${byId.get(id)?.name} up a box`}>
                      ↑
                    </button>
                    <button type="button" className="btn-ghost btn-sm px-2" onClick={() => move(id, i + 1)} aria-label={`Move ${byId.get(id)?.name} down a box`}>
                      ↓
                    </button>
                    <button type="button" className="btn-ghost btn-sm px-2" onClick={() => removeFrom(id)} aria-label={`Take ${byId.get(id)?.name} out of this round`}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              {unplaced.length > 0 && (
                <select className="input mt-2" value="" onChange={(e) => e.target.value && move(e.target.value, i)} aria-label={`Add a player to box ${i + 1}`}>
                  <option value="">+ Add a member…</option>
                  {unplaced.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
          <button type="button" className="btn-ghost min-h-20 border-2 border-dashed border-slate-300 dark:border-ink-700" onClick={() => setBoxes((bs) => [...bs, []])}>
            + Add a box
          </button>
        </div>
        {unplaced.length > 0 && boxes.length > 0 && <p className="hint">Not in this round: {unplaced.map((p) => p.name).join(', ')}.</p>}
        {tooSmall && <Alert kind="warn">Each box needs at least two players. Empty boxes are dropped when you save.</Alert>}
        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <ActionButton className="btn-primary" status={save.status} disabled={tooSmall || boxes.every((b) => b.length === 0)} onClick={submit}>
            {roundId ? 'Save round' : 'Start round'}
          </ActionButton>
        </div>
      </div>
    </Modal>
  )
}

/** A group's box league: rounds of small boxes, everyone plays everyone in their box, then promotion and relegation. */
export function BoxLeague({ group, members, matches }: { group: GroupDetail; members: Player[]; matches: Match[] }) {
  const v = useViewer()
  const { data: rounds, isLoading } = useRounds(group.id)
  const [picked, setPicked] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ initial: BoxRoundInput; roundId?: string } | null>(null)
  const del = useApiMutation((id: string) => api(`/rounds/${id}`, { method: 'DELETE' }))
  const byId = useMemo(() => new Map(members.map((p) => [p.id, p])), [members])
  const today = todayIso()
  const admin = group.viewerIsAdmin

  if (isLoading) return <Loading variant="rows" count={2} />
  const list = rounds ?? []
  if (list.length === 0 && !admin) return null

  const current = list.find((r) => r.id === picked) ?? list.find((r) => r.startsOn <= today) ?? list[0]
  const newRound = (): BoxRoundInput => ({
    name: `Round ${list.length + 1}`,
    startsOn: today,
    endsOn: addDays(today, 27),
    boxes: fillBoxes(members.map((p) => p.id), 5),
  })
  const nextRound = (r: BoxRound): BoxRoundInput => {
    const ranked = r.boxes.map((box) => boxResults(r, box, matches).standings.map((s) => s.playerId))
    const start = addDays(r.endsOn, 1)
    return { name: `Round ${list.length + 1}`, startsOn: start, endsOn: addDays(start, daysBetween(r.startsOn, r.endsOn)), boxes: promoteRelegate(ranked) }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>Box league</h2>
        {admin && (
          <button type="button" className="btn-primary btn-sm" onClick={() => setEditor({ initial: current ? nextRound(current) : newRound() })} disabled={members.length < 2}>
            {current ? 'Start next round' : 'Start a box league'}
          </button>
        )}
      </div>
      {!current ? (
        <EmptyState title="No box league yet">
          Split members into small boxes by level. Everyone plays everyone in their box during the round; the top player moves up a box and the bottom player moves down.
        </EmptyState>
      ) : (
        <>
          <div className="card flex flex-wrap items-center gap-x-3 gap-y-2">
            {list.length > 1 ? (
              <select className="input w-auto" value={current.id} onChange={(e) => setPicked(e.target.value)} aria-label="Round">
                {list.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{current.name}</strong>
            )}
            <span className="text-sm muted">
              {fmtDate(current.startsOn)} – {fmtDate(current.endsOn)}
            </span>
            <StatPill kind={roundState(current, today).kind}>{roundState(current, today).label}</StatPill>
            {admin && (
              <span className="ml-auto flex gap-1">
                <button type="button" className="btn-ghost btn-sm" onClick={() => setEditor({ initial: { name: current.name, startsOn: current.startsOn, endsOn: current.endsOn, boxes: current.boxes }, roundId: current.id })}>
                  Edit
                </button>
                <ActionButton
                  className="btn-ghost btn-sm font-bold text-black dark:text-ball-300"
                  status={del.status}
                  onClick={async () =>
                    (await askConfirm({ title: `Delete ${current.name}?`, message: 'The boxes for this round are removed. Matches already played aren’t affected.', confirmLabel: 'Delete round', danger: true })) &&
                    del.mutate(current.id, { onSuccess: () => { setPicked(null); toast(`${current.name} deleted`) } })
                  }
                >
                  Delete
                </ActionButton>
              </span>
            )}
          </div>
          <ErrorText error={del.error} />
          <p className="text-xs muted">
            Only <strong>box</strong> matches between box-mates within the round’s dates count — use “Log” in your row, or pick “Box” as the match type. A win scores {BOX_POINTS.win}, a
            loss {BOX_POINTS.loss} for playing. Ties are split by wins, then games, then points.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {current.boxes.map((box, i) => (
              <BoxTable key={i} round={current} index={i} box={box} last={i === current.boxes.length - 1} matches={matches} byId={byId} canLogFor={v.myPlayer?.id ?? null} />
            ))}
          </div>
        </>
      )}
      {editor && <RoundEditor group={group} members={members} initial={editor.initial} roundId={editor.roundId} onClose={() => setEditor(null)} />}
    </section>
  )
}
