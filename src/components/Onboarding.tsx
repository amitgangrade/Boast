import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Me, OnboardingInput, Player } from '../../shared/api'
import { api, signOut, useApiMutation, useMe } from '../api'
import { AvatarPicker } from './AvatarPicker'
import { emptyIdentity, IdentityFields, identityFrom, identityPayload, validateIdentity, type IdentityDraft } from './IdentityFields'
import { Alert, ErrorText, Field } from './ui'

type Source = OnboardingInput['ratingSource']

/** Shown full-screen to signed-in users who don't have a player yet. */
export function Onboarding() {
  const { data: me } = useMe()
  const { data: stubs } = useQuery({ queryKey: ['onboarding-suggestion'], queryFn: () => api<Player[]>('/onboarding/suggestion') })
  const stub = stubs?.[0]
  const [draft, setDraft] = useState<IdentityDraft>(emptyIdentity)
  const [source, setSource] = useState<Source | null>(null)
  const [level, setLevel] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (stub) setDraft(identityFrom(stub))
  }, [stub])

  const submit = useApiMutation(async (input: OnboardingInput) => {
    const res = await api<Me>('/onboarding', { method: 'POST', body: input })
    if (photo) await api('/me/avatar', { method: 'PUT', raw: photo, type: 'image/jpeg' })
    return res
  })

  const go = () => {
    setErr(null)
    const problem = validateIdentity(draft, 'Full name')
    if (problem) return setErr(problem)
    if (!source) return setErr('Pick how you want to start your rating')
    if (source !== 'none' && !(Number(level) > 0)) return setErr('Enter your rating, or pick “I don’t have a rating yet”')
    submit.mutate({ fullName: draft.name.trim(), ratingSource: source, startingLevel: source === 'none' ? null : Number(level), ...identityPayload(draft) })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1>Welcome to Boast</h1>
        <p className="mt-1 muted">A few details to set up your player. Boast is free.</p>
      </div>
      {me?.user.isAdmin && !stub && (
        <Alert kind="info">
          Moving over from SquashLevel? <Link to="/admin?tab=backup" className="link">Import your old data first</Link> — if it includes your account, you’ll be signed in as your existing player and can skip this form.
        </Alert>
      )}
      {stub && (
        <Alert kind="info">
          <strong>We already have a player for {me?.user.email}.</strong>{' '}
          {stub.matchesPlayed > 0 && `${stub.name}’s ${stub.matchesPlayed} rated ${stub.matchesPlayed === 1 ? 'match becomes' : 'matches become'} yours when you continue. `}
          We’ve pre-filled what we know.
        </Alert>
      )}
      <div className="card space-y-6">
        <AvatarPicker name={draft.name} currentUrl={null} onPick={setPhoto} />
        <Field label="Email" hint="Your Google account. To use a different one, sign out and sign in again.">
          <input className="input" value={me?.user.email ?? ''} disabled />
        </Field>
        <IdentityFields value={draft} onChange={setDraft} />
        <fieldset className="space-y-2">
          <legend className="label">How are you starting your rating?</legend>
          {(
            [
              ['official', 'I have a SquashLevels.com / LevelTech rating'],
              ['estimate', 'I have a solid estimate from a coach or strong club mate'],
              ['none', 'I don’t have a rating yet'],
            ] as Array<[Source, string]>
          ).map(([v, text]) => (
            <label key={v} className="flex items-start gap-2 text-sm">
              <input type="radio" name="source" className="mt-1" checked={source === v} onChange={() => setSource(v)} />
              <span>{text}</span>
            </label>
          ))}
          {source === 'none' && (
            <p className="hint">
              You’ll start at 1,000 as <strong>provisional</strong> for your first few matches: your level moves quickly toward where you belong, and established players aren’t affected meanwhile.
            </p>
          )}
          {source && source !== 'none' && (
            <Field label={source === 'official' ? 'Your rating' : 'Your best-estimate rating'}>
              <input className="input max-w-48" inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 1200" />
            </Field>
          )}
        </fieldset>
        {err && <Alert>{err}</Alert>}
        <ErrorText error={submit.error} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button className="btn-ghost" onClick={() => signOut()}>
            Sign out
          </button>
          <button className="btn-primary" disabled={submit.isPending} onClick={go}>
            {submit.isPending ? 'Setting up…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
