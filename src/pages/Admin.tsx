import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AdminUser, ClubAdminGrant, Player } from '../../shared/api'
import { DEFAULT_SETTINGS, isProvisional, type Settings } from '../../shared/rating'
import { fmtDate, fmtLevel } from '../../shared/util'
import { api, invalidateAll, useApiMutation, useClubs, usePlayers, useSettings } from '../api'
import { AddPlayerModal } from '../components/AddPlayerModal'
import { EditPlayerModal } from '../components/PlayerActions'
import { matchesQuery, playerHay } from '../components/PlayerSearch'
import { ActionButton, Alert, Avatar, EmptyState, ErrorText, Field, Loading, PlayerLink, ProvisionalTag, StatPill, UnclaimedTag } from '../components/ui'
import { parseBackup, runImport } from '../importer'
import { useViewer } from '../viewer'
import { askConfirm, toast } from '../components/feedback'

type Tab = 'players' | 'admins' | 'clubs' | 'rating' | 'backup'

function PlayersTab() {
  const { players, isLoading } = usePlayers()
  const { data: settings } = useSettings()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Player | null>(null)
  const [adding, setAdding] = useState(false)
  const rows = useMemo(() => players.filter((p) => matchesQuery([...playerHay(p), p.email], q)).sort((a, b) => a.name.localeCompare(b.name)), [players, q])
  if (isLoading) return <Loading variant="rows" />
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input type="search" className="input flex-1" placeholder="Search by name, email, club…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" onClick={() => setAdding(true)}>
          + Add player
        </button>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide muted">
            <tr className="border-b border-slate-100 dark:border-ink-800">
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2 text-right">Start</th>
              <th className="px-3 py-2 text-right">Now</th>
              <th className="px-3 py-2 text-right">Matches</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0 dark:border-ink-800">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar name={p.name} url={p.avatarUrl} size={24} />
                    <PlayerLink player={p} className="font-medium" />
                    {!p.claimed && <UnclaimedTag />}
                    {settings && isProvisional(p, settings) && <ProvisionalTag />}
                  </div>
                </td>
                <td className="max-w-56 truncate px-3 py-2 muted">{p.email}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtLevel(p.startingLevel)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtLevel(p.currentLevel)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.matchesPlayed}</td>
                <td className="px-3 py-2 text-right">
                  <button className="btn-ghost btn-sm" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditPlayerModal player={editing} onClose={() => setEditing(null)} />}
      {adding && <AddPlayerModal onClose={() => setAdding(false)} />}
    </div>
  )
}

function useUsers(q: string) {
  return useQuery({ queryKey: ['admin-users', q], queryFn: () => api<AdminUser[]>(`/admin/users?q=${encodeURIComponent(q)}`) })
}

function AdminsTab() {
  const [q, setQ] = useState('')
  const { data, isLoading, error } = useUsers(q)
  const v = useViewer()
  const set = useApiMutation((x: { id: string; value: boolean }) => api(`/admin/users/${x.id}/admin`, { method: 'POST', body: { value: x.value } }))
  return (
    <div className="space-y-3">
      <p className="text-sm muted">Global admins can do everything: edit and delete any player or match, change rating settings, and manage other admins.</p>
      <input type="search" className="input" placeholder="Search registered users…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorText error={error ?? set.error} />
      {isLoading ? (
        <Loading variant="rows" />
      ) : (
        <ul className="card divide-y divide-slate-100 p-0 dark:divide-ink-800">
          {(data ?? []).map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{u.name ?? '(no player yet)'}</div>
                <div className="truncate text-xs muted">
                  {u.email} · joined {fmtDate(u.createdAt)}
                </div>
              </div>
              {u.isAdmin && <StatPill kind="confirmed">admin</StatPill>}
              <ActionButton
                className="btn-ghost btn-sm"
                status={set.status}
                onClick={async () => {
                  const self = u.isAdmin && u.id === v.me?.user.id
                  if (self && !(await askConfirm({ title: 'Remove your own admin rights?', message: 'You won’t be able to undo this yourself — another admin would have to make you an admin again.', confirmLabel: 'Remove my admin rights', danger: true }))) return
                  set.mutate(
                    { id: u.id, value: !u.isAdmin },
                    { onSuccess: () => !self && toast(`${u.name ?? u.email} ${u.isAdmin ? 'is no longer an admin' : 'is now an admin'}`, { label: 'Undo', onClick: () => set.mutate({ id: u.id, value: u.isAdmin }) }) },
                  )
                }}
              >
                {u.isAdmin ? 'Remove admin' : 'Make admin'}
              </ActionButton>
            </li>
          ))}
          {data?.length === 0 && <li className="px-3 py-4 text-sm muted">No users match.</li>}
        </ul>
      )}
    </div>
  )
}

