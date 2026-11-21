import clsx from 'clsx'
import { useId, useMemo, useState } from 'react'
import type { Player } from '../../shared/api'
import { fmtLevel } from '../../shared/util'
import { Avatar } from './ui'

/** Every whitespace-separated token must appear somewhere in the haystack. */
export function matchesQuery(hay: Array<string | null | undefined>, q: string): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const text = hay.filter(Boolean).join(' ').toLowerCase()
  return tokens.every((t) => text.includes(t))
}

export const playerHay = (p: Player) => [p.name, p.username, p.club, p.city, p.country]

export function PlayerSearch({
  players,
  value,
  onChange,
  exclude = [],
  placeholder = 'Search players…',
  onAddNew,
  label,
}: {
  players: Player[]
  value: string | null
  onChange: (id: string | null) => void
  exclude?: string[]
  placeholder?: string
  onAddNew?: (typedName: string) => void
  label: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const selected = players.find((p) => p.id === value)
  const results = useMemo(
    () => players.filter((p) => !exclude.includes(p.id) && matchesQuery(playerHay(p), q)).slice(0, 8),
    [players, exclude, q],
  )

  if (selected) {
    return (
      <div className="flex min-w-0 items-center gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-300 dark:bg-ink-900 dark:ring-ink-700">
        <Avatar name={selected.name} url={selected.avatarUrl} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{selected.name}</div>
          <div className="truncate text-xs muted">
            Level {fmtLevel(selected.currentLevel)}
            {selected.club ? ` · ${selected.club}` : ''}
          </div>
        </div>
        <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => onChange(null)} aria-label={`Change ${label}`}>
          Change
        </button>
      </div>
    )
  }

  const pick = (id: string) => {
    onChange(id)
    setQ('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        className="input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault()
            pick(results[active].id)
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200 dark:bg-ink-900 dark:ring-ink-700">
          {results.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p.id)}
              onMouseEnter={() => setActive(i)}
              className={clsx('flex cursor-pointer items-center gap-3 px-3 py-2', i === active && 'bg-slate-100 dark:bg-ink-800')}
            >
              <Avatar name={p.name} url={p.avatarUrl} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="truncate text-xs muted">{[p.club, p.city, p.country].filter(Boolean).join(' · ') || 'No club'}</div>
              </div>
              <span className="text-xs tabular-nums muted">{fmtLevel(p.currentLevel)}</span>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-2 text-sm muted">No players match “{q}”.</li>}
          {onAddNew && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false)
                onAddNew(q.trim())
              }}
              className="cursor-pointer border-t border-slate-100 px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-slate-100 dark:border-ink-800 dark:text-ball-300 dark:hover:bg-ink-800"
            >
              + Add someone who isn’t on Boast yet
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
