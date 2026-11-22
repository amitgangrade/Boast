import clsx from 'clsx'
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Player } from '../../shared/api'
import { initials } from '../../shared/util'

export const playerHref = (p: Pick<Player, 'id' | 'username'>) => `/players/${p.username ?? p.id}`

export function Alert({ kind = 'error', children, onClose }: { kind?: 'error' | 'warn' | 'info' | 'ok'; children: ReactNode; onClose?: () => void }) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={clsx(
        'fade-in flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
        kind === 'error' && 'bg-white text-black ring-2 ring-black dark:bg-black dark:text-white dark:ring-ball-400',
        kind === 'warn' && 'bg-ball-300 text-black ring-1 ring-ball-500 dark:bg-ball-400 dark:text-black dark:ring-ball-400',
        kind === 'info' && 'bg-ink-50 text-ink-800 ring-1 ring-ink-100 dark:bg-ink-900 dark:text-ink-100 dark:ring-ink-800',
        kind === 'ok' && 'bg-ink-800 text-white ring-1 ring-ink-800 dark:bg-ink-800 dark:text-white dark:ring-ink-600',
      )}
    >
      <div className="flex-1">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="-my-0.5 rounded px-1 text-lg leading-none opacity-60 hover:opacity-100" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null
  return <Alert>{error instanceof Error ? error.message : String(error)}</Alert>
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-label="Loading"
      className={clsx('inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-ink-700 dark:border-ink-700 dark:border-t-ball-400', className)}
    />
  )
}

type SkeletonVariant = 'rows' | 'matches' | 'tiles' | 'player' | 'page'

function SkeletonRow() {
  return (
    <div className="card flex items-center gap-3 py-3">
      <span className="skeleton h-7 w-7 rounded-full" />
      <span className="skeleton h-9 w-9 rounded-full" />
      <div className="flex-1 space-y-2">
        <span className="skeleton h-3.5 w-2/5" />
        <span className="skeleton h-3 w-1/4" />
      </div>
      <span className="skeleton h-6 w-14" />
    </div>
  )
}

function SkeletonMatch() {
  return (
    <div className="card space-y-3">
      <span className="skeleton h-3 w-1/3" />
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="skeleton h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <span className="skeleton h-3.5 w-1/3" />
            <span className="skeleton h-3 w-1/5" />
          </div>
          <span className="skeleton h-6 w-5" />
        </div>
      ))}
      <span className="skeleton h-3 w-1/4" />
    </div>
  )
}

function SkeletonTile() {
  return (
    <div className="card flex items-center gap-3">
      <span className="skeleton h-10 w-10 rounded-lg" />
      <div className="flex-1 space-y-2">
        <span className="skeleton h-3.5 w-1/2" />
        <span className="skeleton h-3 w-1/3" />
      </div>
    </div>
  )
}

/** Shimmering placeholder blocks shaped like the content that is loading. */
export function Skeleton({ variant = 'page', count }: { variant?: SkeletonVariant; count?: number }) {
  const n = (d: number) => Array.from({ length: count ?? d }, (_, i) => i)
  let body: ReactNode
  if (variant === 'rows') body = <div className="space-y-2">{n(6).map((i) => <SkeletonRow key={i} />)}</div>
  else if (variant === 'matches') body = <div className="space-y-3">{n(3).map((i) => <SkeletonMatch key={i} />)}</div>
  else if (variant === 'tiles') body = <div className="grid gap-3 sm:grid-cols-2">{n(4).map((i) => <SkeletonTile key={i} />)}</div>
  else if (variant === 'player')
    body = (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <span className="skeleton h-20 w-20 rounded-full" />
          <div className="flex-1 space-y-2.5">
            <span className="skeleton h-6 w-1/2 sm:w-1/3" />
            <span className="skeleton h-3.5 w-1/3 sm:w-1/5" />
          </div>
          <span className="skeleton h-10 w-20" />
        </div>
        <div className="card space-y-3">
          <span className="skeleton h-4 w-24" />
          <span className="skeleton h-56 w-full" />
        </div>
        {n(2).map((i) => <SkeletonMatch key={i} />)}
      </div>
    )
  else
    body = (
      <div className="space-y-4">
        <span className="skeleton h-7 w-40" />
        <span className="skeleton h-10 w-full sm:max-w-sm" />
        <div className="space-y-2">{n(5).map((i) => <SkeletonRow key={i} />)}</div>
      </div>
    )
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="fade-in">
      <span className="sr-only">Loading…</span>
      {body}
    </div>
  )
}

/** Loading placeholder. Kept for existing call sites; renders a skeleton. */
export function Loading({ variant, count }: { variant?: SkeletonVariant; count?: number } = {}) {
  return <Skeleton variant={variant} count={count} />
}

type ActionStatus = 'idle' | 'pending' | 'success' | 'error'

/** The ActionButton most recently pressed, so only the clicked one of several sharing a mutation shows the spinner. */
let lastPressed: string | null = null