function ClubAdminsTab() {
  const { data: grants, isLoading, error } = useQuery({ queryKey: ['club-admins'], queryFn: () => api<ClubAdminGrant[]>('/admin/club-admins') })
  const { data: clubs } = useClubs()
  const [q, setQ] = useState('')
  const { data: users } = useUsers(q)
  const [userId, setUserId] = useState('')
  const [club, setClub] = useState('')
  const set = useApiMutation((x: { userId: string; clubSlug: string; value: boolean }) => api('/admin/club-admins', { method: 'POST', body: x }))
  return (
    <div className="space-y-4">
      <p className="text-sm muted">Club admins can add and edit players in their club, and edit, delete or confirm matches involving those players. They can’t delete players.</p>
      <div className="card grid gap-3 sm:grid-cols-2">
        <Field label="Person">
          <input className="input mb-2" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Pick someone…</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email} ({u.email})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Club">
          <select className="input" value={club} onChange={(e) => setClub(e.target.value)}>
            <option value="">Pick a club…</option>
            {(clubs ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <ActionButton className="btn-primary" status={set.status} disabled={!userId || !club} onClick={() => set.mutate({ userId, clubSlug: club, value: true }, { onSuccess: () => setUserId('') })}>
            Make club admin
          </ActionButton>
        </div>
      </div>
      <ErrorText error={error ?? set.error} />
      {isLoading ? (
        <Loading variant="rows" />
      ) : grants?.length ? (
        <ul className="card divide-y divide-slate-100 p-0 dark:divide-ink-800">
          {grants.map((g) => (
            <li key={`${g.userId}:${g.clubSlug}`} className="flex items-center gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <strong>{g.name}</strong> <span className="muted">({g.email})</span>
                <div className="text-xs muted">{clubs?.find((c) => c.slug === g.clubSlug)?.name ?? g.clubSlug}</div>
              </div>
              <ActionButton status={set.status} className="btn-ghost btn-sm font-bold text-black dark:text-ball-300" onClick={() =>
                  set.mutate(
                    { userId: g.userId, clubSlug: g.clubSlug, value: false },
                    { onSuccess: () => toast(`${g.name} is no longer a club admin`, { label: 'Undo', onClick: () => set.mutate({ userId: g.userId, clubSlug: g.clubSlug, value: true }) }) },
                  )
                }>
                Remove
              </ActionButton>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No club admins yet" />
      )}
    </div>
  )
}

const SETTING_FIELDS: Array<{ key: keyof Settings; label: string; hint: string }> = [
  { key: 'dampingK', label: 'Damping (K)', hint: 'How far one match can move a level. Default 0.12.' },
  { key: 'pointsWeight', label: 'Points weight', hint: 'Share of performance from points (vs games won), 0–1. Default 0.5.' },
  { key: 'pointsExponent', label: 'Points exponent', hint: 'How strongly a level gap predicts the points split. Default 2.' },
  { key: 'gamesExponent', label: 'Games exponent', hint: 'How strongly a level gap predicts games won. Default 5.' },
  { key: 'provisionalThreshold', label: 'Provisional threshold', hint: 'Rated matches before a new player is established. Default 5.' },
  { key: 'movingAverageWindow', label: 'Moving-average window', hint: 'Matches in the “recent average” on player pages. Default 4.' },
]

function RatingTab() {
  const { data: settings } = useSettings()
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const values = draft ?? Object.fromEntries(Object.entries(settings ?? DEFAULT_SETTINGS).map(([k, v]) => [k, String(v)]))
  const save = useApiMutation((s: Settings) => api<Settings>('/settings', { method: 'PUT', body: s }))
  const rebuild = useApiMutation(() => api<{ players: number; matches: number }>('/admin/rebuild', { method: 'POST' }))
  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <p className="text-sm muted">Changing these recalculates every level from the full match history straight away.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {SETTING_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input className="input" inputMode="decimal" value={values[f.key]} onChange={(e) => setDraft({ ...values, [f.key]: e.target.value })} />
            </Field>
          ))}
        </div>
        <ErrorText error={save.error} />
        {save.isSuccess && !draft && <Alert kind="ok">Saved — levels recalculated.</Alert>}
        <div className="flex flex-wrap gap-2">
          <ActionButton
            className="btn-primary"
            status={save.status}
            disabled={!draft}
            onClick={() => save.mutate(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])) as unknown as Settings, { onSuccess: () => setDraft(null) })}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </ActionButton>
          <button className="btn-ghost" onClick={() => setDraft(Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, String(v)])))}>
            Reset to defaults
          </button>
        </div>
      </div>
      <div className="card space-y-2">
        <h3 className="font-semibold">Recalculate levels</h3>
        <p className="text-sm muted">Levels are recalculated automatically after every change. Use this only if something looks off.</p>
        <ErrorText error={rebuild.error} />
        {rebuild.data && (
          <Alert kind="ok">
            Done: {rebuild.data.players} players and {rebuild.data.matches} matches updated.
          </Alert>
        )}
        <ActionButton className="btn-secondary" status={rebuild.status} onClick={() => rebuild.mutate(undefined)}>
          {rebuild.isPending ? 'Recalculating…' : 'Recalculate all levels'}
        </ActionButton>
      </div>
    </div>
  )
}

