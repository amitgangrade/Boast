import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Match, MatchInput, Player } from '../../shared/api'
import { gamesWon, isProvisional, MATCH_TYPE_LABEL, MATCH_TYPES, type MatchType, updateLevels } from '../../shared/rating'
import { fmtDate, fmtDelta, fmtLevel, todayIso } from '../../shared/util'
import { explainMatch } from '../../shared/explain'
import { api, signIn, useApiMutation, useMatches, usePlayers, useSettings } from '../api'
import { AddPlayerModal } from '../components/AddPlayerModal'
import { cleanGames, GamesEditor, type GameDraft } from '../components/GamesEditor'
import { PlayerSearch } from '../components/PlayerSearch'
import { ActionButton, Alert, Avatar, EmptyState, ErrorText, Field, Segmented } from '../components/ui'
import { useViewer } from '../viewer'

function useLatestConfirmedDate(playerId: string | null) {
  const { data } = useMatches({ player: playerId ?? undefined, status: 'confirmed', limit: 1 }, { enabled: !!playerId })
  return data?.items[0]?.date ?? null
}

export function LogMatchPage() {
  const v = useViewer()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { players, byId } = usePlayers()
  const { data: settings } = useSettings()
  const canPickA = v.isAdmin || (v.me?.clubAdminSlugs.length ?? 0) > 0
  const [aId, setAId] = useState<string | null>(v.myPlayer?.id ?? null)
  const [bId, setBId] = useState<string | null>(params.get('opponent'))
  const [date, setDate] = useState(params.get('date') ?? todayIso())
  const [type, setType] = useState<MatchType>(() => (MATCH_TYPES as readonly string[]).includes(params.get('type') ?? '') ? (params.get('type') as MatchType) : 'friendly')
  const [venue, setVenue] = useState(params.get('venue') ?? '')
  const [games, setGames] = useState<GameDraft[]>([{ a: '', b: '' }, { a: '', b: '' }, { a: '', b: '' }])
  const [notes, setNotes] = useState('')
  const [unranked, setUnranked] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const save = useApiMutation((input: MatchInput) => api<Match>('/matches', { method: 'POST', body: input }))

  const a = aId ? byId.get(aId) : undefined
  const b = bId ? byId.get(bId) : undefined
  const latestA = useLatestConfirmedDate(aId)
  const latestB = useLatestConfirmedDate(bId)
  const clean = cleanGames(games)
  const floor = [a?.createdAt, b?.createdAt].filter(Boolean).map((d) => d!.slice(0, 10)).sort().at(-1) ?? undefined
  const today = todayIso()
  const dateError = date > today ? 'That date is in the future.' : floor && date < floor ? `Can’t be before ${fmtDate(floor)}, when ${a && a.createdAt.slice(0, 10) === floor ? a.name : b?.name} joined Boast.` : null
  const reorder = !dateError && [latestA, latestB].some((d) => d && date < d)

  const preview = useMemo(() => {
    if (!a || !b || !settings || clean.length === 0 || unranked) return null
    return updateLevels({
      levelA: a.currentLevel,
      levelB: b.currentLevel,
      games: clean,
      type,
      provisionalA: isProvisional(a, settings),
      provisionalB: isProvisional(b, settings),
      settings,
    })
  }, [a, b, settings, clean, type, unranked])

  if (!v.signedIn) {
    return (
      <EmptyState title="Sign in to log a match" action={<button className="btn-primary" onClick={() => signIn('/log')}>Sign in with Google</button>}>
        You need an account so your opponent can confirm the result.
      </EmptyState>
    )
  }
  if (!v.myPlayer && !canPickA) return <EmptyState title="Finish setting up your profile first" />

  const mySide = v.myPlayer?.id === aId ? 'a' : v.myPlayer?.id === bId ? 'b' : null
  const iLost = mySide && clean.length > 0 && gamesWon(clean, mySide) < gamesWon(clean, mySide === 'a' ? 'b' : 'a')
  const autoConfirms = v.isAdmin || iLost

  const submit = () => {
    setErr(null)
    if (!a || !b) return setErr('Pick both players')
    if (a.id === b.id) return setErr('Players must be different')
    if (dateError) return setErr(dateError)
    if (clean.length === 0) return setErr('Enter at least one game score')
    save.mutate(
      { playerAId: a.id, playerBId: b.id, date, type, games: clean, venue, notes, unranked },
      { onSuccess: (m) => navigate(`/matches/${m.id}`, { state: { justLogged: true } }) },
    )
  }

  const winner = clean.length ? (gamesWon(clean, 'a') > gamesWon(clean, 'b') ? a : gamesWon(clean, 'b') > gamesWon(clean, 'a') ? b : null) : null

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1>Log a match</h1>
      <div className="card space-y-5">
        <div className="grid grid-cols-1 gap-4">
          <div>
            <span className="label">{canPickA ? 'Player A' : 'You'}</span>
            {canPickA ? (
              <PlayerSearch label="Player A" players={players} value={aId} onChange={setAId} exclude={bId ? [bId] : []} placeholder="Search player A…" />
            ) : (
              <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-ink-800">
                <Avatar name={a?.name ?? '?'} url={a?.avatarUrl} size={32} />
                <span className="text-sm font-medium">{a?.name}</span>
                <span className="ml-auto text-xs tabular-nums muted">Level {fmtLevel(a?.currentLevel)}</span>
              </div>
            )}
          </div>
          <div>
            <span className="label">Opponent</span>
            <PlayerSearch label="Opponent" players={players} value={bId} onChange={setBId} exclude={aId ? [aId] : []} placeholder="Search opponent by name…" onAddNew={(name) => setAdding(name)} />
          </div>
        </div>
        <Field label="Date played" error={dateError}>
          <input type="date" className="input" value={date} min={floor} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {reorder && (
          <Alert kind="warn">This is earlier than a match already counted for one of these players. That’s fine — every level after it is recalculated in order.</Alert>
        )}
        <div>
          <span className="label">Match type</span>
          <Segmented label="Match type" value={type} onChange={setType} options={MATCH_TYPES.map((t) => ({ value: t, label: MATCH_TYPE_LABEL[t] }))} />
          <p className="hint">Tournaments and leagues move levels more than friendlies.</p>
        </div>
        <div>
          <span className="label">Game scores</span>
          <GamesEditor games={games} onChange={setGames} nameA={a?.name ?? 'Player A'} nameB={b?.name ?? 'Opponent'} />
        </div>
        <Field label="Venue" optional>
          <input className="input" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Cricket Club, court 2" />
        </Field>
        <Field label="Notes" optional>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={unranked} onChange={(e) => setUnranked(e.target.checked)} />
          Don’t count toward levels (practice, handicap, etc.)
        </label>

        {a && b && clean.length > 0 && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-ink-800">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide muted">If confirmed</div>
            {winner ? (
              <p className="mb-2">
                <strong>{winner.name}</strong> wins {Math.max(gamesWon(clean, 'a'), gamesWon(clean, 'b'))}–{Math.min(gamesWon(clean, 'a'), gamesWon(clean, 'b'))}
              </p>
            ) : (
              <p className="mb-2">Games level — a draw.</p>
            )}
            {preview ? (
              <ul className="space-y-0.5 tabular-nums">
                {([[a, preview.levelAAfter, preview.deltaA], [b, preview.levelBAfter, preview.deltaB]] as Array<[Player, number, number]>).map(([p, after, d]) => (
                  <li key={p.id}>
                    {p.name}: {fmtLevel(p.currentLevel)} → <strong>{fmtLevel(after)}</strong> ({fmtDelta(d)})
                  </li>
                ))}
              </ul>
            ) : (
              unranked && <p>Unranked — levels won’t change.</p>
            )}
            {preview && settings && (
              <details className="group mt-2 text-xs">
                <summary className="inline-flex cursor-pointer select-none items-center gap-1 muted hover:text-slate-800 dark:hover:text-slate-200">
                  Why these numbers?
                  <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
                </summary>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-300">
                  {explainMatch({
                    levelA: a.currentLevel,
                    levelB: b.currentLevel,
                    games: clean,
                    type,
                    provisionalA: isProvisional(a, settings),
                    provisionalB: isProvisional(b, settings),
                    deltaA: preview.deltaA,
                    deltaB: preview.deltaB,
                    nameA: a.name,
                    nameB: b.name,
                    settings,
                    side: mySide ?? 'a',
                    preview: true,
                  }).lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="mt-2 text-xs muted">
              {autoConfirms
                ? v.isAdmin
                  ? 'Counts straight away (recorded by an admin).'
                  : 'Counts straight away — you recorded your own loss.'
                : b && !b.claimed && mySide
                  ? `${b.name} isn’t on Boast yet, so an admin will confirm this.`
                  : 'Your opponent confirms it, or it counts automatically after 3 days.'}
            </p>
          </div>
        )}

        {err && <Alert>{err}</Alert>}
        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <ActionButton className="btn-primary" status={save.status} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save match'}
          </ActionButton>
        </div>
      </div>
      {adding != null && (
        <AddPlayerModal
          initialName={adding}
          onClose={() => setAdding(null)}
          onCreated={(p) => {
            setBId(p.id)
          }}
        />
      )}
    </div>
  )
}
