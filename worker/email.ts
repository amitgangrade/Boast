import type { Match } from '../shared/api'
import { gamesWon } from '../shared/rating'
import { fmtDate } from '../shared/util'
import type { ChallengeRow, PlayerRow } from './lib'

/**
 * Outgoing email (via Resend). Every function is a no-op without RESEND_API_KEY. Emails
 * about a player's activity go through personalEmail, which respects their notify_*
 * preference and adds unsubscribe links; sign-in links use transactionalEmail.
 * Emails use the brand palette as literal hex, since mail clients can't read CSS variables.
 */

export type EmailKind = 'matches' | 'challenges' | 'reminders' | 'digest' | 'leagues'

const NAVY = '#0b1f4b'
const YELLOW = '#ffd60a'
const BLACK = '#0a0a0a'
const MUTED = '#4a5674'

export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
const first = (name: string) => esc(name.split(' ')[0] || name)
export const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:${NAVY};color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`
export const callout = (html: string) =>
  `<p style="margin:16px 0;padding:10px 12px;background:#fff6c2;border-left:4px solid ${YELLOW};border-radius:4px;color:${BLACK}">${html}</p>`
export const heading = (text: string) => `<h2 style="margin:0 0 8px;color:${NAVY}">${text}</h2>`
export const muted = (html: string) => `<p style="margin:0 0 14px;color:${MUTED}">${html}</p>`

/** Makes sure the player has an unsubscribe token (players created after the migration start without one). */
async function emailToken(db: D1Database, p: PlayerRow): Promise<string> {
  if (p.email_token) return p.email_token
  const token = crypto.randomUUID().replace(/-/g, '')
  await db.prepare('UPDATE players SET email_token = COALESCE(email_token, ?) WHERE id = ?').bind(token, p.id).run()
  const row = await db.prepare('SELECT email_token FROM players WHERE id = ?').bind(p.id).first<{ email_token: string }>()
  return row?.email_token ?? token
}

/** Gives every player an unsubscribe token in one statement, before a bulk send. */
export const ensureEmailTokensStmt = (db: D1Database) =>
  db.prepare('UPDATE players SET email_token = lower(hex(randomblob(16))) WHERE email_token IS NULL AND email IS NOT NULL')

const PREF: Record<EmailKind, keyof PlayerRow> = {
  matches: 'notify_matches',
  challenges: 'notify_challenges',
  reminders: 'notify_reminders',
  digest: 'notify_digest',
  leagues: 'notify_leagues',
}

export function wants(p: PlayerRow, kind: EmailKind): boolean {
  return !!p.email && p[PREF[kind]] !== 0
}

const KIND_LABEL: Record<EmailKind, string> = {
  matches: 'match results and disputes',
  challenges: 'challenges',
  reminders: 'confirmation reminders',
  digest: 'the weekly summary',
  leagues: 'box leagues',
}

export interface OutgoingEmail {
  to: string
  subject: string
  html: string
  headers?: Record<string, string>
}

function layout(greeting: string | null, body: string, footer: string) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:auto;color:${BLACK}">
      <div style="background:${NAVY};color:#fff;padding:12px 16px;border-radius:10px 10px 0 0;font-weight:800;font-size:18px">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${YELLOW};margin-right:8px"></span>Boast
      </div>
      <div style="padding:20px 16px;border:1px solid #e3e6ee;border-top:0;border-radius:0 0 10px 10px">
        ${greeting ? `<p style="margin:0 0 12px">Hi ${greeting},</p>` : ''}
        ${body}
      </div>
      <p style="font-size:12px;color:${MUTED};margin:14px 4px">${footer}</p>
    </div>`
}

/**
 * Builds an email to a player, or null if they have no address or turned this kind off.
 * Includes the unsubscribe link and the one-click List-Unsubscribe headers. `token` skips the
 * lookup when the caller already ensured tokens in bulk.
 */
