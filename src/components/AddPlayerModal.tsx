import { useState } from 'react'
import type { Player, PlayerCreateInput } from '../../shared/api'
import { EMAIL_RE } from '../../shared/util'
import { api, useApiMutation } from '../api'
import { emptyIdentity, IdentityFields, identityPayload, validateIdentity, type IdentityDraft } from './IdentityFields'
import { ActionButton, Alert, ErrorText, Field, Modal } from './ui'

export function RatingChoice({ known, onKnown, level, onLevel, who }: { known: boolean | null; onKnown: (v: boolean) => void; level: string; onLevel: (v: string) => void; who: 'their' | 'your' }) {
  return (
    <fieldset className="space-y-2">
      <legend className="label">Does {who === 'their' ? 'this player' : 'you'} have a known rating?</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" className="mt-1" checked={known === true} onChange={() => onKnown(true)} />
        <span>Yes — a SquashLevels / LevelTech rating or a solid coach estimate</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" className="mt-1" checked={known === false} onChange={() => onKnown(false)} />
        <span>
          No — start at 1,000 as <strong>provisional</strong>
        </span>
      </label>
      {known === false && (
        <p className="hint">
          For {who} first few matches only {who} level moves; established opponents aren’t affected until {who === 'their' ? 'they' : 'you'}’ve settled.
        </p>
      )}
      {known && (
        <Field label={who === 'their' ? 'Their rating' : 'Your rating'}>
          <input className="input" inputMode="decimal" value={level} onChange={(e) => onLevel(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 1200" />
        </Field>
      )}
    </fieldset>
  )
}

/** Creates an unclaimed player: someone who isn't on Boast yet, claimed later by signing in with this email. */
export function AddPlayerModal({ initialName = '', onClose, onCreated }: { initialName?: string; onClose: () => void; onCreated?: (p: Player) => void }) {
  const [draft, setDraft] = useState<IdentityDraft>({ ...emptyIdentity, name: initialName })
  const [email, setEmail] = useState('')
  const [known, setKnown] = useState<boolean | null>(null)
  const [level, setLevel] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const create = useApiMutation((input: PlayerCreateInput) => api<{ player: Player; existed: boolean }>('/players', { method: 'POST', body: input }))

  const submit = () => {
    setErr(null)
    const problem = validateIdentity(draft)
    if (problem) return setErr(problem)
    const e = email.trim().toLowerCase()
    if (!EMAIL_RE.test(e)) return setErr('Enter their email address')
    if (known == null) return setErr('Say whether you know their rating')
    if (known && !(Number(level) > 0)) return setErr('Enter their rating (a positive number)')
    create.mutate(
      { name: draft.name.trim(), email: e, ratingKnown: known, startingLevel: known ? Number(level) : null, ...identityPayload(draft) },
      {
        onSuccess: (res) => {
          if (res.existed) setNotice(`${res.player.name} is already on Boast with that email — selected them instead.`)
          onCreated?.(res.player)
          if (!res.existed) onClose()
        },
      },
    )
  }

  return (
    <Modal title="Add a player" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm muted">They’ll appear as “not on Boast yet”. When they sign in with this email address (Google or an email link), the player — and every match — becomes theirs.</p>
        <Field label="Their email" hint="Any address they read. Boast emails them about matches with you.">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opponent@example.com" />
        </Field>
        <IdentityFields value={draft} onChange={setDraft} nameLabel="Name" />
        <RatingChoice known={known} onKnown={setKnown} level={level} onLevel={setLevel} who="their" />
        {err && <Alert>{err}</Alert>}
        {notice && <Alert kind="info">{notice}</Alert>}
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            {notice ? 'Done' : 'Cancel'}
          </button>
          {!notice && (
            <ActionButton className="btn-primary" status={create.status} onClick={submit}>
              {create.isPending ? 'Adding…' : 'Add player'}
            </ActionButton>
          )}
        </div>
      </div>
    </Modal>
  )
}
