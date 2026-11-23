import clsx from 'clsx'
import type { Match, Player } from '../../shared/api'
import { shareText } from '../../shared/share'
import { toast } from './feedback'

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.3-.4.7-1.2.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z" />
  </svg>
)

/**
 * Share a result to WhatsApp (where clubs talk), the phone's share sheet, or the clipboard.
 * The link unfurls into a preview with the score (see worker/og.ts).
 */
export function ShareResult({ match, a, b, me, prominent }: { match: Match; a?: Player; b?: Player; me: string | null; prominent?: boolean }) {
  const url = new URL(`/matches/${match.id}`, location.origin).toString()
  const text = shareText(match, { a: a?.name ?? 'Player A', b: b?.name ?? 'Player B' }, me)
  const message = `${text} ${url}`
  const native = typeof navigator !== 'undefined' && !!navigator.share
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      toast('Copied — paste it into your club chat')
    } catch {
      toast('Couldn’t copy. Long-press the link to copy it instead.')
    }
  }
  const buttons = (
    <div className="flex flex-wrap gap-2">
      <a className="btn-accent btn-sm" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
        <WhatsAppIcon />
        WhatsApp
      </a>
      {native && (
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => navigator.share({ title: 'Squash result on Boast', text, url }).catch(() => undefined)}
        >
          Share…
        </button>
      )}
      <button type="button" className="btn-secondary btn-sm" onClick={copy}>
        Copy
      </button>
    </div>
  )
  if (!prominent) return buttons
  return (
    <section className={clsx('card space-y-3 ring-2 ring-ball-400')}>
      <div>
        <h2 className="text-base">Tell your club</h2>
        <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-ink-800">{text}</p>
      </div>
      {buttons}
    </section>
  )
}
