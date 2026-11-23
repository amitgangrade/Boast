import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import type { UnsubscribeInfo } from '../../shared/api'
import { api, useApiMutation } from '../api'
import { ActionButton, Alert, EmptyState, ErrorText, Loading } from '../components/ui'

const KIND_LABEL = {
  matches: 'match results and disputes',
  challenges: 'challenges',
  reminders: 'confirmation reminders',
  digest: 'the weekly summary',
  leagues: 'box league emails',
} as const
type Kind = keyof typeof KIND_LABEL

/** Landing page for the link in every email. Works without signing in; the token identifies the player. */
export function UnsubscribePage() {
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const raw = params.get('kind')
  const kind: Kind | null = raw && raw in KIND_LABEL ? (raw as Kind) : null
  const info = useQuery({
    queryKey: ['unsubscribe', token],
    queryFn: () => api<UnsubscribeInfo>(`/unsubscribe?t=${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  })
  const save = useApiMutation((k: Kind | 'all') => api<UnsubscribeInfo>('/unsubscribe', { method: 'POST', body: { token, kind: k } }))
  const prefs = save.data?.prefs ?? info.data?.prefs

  if (!token) return <EmptyState title="This link is incomplete">Use the link from the bottom of a Boast email, or change your email settings on your profile.</EmptyState>
  if (info.isLoading) return <Loading variant="rows" count={2} />
  if (info.error) return <ErrorText error={info.error} />
  const allOff = !!prefs && (Object.keys(KIND_LABEL) as Kind[]).every((k) => !prefs[k])

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1>Email settings</h1>
      <div className="card space-y-4">
        <p>Hi {info.data!.firstName}. Which emails should Boast stop sending you?</p>
        {allOff ? (
          <Alert kind="ok">You won’t get any more emails from Boast.</Alert>
        ) : (
          <div className="flex flex-wrap gap-2">
            {kind && prefs?.[kind] && (
              <ActionButton className="btn-primary" status={save.status} onClick={() => save.mutate(kind)}>
                Stop {KIND_LABEL[kind]}
              </ActionButton>
            )}
            <ActionButton className={kind && prefs?.[kind] ? 'btn-secondary' : 'btn-primary'} status={save.status} onClick={() => save.mutate('all')}>
              Stop all emails
            </ActionButton>
          </div>
        )}
        {prefs && !allOff && (
          <ul className="space-y-1 text-sm">
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <span aria-hidden className={prefs[k] ? 'text-ink-700 dark:text-ball-300' : 'muted'}>
                  {prefs[k] ? '●' : '○'}
                </span>
                <span className="capitalize">{KIND_LABEL[k]}</span>
                <span className="muted">— {prefs[k] ? 'on' : 'off'}</span>
              </li>
            ))}
          </ul>
        )}
        <ErrorText error={save.error} />
        <p className="hint">
          You can turn emails back on any time under{' '}
          <Link to="/profile#notifications" className="link">
            My profile → Email notifications
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
