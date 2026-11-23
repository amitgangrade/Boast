import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Me, NotificationPrefs, ProfileInput } from '../../shared/api'
import { fmtDate, fmtLevel } from '../../shared/util'
import { api, queryClient, signIn, useApiMutation, useSettings } from '../api'
import { askConfirm, toast } from '../components/feedback'
import { AvatarPicker } from '../components/AvatarPicker'
import { IdentityFields, identityFrom, identityPayload, validateIdentity, type IdentityDraft } from '../components/IdentityFields'
import { ActionButton, Alert, EmptyState, ErrorText, Field, playerHref } from '../components/ui'
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
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
  }, [hash])
  const removePhoto = useApiMutation(() => api<Me>('/me/avatar', { method: 'DELETE' }))

  if (!v.signedIn) return <EmptyState title="Sign in to edit your profile" action={<button className="btn-primary" onClick={() => signIn('/profile')}>Sign in</button>} />
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
        <AvatarPicker name={p.name} currentUrl={p.avatarUrl} busy={upload.isPending || removePhoto.isPending} status={upload.status} onPick={(b) => upload.mutate(b)} onRemove={() => removePhoto.mutate(undefined)} />
        <ErrorText error={upload.error ?? removePhoto.error} />
        <Field label="Email" hint="The address you sign in with. It can’t be changed here.">
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
          <ActionButton className="btn-primary" status={save.status} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save'}
          </ActionButton>
        </div>
      </div>
      {v.me?.notifications && <NotificationSettings prefs={v.me.notifications} />}
      <PrivacySettings isAdmin={v.isAdmin} />
    </div>
  )
}

const NOTIFY_OPTIONS: Array<{ key: keyof NotificationPrefs; label: string; hint: string }> = [
  { key: 'matches', label: 'Match results and disputes', hint: 'When a match with you is recorded, and if one is disputed.' },
  { key: 'challenges', label: 'Challenges', hint: 'When someone challenges you, and when they answer yours.' },
  { key: 'reminders', label: 'Confirmation reminders', hint: 'The day before a match recorded against you confirms automatically.' },
  { key: 'digest', label: 'Weekly summary', hint: 'Mondays, after a week with results: your level, rank and what’s waiting for you.' },
  { key: 'leagues', label: 'Box leagues', hint: 'Your box and opponents when a round starts, and a nudge 5 days before it ends.' },
]

function NotificationSettings({ prefs }: { prefs: NotificationPrefs }) {
  const [value, setValue] = useState(prefs)
  const save = useApiMutation((next: NotificationPrefs) => api<Me>('/me/notifications', { method: 'PATCH', body: next }))
  const toggle = (key: keyof NotificationPrefs, on: boolean) => {
    const next = { ...value, [key]: on }
    setValue(next)
    save.mutate(next, { onSuccess: () => toast('Email settings saved'), onError: () => setValue(value) })
  }
  return (
    <section id="notifications" className="card scroll-mt-20 space-y-3">
      <h2>Email notifications</h2>
      <ul className="space-y-3">
        {NOTIFY_OPTIONS.map((o) => (
          <li key={o.key}>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={value[o.key]} disabled={save.isPending} onChange={(e) => toggle(o.key, e.target.checked)} />
              <span>
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="hint mt-0 block">{o.hint}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <ErrorText error={save.error} />
      <p className="hint">Emails go to your Google address. Every email also has a one-click unsubscribe link.</p>
    </section>
  )
}

function PrivacySettings({ isAdmin }: { isAdmin: boolean }) {
  const del = useApiMutation(() => api('/me', { method: 'DELETE' }))
  const remove = async () => {
    const ok = await askConfirm({
      title: 'Delete your account?',
      message: (
        <div className="space-y-2">
          <p>This signs you out and removes your account, photo, phone, year of birth, gender and handedness. Boast stops emailing you.</p>
          <p>
            Your <strong>name and match history stay</strong> as an unclaimed player, because they’re part of your opponents’ records and levels. To have those removed too, ask a
            Boast admin.
          </p>
          <p>Signing in again with the same Google account brings your player back.</p>
        </div>
      ),
      confirmLabel: 'Delete my account',
      danger: true,
      requireText: 'DELETE',
    })
    if (!ok) return
    try {
      // mutateAsync, not mutate(…, { onSuccess }): signing out unmounts this page before per-call callbacks run.
      await del.mutateAsync(undefined)
      queryClient.clear()
      location.href = '/'
    } catch {
      // The error is shown below the buttons.
    }
  }
  return (
    <section className="card space-y-3">
      <h2>Your data</h2>
      <p className="text-sm muted">
        See our <Link to="/privacy" className="link">privacy policy</Link> for what Boast keeps and why.
      </p>
      <div className="flex flex-wrap gap-2">
        <a className="btn-secondary" href="/api/me/export" download>
          Download my data
        </a>
        <ActionButton className="btn-danger" status={del.status} onClick={remove}>
          Delete my account
        </ActionButton>
      </div>
      {isAdmin && <p className="hint">If you’re the only admin, make someone else an admin first.</p>}
      <ErrorText error={del.error} />
    </section>
  )
}