function BackupTab() {
  const [file, setFile] = useState<{ name: string; parsed: ReturnType<typeof parseBackup> } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const read = async (f: File | undefined) => {
    setErr(null)
    setDone(null)
    setFile(null)
    if (!f) return
    try {
      setFile({ name: f.name, parsed: parseBackup(await f.text()) })
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const go = async () => {
    if (!file) return
    setErr(null)
    try {
      const res = await runImport(file.parsed.tables, setStep)
      setDone(`Imported ${res.counts.players} players and ${res.counts.matches} matches.${res.merged ? ' You’re now signed in as your imported account.' : ''}`)
      setFile(null)
      setConfirmText('')
      await invalidateAll()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setStep(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h3 className="font-semibold">Download a backup</h3>
        <p className="text-sm muted">Everything in Boast as one JSON file: players, matches, groups, clubs, settings and the audit log.</p>
        <a className="btn-secondary" href="/api/admin/export" download>
          Download backup
        </a>
      </div>
      <div className="card space-y-3">
        <h3 className="font-semibold">Restore or import</h3>
        <p className="text-sm muted">
          Accepts a Boast backup, or an export from the old SquashLevel app (Settings → Backup & restore → Export JSON there). This <strong>replaces all data</strong> in Boast. Profile photos are copied over too.
        </p>
        <input type="file" accept="application/json,.json" onChange={(e) => read(e.target.files?.[0])} className="block text-sm" disabled={!!step} />
        {file && (
          <div className="space-y-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-ink-800">
            <p>
              <strong>{file.name}</strong> — {file.parsed.summary.source === 'boast' ? 'Boast backup' : 'SquashLevel export'}
            </p>
            <ul className="grid grid-cols-2 gap-x-4 text-xs sm:grid-cols-3">
              {Object.entries(file.parsed.summary.counts).filter(([, n]) => n > 0).map(([t, n]) => (
                <li key={t}>
                  {t.replace('_', ' ')}: <strong>{n}</strong>
                </li>
              ))}
            </ul>
            <Field label='Type REPLACE to confirm'>
              <input className="input max-w-48" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </Field>
            <ActionButton className="btn-danger" status={step ? 'pending' : done ? 'success' : 'idle'} disabled={confirmText !== 'REPLACE'} onClick={go}>
              Replace everything with this file
            </ActionButton>
          </div>
        )}
        {step && (
          <p className="text-sm font-medium" role="status">
            {step}
          </p>
        )}
        {err && <Alert>{err}</Alert>}
        {done && <Alert kind="ok">{done}</Alert>}
      </div>
    </div>
  )
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'players', label: 'Players' },
  { id: 'admins', label: 'Admins' },
  { id: 'clubs', label: 'Club admins' },
  { id: 'rating', label: 'Rating settings' },
  { id: 'backup', label: 'Backup & import' },
]

export function AdminPage() {
  const v = useViewer()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'players') as Tab
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })
  if (!v.isAdmin) return <EmptyState title="Admins only" />
  return (
    <div className="space-y-4">
      <h1>Admin</h1>
      <div role="tablist" className="-mx-4 flex gap-1 overflow-x-auto px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx('btn-sm btn shrink-0', tab === t.id ? 'bg-ink-800 text-white dark:bg-ball-400 dark:text-ink-950' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-800')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'players' && <PlayersTab />}
      {tab === 'admins' && <AdminsTab />}
      {tab === 'clubs' && <ClubAdminsTab />}
      {tab === 'rating' && <RatingTab />}
      {tab === 'backup' && <BackupTab />}
    </div>
  )
}
