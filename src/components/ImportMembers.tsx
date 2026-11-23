import { useMemo, useState } from 'react'
import type { ImportMembersInput, ImportMembersResult } from '../../shared/api'
import { MEMBER_TEMPLATE, type MemberRow, membersFromCsv, parseCsv } from '../../shared/csv'
import { fmtLevel } from '../../shared/util'
import { api, useApiMutation } from '../api'
import { toast } from './feedback'
import { ActionButton, Alert, ErrorText, Modal } from './ui'

/** Club admins add members from a spreadsheet: paste or upload a CSV, check the preview, import. */
export function ImportMembers({ slug, clubName }: { slug: string; clubName: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const parsed = useMemo(() => (text.trim() ? membersFromCsv(parseCsv(text)) : null), [text])
  const good = parsed?.rows.filter((r): r is MemberRow & { member: NonNullable<MemberRow['member']> } => !!r.member) ?? []
  const bad = parsed?.rows.filter((r) => r.error) ?? []
  const run = useApiMutation((input: ImportMembersInput) => api<ImportMembersResult>(`/clubs/${slug}/import`, { method: 'POST', body: input }))
  const close = () => {
    setOpen(false)
    setText('')
    run.reset()
  }
  const readFile = async (file: File | undefined) => {
    if (file) setText(await file.text())
  }
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(MEMBER_TEMPLATE)}`

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(true)}>
        Import members (CSV)
      </button>
      {open && (
        <Modal title={`Import members into ${clubName}`} onClose={close} wide>
          {run.data ? (
            <div className="space-y-4">
              <Alert kind="ok">
                Added {run.data.added.length} {run.data.added.length === 1 ? 'player' : 'players'} to {clubName}.
                {run.data.existing.length > 0 && ` ${run.data.existing.length} already on Boast ${run.data.existing.length === 1 ? 'was' : 'were'} left as they are.`}
              </Alert>
              {run.data.existing.some((e) => !e.inClub) && (
                <p className="text-sm muted">
                  Already on Boast in another club (they can switch with your invite link): {run.data.existing.filter((e) => !e.inClub).map((e) => e.name).join(', ')}.
                </p>
              )}
              <p className="text-sm">
                They show as “not on Boast yet” until they sign in with that email. Share your club’s invite link so they do.
              </p>
              <div className="flex justify-end">
                <button type="button" className="btn-primary" onClick={close}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm">
                One row per member with a header row. <strong>Name</strong> (or First name + Surname) and <strong>Email</strong> are required; Rating, Gender, Birth year,
                Phone, City, Country and Hand are optional. A rating skips the provisional period. Comma, semicolon or tab separated all work.{' '}
                <a className="link" href={template} download="boast-members.csv">
                  Download a template
                </a>
                .
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="btn-secondary btn-sm">
                  Choose a CSV file
                  <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
                </label>
                <span className="text-xs muted">or paste below (from Excel or Google Sheets)</span>
              </div>
              <textarea
                className="input min-h-32 font-mono text-xs"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={MEMBER_TEMPLATE}
                aria-label="CSV data"
              />
              {parsed && parsed.missing.length > 0 && <Alert>Couldn’t find a column for: {parsed.missing.join(', ')}. Check the header row.</Alert>}
              {good.length > 0 && (
                <div className="max-h-64 overflow-auto rounded-lg ring-1 ring-slate-200 dark:ring-ink-700">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 muted dark:bg-ink-800">
                      <tr>
                        <th className="px-2 py-1.5">Name</th>
                        <th className="px-2 py-1.5">Email</th>
                        <th className="px-2 py-1.5 text-right">Rating</th>
                        <th className="hidden px-2 py-1.5 sm:table-cell">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {good.map((r) => (
                        <tr key={r.line} className="border-t border-slate-100 dark:border-ink-800">
                          <td className="px-2 py-1.5 font-medium">{r.member.name}</td>
                          <td className="max-w-40 truncate px-2 py-1.5">{r.member.email}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.member.rating ? fmtLevel(r.member.rating) : <span className="muted">new</span>}</td>
                          <td className="hidden px-2 py-1.5 muted sm:table-cell">
                            {[r.member.gender === 'male' ? 'M' : r.member.gender === 'female' ? 'F' : null, r.member.birthYear, r.member.city, r.member.country].filter(Boolean).join(' · ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {bad.length > 0 && (
                <Alert kind="warn">
                  <strong>
                    {bad.length} {bad.length === 1 ? 'row' : 'rows'} will be skipped:
                  </strong>
                  <ul className="mt-1 list-disc pl-5">
                    {bad.slice(0, 8).map((r) => (
                      <li key={r.line}>
                        Row {r.line}: {r.error}
                      </li>
                    ))}
                    {bad.length > 8 && <li>…and {bad.length - 8} more</li>}
                  </ul>
                </Alert>
              )}
              {good.length > 500 && <Alert>That’s {good.length} members — import at most 500 at a time.</Alert>}
              <ErrorText error={run.error} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={close}>
                  Cancel
                </button>
                <ActionButton
                  className="btn-primary"
                  status={run.status}
                  disabled={good.length === 0 || good.length > 500}
                  onClick={() =>
                    run.mutate(
                      { members: good.map((r) => r.member) },
                      { onSuccess: (res) => toast(`Imported ${res.added.length} ${res.added.length === 1 ? 'member' : 'members'}`) },
                    )
                  }
                >
                  Import {good.length || ''} {good.length === 1 ? 'member' : 'members'}
                </ActionButton>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