/**
 * A button that runs an action: shows a small spinner and is disabled while it works,
 * then a checkmark for a moment when it succeeds. Pass a mutation's `status`, or `busy`.
 */
export function ActionButton({
  status,
  busy,
  disabled,
  onClick,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { status?: ActionStatus; busy?: boolean }) {
  const id = useId()
  const pending = !!busy || status === 'pending'
  const mine = lastPressed === id
  const [done, setDone] = useState(false)
  const prev = useRef(status)
  useEffect(() => {
    const was = prev.current
    prev.current = status
    if (was === 'pending' && status === 'success' && lastPressed === id) {
      setDone(true)
      const t = setTimeout(() => setDone(false), 1400)
      return () => clearTimeout(t)
    }
  }, [status, id])
  return (
    <button
      {...rest}
      type={type}
      className={className}
      disabled={disabled || pending}
      aria-busy={pending && mine ? true : undefined}
      onClick={(e) => {
        lastPressed = id
        setDone(false)
        onClick?.(e)
      }}
    >
      {pending && mine ? (
        <span className="btn-spinner" aria-hidden />
      ) : done ? (
        <svg viewBox="0 0 24 24" className="btn-check" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : null}
      {children}
      <span className="sr-only" aria-live="polite">
        {pending && mine ? 'Working' : done ? 'Done' : ''}
      </span>
    </button>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'sheet-up max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-ink-900 sm:rounded-2xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm text-lg" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, hint, error, children, optional }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; optional?: boolean }) {
  return (
    <label className="block">
      <span className="label">
        {label} {optional && <span className="font-normal muted">(optional)</span>}
      </span>
      {children}
      {error ? <p className="mt-1 text-xs font-semibold text-black dark:text-ball-300">⚠ {error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </label>
  )
}

export function Avatar({ name, url, size = 36, className }: { name: string; url?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) }
  if (url) {
    return <img src={url} alt="" width={size} height={size} style={style} className={clsx('shrink-0 rounded-full object-cover', className)} loading="lazy" />
  }
  return (
    <span
      aria-hidden
      style={style}
      className={clsx('grid shrink-0 place-items-center rounded-full bg-ink-100 font-semibold text-ink-700 dark:bg-ink-800 dark:text-ink-100', className)}
    >
      {initials(name)}
    </span>
  )
}

export function OrgTile({ name, kind, size = 40 }: { name: string; kind: 'club' | 'group'; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={clsx(
        'grid shrink-0 place-items-center rounded-lg font-bold',
        kind === 'club' ? 'bg-ink-800 text-ball-300 dark:bg-ink-700' : 'bg-ball-300 text-ink-900',
      )}
    >
      {initials(name)}
    </span>
  )
}

export function ProvisionalTag({ full }: { full?: boolean }) {
  return (
    <span
      className="tag bg-ball-300 text-black dark:bg-ball-400 dark:text-black"
      title="Provisional: fewer than the threshold of rated matches. Established opponents' levels don't move against provisional players."
    >
      {full ? 'Provisional' : 'P'}
    </span>
  )
}

export function UnclaimedTag() {
  return (
    <span className="tag bg-slate-100 text-slate-600 dark:bg-ink-800 dark:text-slate-300" title="Not signed up yet — they can claim this player by signing in with the same Gmail address.">
      not on Boast yet
    </span>
  )
}

export function YouTag() {
  return <span className="tag bg-ball-300 text-ink-900">you</span>
}

export function PlayerLink({ player, className }: { player: Pick<Player, 'id' | 'username' | 'name'> | undefined; className?: string }) {
  if (!player) return <span className={className}>Unknown player</span>
  return (
    <Link to={playerHref(player)} className={clsx('hover:underline', className)}>
      {player.name}
    </Link>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-slate-100 p-1 dark:bg-ink-800">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'min-h-9 rounded-md px-2 text-sm transition-colors',
            value === o.value
              ? 'bg-ink-800 font-semibold text-white shadow dark:bg-ball-400 dark:text-ink-950'
              : 'font-medium text-slate-700 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-ink-700',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function StatPill({ kind, children }: { kind: 'pending' | 'disputed' | 'confirmed' | 'neutral'; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'tag',
        kind === 'pending' && 'bg-ball-300 text-black dark:bg-ball-400 dark:text-black',
        kind === 'disputed' && 'bg-black text-white dark:bg-white dark:text-black',
        kind === 'confirmed' && 'bg-ink-800 text-white dark:bg-ink-200 dark:text-ink-950',
        kind === 'neutral' && 'bg-slate-100 text-slate-700 dark:bg-ink-800 dark:text-slate-300',
      )}
    >
      {children}
    </span>
  )
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm muted hover:text-slate-900 dark:hover:text-white">
      ← {children}
    </Link>
  )
}

export function confirmAction(message: string): boolean {
  return window.confirm(message)
}