export async function personalEmail(env: Env, origin: string, to: PlayerRow, kind: EmailKind, subject: string, body: string): Promise<OutgoingEmail | null> {
  if (!wants(to, kind)) return null
  const token = await emailToken(env.DB, to)
  const unsubscribe = `${origin}/unsubscribe?t=${token}&kind=${kind}`
  const footer = `You get these because you play on Boast.
    <a href="${origin}/profile#notifications" style="color:${MUTED}">Email settings</a> ·
    <a href="${unsubscribe}" style="color:${MUTED}">Stop emails about ${KIND_LABEL[kind]}</a>`
  return {
    to: to.email!,
    subject,
    html: layout(first(to.name), body, footer),
    headers: {
      'List-Unsubscribe': `<${origin}/api/unsubscribe/one-click?t=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
}

/** A one-off email that isn't about a player's activity (e.g. a sign-in link). */
export function transactionalEmail(to: string, subject: string, body: string, footer: string): OutgoingEmail {
  return { to, subject, html: layout(null, body, footer) }
}

/**
 * Sends through Resend: one request per email for small sends, the batch endpoint
 * (up to 100 per request) for bulk ones, to stay within Workers' subrequest limits.
 * Returns how many were accepted. No-op without RESEND_API_KEY.
 */
export async function deliver(env: Env, emails: OutgoingEmail[]): Promise<number> {
  if (!env.RESEND_API_KEY || emails.length === 0) return 0
  const headers = { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' }
  const payload = (e: OutgoingEmail) => ({ from: env.EMAIL_FROM, to: [e.to], subject: e.subject, html: e.html, ...(e.headers && { headers: e.headers }) })
  let sent = 0
  if (emails.length <= 2) {
    for (const e of emails) {
      const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify(payload(e)) })
      if (res.ok) sent++
      else console.error('resend failed', res.status, await res.text())
    }
    return sent
  }
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100)
    const res = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers, body: JSON.stringify(chunk.map(payload)) })
    if (res.ok) sent += chunk.length
    else console.error('resend batch failed', res.status, await res.text())
  }
  return sent
}

async function send(env: Env, origin: string, to: PlayerRow, kind: EmailKind, subject: string, body: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false
  const email = await personalEmail(env, origin, to, kind, subject, body)
  return email ? (await deliver(env, [email])) === 1 : false
}

export function scoreLine(m: Pick<Match, 'games'>, a: PlayerRow, b: PlayerRow) {
  const aGames = gamesWon(m.games, 'a')
  const bGames = gamesWon(m.games, 'b')
  const winner = aGames > bGames ? a.name : bGames > aGames ? b.name : null
  const score = m.games.map((g) => `${g.a}–${g.b}`).join(', ')
  return {
    title: `${a.name} ${aGames}–${bGames} ${b.name}`,
    html: `<p style="font-size:18px;margin:0 0 4px"><strong>${esc(a.name)}</strong> ${aGames}–${bGames} <strong>${esc(b.name)}</strong></p>
           <p style="margin:0;color:${MUTED}">${score}${winner ? ` · ${esc(winner)} wins` : ''}</p>`,
  }
}

/** Emails both players (separately) when a match is recorded. */
export async function sendMatchEmail(env: Env, m: Match, a: PlayerRow, b: PlayerRow, origin: string) {
  const recorder = m.createdBy === a.user_id ? a : m.createdBy === b.user_id ? b : null
  const line = scoreLine(m, a, b)
  for (const to of [a, b]) {
    const mustAct = m.status === 'pending' && !!to.user_id && to.id !== recorder?.id
    const body = `
      <h2 style="margin:0 0 4px;color:${NAVY}">${mustAct ? 'Please confirm this match' : 'Match recorded'}</h2>
      <p style="margin:0 0 14px;color:${MUTED}">${fmtDate(m.date)}${m.venue ? ` · ${esc(m.venue)}` : ''}</p>
      ${line.html}
      ${
        mustAct
          ? `${callout(`${recorder ? `${esc(recorder.name)} recorded this match.` : 'This match was recorded for you.'} Confirm or dispute it within 3 days — after that it confirms automatically.`)}
             ${button(`${origin}/activity`, 'Confirm or dispute')}`
          : button(`${origin}/matches/${m.id}`, 'View match')
      }`
    await send(env, origin, to, 'matches', `${mustAct ? '[Please confirm] ' : ''}${line.title}`, body)
  }
}

/** Tells the other participant(s) that a match was disputed. */
export async function sendDisputeEmail(env: Env, m: Match, a: PlayerRow, b: PlayerRow, disputedBy: PlayerRow | null, origin: string) {
  const line = scoreLine(m, a, b)
  for (const to of [a, b]) {
    if (to.id === disputedBy?.id) continue
    const body = `
      <h2 style="margin:0 0 4px;color:${NAVY}">A match was disputed</h2>
      <p style="margin:0 0 14px;color:${MUTED}">${fmtDate(m.date)}${m.venue ? ` · ${esc(m.venue)}` : ''}</p>
      ${line.html}
      ${callout(`${disputedBy ? esc(disputedBy.name) : 'Someone'} disputed this score, so it doesn’t count toward levels. An admin can correct it, or you can delete it and record it again.`)}
      ${button(`${origin}/matches/${m.id}`, 'View match')}`
    await send(env, origin, to, 'matches', `[Disputed] ${line.title}`, body)
  }
}

/** Emails the challenged player. */
export async function sendChallengeEmail(env: Env, ch: ChallengeRow, from: PlayerRow, to: PlayerRow, origin: string) {
  const details = [ch.proposed_date && `on ${fmtDate(ch.proposed_date)}`, ch.venue && `at ${esc(ch.venue)}`].filter(Boolean).join(' ')
  const body = `
    <h2 style="margin:0 0 8px;color:${NAVY}">${esc(from.name)} challenged you</h2>
    <p style="margin:0">${esc(from.name)} wants a match${details ? ` ${details}` : ''}.</p>
    ${ch.message ? callout(`“${esc(ch.message)}”`) : ''}
    ${button(`${origin}/activity`, 'Accept or decline')}`
  await send(env, origin, to, 'challenges', `${from.name} challenged you to a match`, body)
}

/** Lets the other side know a challenge was accepted, declined or cancelled. */
export async function sendChallengeResponseEmail(
  env: Env,
  response: 'accepted' | 'declined' | 'cancelled',
  from: PlayerRow,
  to: PlayerRow,
  origin: string,
) {
  // Accept/decline goes to the challenger; a cancellation goes to the challenged player.
  const recipient = response === 'cancelled' ? to : from
  const actor = response === 'cancelled' ? from : to
  const verb = response === 'accepted' ? 'accepted' : response === 'declined' ? 'declined' : 'cancelled'
  const body = `
    <h2 style="margin:0 0 8px;color:${NAVY}">${esc(actor.name)} ${verb} ${response === 'cancelled' ? 'their' : 'your'} challenge</h2>
    ${response === 'accepted' ? '<p style="margin:0">Arrange a time, play, and either of you can log the result.</p>' : ''}
    ${button(`${origin}/players/${actor.username ?? actor.id}`, `View ${first(actor.name)}’s page`)}`
  await send(env, origin, recipient, 'challenges', `${actor.name} ${verb} ${response === 'cancelled' ? 'their' : 'your'} challenge`, body)
}

/** The site's public origin, remembered when matches are logged so the daily cron can build links. */
export async function siteOrigin(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT data FROM settings WHERE id = 'site'").first<{ data: string }>()
  return row ? ((JSON.parse(row.data) as { origin?: string }).origin ?? null) : null
}

export function rememberOriginStmt(db: D1Database, origin: string): D1PreparedStatement {
  const data = JSON.stringify({ origin })
  return db
    .prepare(
      `INSERT INTO settings (id, data, updated_at) VALUES ('site', ?1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(id) DO UPDATE SET data = ?1, updated_at = excluded.updated_at WHERE settings.data <> ?1`,
    )
    .bind(data)
}
