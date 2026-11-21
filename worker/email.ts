import type { Match } from '../shared/api'
import { gamesWon } from '../shared/rating'
import { fmtDate } from '../shared/util'
import type { PlayerRow } from './lib'

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

/** Emails both players (separately) when a match is recorded. No-op without RESEND_API_KEY. */
export async function sendMatchEmail(env: Env, m: Match, a: PlayerRow, b: PlayerRow, origin: string) {
  if (!env.RESEND_API_KEY) return
  const aGames = gamesWon(m.games, 'a')
  const bGames = gamesWon(m.games, 'b')
  const winner = aGames > bGames ? a.name : bGames > aGames ? b.name : null
  const score = m.games.map((g) => `${g.a}–${g.b}`).join(', ')
  const recorder = m.createdBy === a.user_id ? a : m.createdBy === b.user_id ? b : null

  for (const to of [a, b]) {
    if (!to.email) continue
    const mustAct = m.status === 'pending' && to.user_id && to.id !== recorder?.id
    const subject = `${mustAct ? '[Please confirm] ' : ''}${a.name} ${aGames}–${bGames} ${b.name}`
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:auto;color:#0f172a">
        <h2 style="margin:0 0 4px">${mustAct ? 'Please confirm this match' : 'Match recorded'}</h2>
        <p style="margin:0 0 16px;color:#475569">${fmtDate(m.date)}${m.venue ? ` · ${esc(m.venue)}` : ''}</p>
        <p style="font-size:18px;margin:0 0 4px"><strong>${esc(a.name)}</strong> ${aGames}–${bGames} <strong>${esc(b.name)}</strong></p>
        <p style="margin:0 0 16px;color:#475569">${score}${winner ? ` · ${esc(winner)} wins` : ''}</p>
        ${
          mustAct
            ? `<p style="padding:10px 12px;background:#fef9c3;border-left:3px solid #ca8a04;border-radius:4px">
                 ${recorder ? `${esc(recorder.name)} recorded this match.` : 'This match was recorded for you.'}
                 Confirm or dispute it within 3 days — after that it confirms automatically.</p>
               <p><a href="${origin}/activity" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Confirm or dispute</a></p>`
            : `<p><a href="${origin}/" style="color:#0f172a;font-weight:600">Open Boast →</a></p>`
        }
      </div>`
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to.email], subject, html }),
    })
    if (!res.ok) console.error('resend failed', res.status, await res.text())
  }
}
