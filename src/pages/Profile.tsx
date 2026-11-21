import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Me, ProfileInput } from '../../shared/api'
import { fmtDate, fmtLevel } from '../../shared/util'
import { api, signIn, useApiMutation, useSettings } from '../api'
import { AvatarPicker } from '../components/AvatarPicker'
import { IdentityFields, identityFrom, identityPayload, validateIdentity, type IdentityDraft } from '../components/IdentityFields'
import { Alert, EmptyState, ErrorText, Field, playerHref } from '../components/ui'
import { useViewer } from '../viewer'
import { isProvisional } from '../../shared/rating'

export function ProfilePage() {
  const v = useViewer()
  const p = v.myPlayer
  const { data: settings } = useSettings()
  const [draft, setDraft] = useState<IdentityDraft>(() => (p ? identityFrom(p) : identityFrom({})))
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const save = useApiMutation((input: ProfileInput) => api<Me>('/me/profile', { method: 'PATCH', body: input }))
  const upload = useApiMutation((blob: Blob) => api<Me>('/me/avatar', { method: 'PUT', raw: blob, type: 'image/jpeg' }))
  const removePhoto = useApiMutation(() => api<Me>('/me/avatar', { method: 'DELETE' }))

  if (!v.signedIn) return <EmptyState title="Sign in to edit your profile" action={<button className="btn-primary" onClick={() => signIn('/profile')}>Sign in with Google</button>} />
  if (!p) return null

  const submit = () => {
    setErr(null)
    setSaved(false)
    const problem = validateIdentity(draft, 'Full name')
    if (problem) return setErr(problem)
    save.mutate({ fullName: draft.name.trim(), ...identityPayload(draft) }, { onSuccess: () => setSaved(true) })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>My profile</h1>
        <Link to={playerHref(p)} className="text-sm link">
          View my player page →
        </Link>
      </div>
      <div className="card space-y-6">
        <AvatarPicker name={p.name} currentUrl={p.avatarUrl} busy={upload.isPending || removePhoto.isPending} onPick={(b) => upload.mutate(b)} onRemove={() => removePhoto.mutate(undefined)} />
        <ErrorText error={upload.error ?? removePhoto.error} />
        <Field label="Email" hint="Your Google account. It can’t be changed here.">
          <input className="input" value={v.me?.user.email ?? ''} disabled />
        </Field>
        <IdentityFields value={draft} onChange={setDraft} />
        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-ink-800">
          Starting level <strong>{fmtLevel(p.startingLevel)}</strong> on {fmtDate(p.createdAt)} ·{' '}
          {p.seededRating ? 'known rating' : settings && isProvisional(p, settings) ? 'provisional' : 'established'}
          <p className="hint">Only an admin can change your starting level, because it rewrites your match history.</p>
        </div>
        {err && <Alert>{err}</Alert>}
        <ErrorText error={save.error} />
        {saved && <Alert kind="ok">Saved.</Alert>}
        <div className="flex justify-end">
          <button className="btn-primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
