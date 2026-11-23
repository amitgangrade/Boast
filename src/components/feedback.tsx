import clsx from 'clsx'
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { Modal } from './ui'

/**
 * App-styled replacements for window.confirm and small status messages:
 * `askConfirm` resolves true/false from a modal, `toast` shows a short message
 * (optionally with an Undo action). Both render through hosts mounted in Layout.
 */

interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  /** Styles the confirm button as destructive. */
  danger?: boolean
  /** The user must type this exactly before confirming (for irreversible actions). */
  requireText?: string
}
interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

interface Toast {
  id: number
  message: string
  action?: { label: string; onClick: () => void }
}

let confirmState: PendingConfirm | null = null
let toasts: Toast[] = []
let nextToast = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  confirmState?.resolve(false)
  return new Promise((resolve) => {
    confirmState = { ...opts, resolve }
    emit()
  })
}

export function toast(message: string, action?: Toast['action'], ms = action ? 6000 : 3500) {
  const t = { id: nextToast++, message, action }
  toasts = [...toasts.slice(-2), t]
  emit()
  setTimeout(() => dismiss(t.id), ms)
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

function ConfirmDialog({ c }: { c: PendingConfirm }) {
  const [typed, setTyped] = useState('')
  const close = (ok: boolean) => {
    if (confirmState === c) confirmState = null
    c.resolve(ok)
    emit()
  }
  const ready = !c.requireText || typed.trim() === c.requireText
  return (
    <Modal title={c.title} onClose={() => close(false)}>
      <div className="space-y-4">
        {c.message && <div className="text-sm leading-relaxed">{c.message}</div>}
        {c.requireText && (
          <label className="block">
            <span className="label">
              Type <strong>{c.requireText}</strong> to confirm
            </span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => close(false)}>
            Cancel
          </button>
          <button type="button" className={c.danger ? 'btn-danger' : 'btn-primary'} disabled={!ready} onClick={() => close(true)}>
            {c.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function FeedbackHost() {
  const snap = useSyncExternalStore(subscribe, () => confirmState)
  const list = useSyncExternalStore(subscribe, () => toasts)
  // Close a dialog left open when navigating away.
  useEffect(() => () => confirmState?.resolve(false), [])
  return (
    <>
      {snap && <ConfirmDialog key={snap.title + String(snap.message)} c={snap} />}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {list.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              'sheet-up pointer-events-auto flex max-w-md items-center gap-3 rounded-xl bg-ink-900 px-4 py-2.5 text-sm text-white shadow-lg ring-1 ring-white/10',
              'dark:bg-white dark:text-black',
            )}
          >
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="rounded-md px-2 py-1 font-bold text-ball-300 hover:bg-white/10 dark:text-ink-800 dark:hover:bg-ink-100"
                onClick={() => {
                  t.action!.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Dismiss" className="opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
