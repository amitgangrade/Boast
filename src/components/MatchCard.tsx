import clsx from 'clsx'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { type Match, type MatchUpdateInput, type Player } from '../../shared/api'
import { gamesWon, MATCH_TYPE_LABEL, MATCH_TYPES, type MatchType } from '../../shared/rating'
import { fmtDate, fmtDelta, fmtLevel } from '../../shared/util'
import { api, useApiMutation, usePlayers } from '../api'
import { useViewer } from '../viewer'
import { GamesEditor, cleanGames, type GameDraft } from './GamesEditor'
import { Alert, Avatar, confirmAction, ErrorText, Field, Modal, PlayerLink, ProvisionalTag, Segmented, StatPill } from './ui'

const DAY_MS = 86_400_000

export function daysLeftToConfirm(m: Match): number {
  return Math.max(0, 3 - Math.floor((Date.now() - Date.parse(m.createdAt)) / DAY_MS))
}

function Side({ player, games, delta, provisional, levelAfter, won }: { player?: Player; games: number; delta: number | null; provisional: boolean | null; levelAfter: number | null; won: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={player?.name ?? '?'} url={player?.avatarUrl} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <PlayerLink player={player} className={clsx('truncate text-sm', won ? 'font-semibold' : 'font-medium')} />
          {provisional && <ProvisionalTag />}
        </div>
        {levelAfter != null && (
          <div className="text-xs tabular-nums muted">
            {fmtLevel(levelAfter)}{' '}
            <span className={clsx(delta! > 0.5 ? 'text-emerald-600 dark:text-emerald-400' : delta! < -0.5 ? 'text-red-600 dark:text-red-400' : '')}>
              ({fmtDelta(delta)})
            </span>
          </div>
        )}
      </div>
      <span className={clsx('w-6 text-right text-xl tabular-nums', won ? 'font-bold' : 'font-medium muted')}>{games}</span>
    </div>
  )
}

