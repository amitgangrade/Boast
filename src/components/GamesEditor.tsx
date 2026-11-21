import type { Game } from '../../shared/rating'

export interface GameDraft {
  a: string
  b: string
}

/** Drops empty rows; a row with only one side filled counts the other as 0. */
export function cleanGames(games: GameDraft[]): Game[] {
  return games
    .filter((g) => g.a.trim() !== '' || g.b.trim() !== '')
    .map((g) => ({ a: Math.max(0, Math.round(Number(g.a) || 0)), b: Math.max(0, Math.round(Number(g.b) || 0)) }))
}

export function GamesEditor({ games, onChange, nameA, nameB }: { games: GameDraft[]; onChange: (g: GameDraft[]) => void; nameA: string; nameB: string }) {
  const set = (i: number, side: 'a' | 'b', v: string) => onChange(games.map((g, j) => (j === i ? { ...g, [side]: v.replace(/\D/g, '').slice(0, 2) } : g)))
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_0.75rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs font-medium muted">
        <span />
        <span className="truncate text-center">{nameA}</span>
        <span />
        <span className="truncate text-center">{nameB}</span>
        <span />
      </div>
      {games.map((g, i) => (
        <div key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)_0.75rem_minmax(0,1fr)_2rem] items-center gap-2">
          <span className="text-xs tabular-nums muted">G{i + 1}</span>
          <input
            inputMode="numeric"
            className="input min-w-0 text-center text-lg font-semibold tabular-nums"
            placeholder="0"
            aria-label={`Game ${i + 1} ${nameA} score`}
            value={g.a}
            onChange={(e) => set(i, 'a', e.target.value)}
          />
          <span className="text-center muted">–</span>
          <input
            inputMode="numeric"
            className="input min-w-0 text-center text-lg font-semibold tabular-nums"
            placeholder="0"
            aria-label={`Game ${i + 1} ${nameB} score`}
            value={g.b}
            onChange={(e) => set(i, 'b', e.target.value)}
          />
          {games.length > 1 ? (
            <button type="button" className="btn-ghost btn-sm px-0" aria-label={`Remove game ${i + 1}`} onClick={() => onChange(games.filter((_, j) => j !== i))}>
              ×
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {games.length < 7 && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => onChange([...games, { a: '', b: '' }])}>
          + Add game
        </button>
      )}
    </div>
  )
}
