import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EMAIL_RE } from '../../shared/util'
import { api, signInWithGoogle, useApiMutation } from '../api'
import { ActionButton, Alert, ErrorText, Field, Loading } from '../components/ui'
import { useViewer } from '../viewer'

const safeReturn = (r: string | null) => (r && r.startsWith('/') && !r.startsWith('//') && !r.startsWith('/signin') ? r : '/')

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z" opacity=".9" />
      <path fill="currentColor" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" opacity=".7" />
      <path fill="currentColor" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z" opacity=".5" />
      <path fill="currentColor" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 5.9 12 5.9Z" opacity=".8" />
    </svg>
  )
}

/** Sign in with Google, or have a one-time link emailed to any address. */
export function SignInPage() {
  const [params] = useSearchParams()
  const returnTo = safeReturn(params.get('return'))
  const v = useViewer()
  const [email, setEmail] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const send = useApiMutation((e: string) => api<{ ok: true; devLink?: string }>('/auth/email', { method: 'POST', body: { email: e, return: returnTo } }))

  if (v.signedIn) {
    return (
      <div className="mx-auto max-w-md">
        <Alert kind="ok">
          You’re signed in. <Link to={returnTo} className="link">Continue</Link>
        </Alert>
      </div>
    )
  }
  const submit = () => {
    setErr(null)
    const e = email.trim().toLowerCase()
    if (!EMAIL_RE.test(e)) return setErr('Enter your email address')
    send.mutate(e)
  }
  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="text-center">
        <h1>Sign in to Boast</h1>
        <p className="mt-1 text-sm muted">Free. Use the email your club or opponents know you by — if someone already logged matches against it, they become yours.</p>
      </div>
      <div className="card space-y-5">
        <button type="button" className="btn-secondary w-full" onClick={() => signInWithGoogle(returnTo)}>
          <GoogleMark />
          Continue with Google
        </button>
        <div className="flex items-center gap-3 text-xs uppercase tracking-wider muted" aria-hidden>
          <span className="h-px flex-1 bg-slate-200 dark:bg-ink-700" />
          or
          <span className="h-px flex-1 bg-slate-200 dark:bg-ink-700" />
        </div>
        {send.isSuccess ? (
          <div className="space-y-3">
            <Alert kind="ok">
              <strong>Check your inbox.</strong> We sent a sign-in link to {email.trim()}. It works once, for 15 minutes. Can’t see it? Check spam.
            </Alert>
            {send.data?.devLink && (
              <p className="text-xs">
                Local development (no email service):{' '}
                <a className="link break-all" href={send.data.devLink}>
                  open the link
                </a>
              </p>
            )}
            <button type="button" className="btn-ghost btn-sm" onClick={() => send.reset()}>
              Use a different email
            </button>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <Field label="Email me a sign-in link" error={err}>
              <input className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            <ActionButton type="submit" className="btn-primary w-full" status={send.status}>
              Email me a link
            </ActionButton>
            <ErrorText error={send.error} />
          </form>
        )}
      </div>
      <p className="text-center text-xs muted">
        By signing in you agree to how we handle your data in our <Link to="/privacy" className="link">privacy policy</Link>.
      </p>
    </div>
  )
}

/** Where the emailed link lands: trades the token for a session, then carries on. */
export function VerifySignInPage() {
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const verify = useApiMutation((t: string) => api<{ return: string }>('/auth/email/verify', { method: 'POST', body: { token: t } }))
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !token) return
    started.current = true
    // mutateAsync: per-call callbacks can be dropped if the page remounts mid-request.
    verify
      .mutateAsync(token)
      .then((r) => (location.href = safeReturn(r.return)))
      .catch(() => undefined)
  }, [token, verify])
  if (!token) return <Alert>This sign-in link is incomplete. <Link to="/signin" className="link">Ask for a new one</Link>.</Alert>
  if (verify.isError) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <ErrorText error={verify.error} />
        <Link to="/signin" className="btn-primary">
          Get a new link
        </Link>
      </div>
    )
  }
  return (
    <div className="mx-auto max-w-md space-y-3 text-center">
      <p className="font-medium">Signing you in…</p>
      <Loading variant="rows" count={1} />
    </div>
  )
}