export function MatchCard({ match: m, perspective, hint, actions = true, highlight }: { match: Match; perspective?: string; hint?: ReactNode; actions?: boolean; highlight?: boolean }) {
  const { byId } = usePlayers()
  const viewer = useViewer()
  const [editing, setEditing] = useState(false)
  const a = byId.get(m.playerAId)
  const b = byId.get(m.playerBId)
  const ga = gamesWon(m.games, 'a')
  const gb = gamesWon(m.games, 'b')
  const mySide = perspective === m.playerAId ? 'a' : perspective === m.playerBId ? 'b' : null
  const result = mySide == null ? null : ga === gb ? 'Drew' : (ga > gb) === (mySide === 'a') ? 'Won' : 'Lost'

  const myPlayerId = viewer.myPlayer?.id
  const iAmParticipant = !!myPlayerId && (myPlayerId === m.playerAId || myPlayerId === m.playerBId)
  const canAdmin = viewer.canWriteMatch(a, b)
  const canConfirm = m.status === 'pending' && (canAdmin || (iAmParticipant && m.createdBy !== viewer.me?.user.id))

  const confirm = useApiMutation((dispute: boolean) => api(`/matches/${m.id}/confirm`, { method: 'POST', body: { dispute } }))
  const remove = useApiMutation(() => api(`/matches/${m.id}`, { method: 'DELETE' }))

  return (
    <article
      className={clsx(
        'card space-y-3',
        highlight && 'ring-2 ring-amber-300 dark:ring-amber-700',
        m.status === 'disputed' && 'opacity-80',
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs muted">
        {result && (
          <span
            className={clsx(
              'tag',
              result === 'Won' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
              result === 'Lost' && 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
              result === 'Drew' && 'bg-slate-100 text-slate-700 dark:bg-ink-800 dark:text-slate-200',
            )}
          >
            {result}
          </span>
        )}
        <Link to={`/matches/${m.id}`} className="hover:underline">
          {fmtDate(m.date)}
        </Link>
        <span>· {MATCH_TYPE_LABEL[m.type]}</span>
        {m.venue && <span className="truncate">· {m.venue}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {m.unranked && <StatPill kind="neutral">Unranked</StatPill>}
          {m.status === 'pending' && <StatPill kind="pending">Awaiting confirmation</StatPill>}
          {m.status === 'disputed' && <StatPill kind="disputed">Disputed</StatPill>}
          {m.status === 'confirmed' && m.autoConfirmed && (
            <span title="Confirmed automatically: an admin recorded it, the recorder reported their own loss, or 3 days passed">auto-confirmed</span>
          )}
        </span>
      </header>

      <div className="space-y-2">
        <Side player={a} games={ga} delta={m.deltaA} provisional={m.provisionalA} levelAfter={m.levelAAfter} won={ga > gb} />
        <Side player={b} games={gb} delta={m.deltaB} provisional={m.provisionalB} levelAfter={m.levelBAfter} won={gb > ga} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums muted">
        <span>{m.games.map((g) => `${g.a}–${g.b}`).join('  ·  ')}</span>
        {m.notes && <span className="italic">“{m.notes}”</span>}
      </div>

      {hint && <div className="text-xs text-amber-800 dark:text-amber-300">{hint}</div>}
      <ErrorText error={confirm.error ?? remove.error} />

      {actions && (canConfirm || canAdmin) && (
        <footer className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-ink-800">
          {canConfirm && (
            <>
              <button className="btn-primary btn-sm" disabled={confirm.isPending} onClick={() => confirm.mutate(false)}>
                {confirm.isPending && !confirm.variables ? 'Confirming…' : 'Confirm'}
              </button>
              <button
                className="btn-secondary btn-sm"
                disabled={confirm.isPending}
                onClick={() => confirmAction('Dispute this score? Disputed matches don’t count toward levels until an admin fixes them.') && confirm.mutate(true)}
              >
                Dispute
              </button>
            </>
          )}
          {canAdmin && (
            <>
              <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button
                className="btn-ghost btn-sm text-red-600 dark:text-red-400"
                disabled={remove.isPending}
                onClick={() => confirmAction('Delete this match? Levels are recalculated straight away.') && remove.mutate(undefined)}
              >
                Delete
              </button>
            </>
          )}
        </footer>
      )}
      {editing && <EditMatchDialog match={m} a={a} b={b} onClose={() => setEditing(false)} />}
    </article>
  )
}

function EditMatchDialog({ match: m, a, b, onClose }: { match: Match; a?: Player; b?: Player; onClose: () => void }) {
  const [date, setDate] = useState(m.date)
  const [type, setType] = useState<MatchType>(m.type)
  const [games, setGames] = useState<GameDraft[]>(m.games.map((g) => ({ a: String(g.a), b: String(g.b) })))
  const [venue, setVenue] = useState(m.venue ?? '')
  const [notes, setNotes] = useState(m.notes ?? '')
  const [unranked, setUnranked] = useState(m.unranked)
  const [status, setStatus] = useState(m.status)
  const [err, setErr] = useState<string | null>(null)
  const save = useApiMutation((input: MatchUpdateInput) => api(`/matches/${m.id}`, { method: 'PATCH', body: input }))

  const submit = () => {
    const clean = cleanGames(games)
    if (clean.length === 0) return setErr('Enter at least one game score')
    save.mutate(
      { playerAId: m.playerAId, playerBId: m.playerBId, date, type, games: clean, venue, notes, unranked, status },
      { onSuccess: onClose },
    )
  }

  return (
    <Modal title="Edit match" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm muted">
          {a?.name ?? '?'} vs {b?.name ?? '?'}
        </p>
        <Field label="Date">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div>
          <span className="label">Match type</span>
          <Segmented label="Match type" value={type} onChange={setType} options={MATCH_TYPES.map((t) => ({ value: t, label: MATCH_TYPE_LABEL[t] }))} />
        </div>
        <div>
          <span className="label">Game scores</span>
          <GamesEditor games={games} onChange={setGames} nameA={a?.name ?? 'A'} nameB={b?.name ?? 'B'} />
        </div>
        <Field label="Venue" optional>
          <input className="input" value={venue} onChange={(e) => setVenue(e.target.value)} />
        </Field>
        <Field label="Notes" optional>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div>
          <span className="label">Status</span>
          <Segmented
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'disputed', label: 'Disputed' },
            ]}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={unranked} onChange={(e) => setUnranked(e.target.checked)} />
          Don’t count toward levels (unranked)
        </label>
        {err && <Alert>{err}</Alert>}
        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
