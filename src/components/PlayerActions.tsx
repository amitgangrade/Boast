import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ChallengeInput, Player, PlayerUpdateInput } from '../../shared/api'
import { api, useApiMutation } from '../api'
import { useViewer } from '../viewer'
import { IdentityFields, identityFrom, identityPayload, validateIdentity, type IdentityDraft } from './IdentityFields'
import { ActionButton, Alert, ErrorText, Field, Modal } from './ui'
import { askConfirm } from './feedback'

export function ShareButton({ title, path }: { title: string; path: string }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = new URL(path, location.origin).toString()
    if (navigator.share) {
      try {
        await navigator.share({ title, url })
      } catch {
        /* user dismissed the share sheet */
      }
      return
    }
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button className="btn-secondary btn-sm" onClick={share}>
      {copied ? 'Link copied' : 'Share'}
    </button>
  )
}

export function ChallengeButton({ to }: { to: Player }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [date, setDate] = useState('')
  const [venue, setVenue] = useState('')
  const [sent, setSent] = useState(false)
  const send = useApiMutation((input: ChallengeInput) => api('/challenges', { method: 'POST', body: input }))
  return (
    <>
      <button className="btn-primary btn-sm" onClick={() => setOpen(true)} disabled={sent}>
        {sent ? 'Challenge sent' : 'Challenge'}
      </button>
      {open && (
        <Modal title={`Challenge ${to.name}`} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <Field label="Message" optional>
              <textarea className="input min-h-20" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Saturday morning at the club?" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Proposed date" optional>
                <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Venue" optional>
                <input className="input" value={venue} onChange={(e) => setVenue(e.target.value)} />
              </Field>
            </div>
            <ErrorText error={send.error} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <ActionButton
                className="btn-primary"
                status={send.status}
                onClick={() =>
                  send.mutate(
                    { toPlayerId: to.id, message, proposedDate: date || null, venue },
                    {
                      onSuccess: () => {
                        setSent(true)
                        setOpen(false)
                      },
                    },
                  )
                }
              >
                {send.isPending ? 'Sending…' : 'Send challenge'}
              </ActionButton>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

/** Admin / club-admin editor for any player, including deletion for global admins. */
export function EditPlayerModal({ player: p, onClose }: { player: Player; onClose: () => void }) {
  const v = useViewer()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<IdentityDraft>(identityFrom(p))
  const [email, setEmail] = useState(p.email ?? '')
  const [level, setLevel] = useState(String(Math.round(p.startingLevel * 100) / 100))
  const [seeded, setSeeded] = useState(p.seededRating)
  const [ack, setAck] = useState(false)
  const [notes, setNotes] = useState(p.notes ?? '')
  const [joined, setJoined] = useState(p.createdAt.slice(0, 10))
  const [err, setErr] = useState<string | null>(null)
  const save = useApiMutation((input: PlayerUpdateInput) => api<Player>(`/players/${p.id}`, { method: 'PATCH', body: input }))
  const del = useApiMutation((mode: 'soft' | 'hard') => api(`/players/${p.id}?mode=${mode}`, { method: 'DELETE' }))

  const historyChange = p.matchesPlayed > 0 && (seeded !== p.seededRating || Number(level) !== p.startingLevel || joined !== p.createdAt.slice(0, 10))

  const submit = () => {
    setErr(null)
    const problem = validateIdentity(draft)
    if (problem) return setErr(problem)
    if (!(Number(level) > 0)) return setErr('Starting level must be a positive number')
    if (historyChange && !ack) return setErr('Tick the box to confirm you understand this recalculates history')
    save.mutate(
      {
        name: draft.name.trim(),
        email: p.claimed ? null : email.trim() || null,
        startingLevel: Number(level),
        seededRating: seeded,
        notes,
        createdAt: v.isAdmin && joined !== p.createdAt.slice(0, 10) ? joined : null,
        ...identityPayload(draft),
      },
      { onSuccess: onClose },
    )
  }

  const remove = async (mode: 'soft' | 'hard') => {
    const ok = await askConfirm(
      mode === 'soft'
        ? {
            title: `Remove ${p.name}’s account?`,
            message: 'Their player and all their matches stay. They can sign in again with the same Google account to reclaim it.',
            confirmLabel: 'Remove account',
            danger: true,
          }
        : {
            title: `Delete ${p.name} permanently?`,
            message: 'This deletes the player and every match they played. Opponents’ levels are recalculated. It can’t be undone.',
            confirmLabel: 'Delete player and matches',
            danger: true,
            requireText: 'DELETE',
          },
    )
    if (ok) del.mutate(mode, { onSuccess: () => navigate('/') })
  }

  return (
    <Modal title={`Edit ${p.name}`} onClose={onClose} wide>
      <div className="space-y-5">
        {!p.claimed && (
          <Field label="Email" hint="Used to hand this player over when they sign up with this address.">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        <IdentityFields value={draft} onChange={setDraft} nameLabel="Name" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Starting level">
            <input className="input" inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          {v.isAdmin && (
            <Field label="Joined on" hint="Matches can't be dated before this.">
              <input type="date" className="input" value={joined} onChange={(e) => setJoined(e.target.value)} />
            </Field>
          )}
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={seeded} onChange={(e) => setSeeded(e.target.checked)} />
          <span>
            <strong>Known rating</strong> — skip the provisional period (their starting level is trustworthy).
          </span>
        </label>
        {historyChange && (
          <label className="flex items-start gap-2 rounded-lg bg-ball-300 p-3 text-sm text-black dark:bg-ball-400 dark:text-black">
            <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>I understand this recalculates every level from {p.name}’s match history — theirs and their opponents’.</span>
          </label>
        )}
        <Field label="Admin notes" optional>
          <textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {err && <Alert>{err}</Alert>}
        <ErrorText error={save.error ?? del.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <ActionButton className="btn-primary" status={save.status} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save'}
          </ActionButton>
        </div>
        {v.isAdmin && v.myPlayer?.id !== p.id && (
          <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-ink-800">
            <h3 className="text-sm font-semibold text-black dark:text-ball-300">Delete</h3>
            <div className="flex flex-wrap gap-2">
              {p.claimed && (
                <ActionButton className="btn-secondary btn-sm" status={del.status} onClick={() => remove('soft')}>
                  Remove account, keep player
                </ActionButton>
              )}
              <ActionButton className="btn-danger btn-sm" status={del.status} onClick={() => remove('hard')}>
                Delete player and matches
              </ActionButton>
            </div>
            <p className="hint">
              {p.claimed
                ? '“Remove account” keeps their history as an unclaimed player they can reclaim. Full delete is for spam or duplicates.'
                : 'Deletes this placeholder and every match it’s in.'}
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
