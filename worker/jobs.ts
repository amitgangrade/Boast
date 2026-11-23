import type { BoxRound } from '../shared/api'
import { boxResults, pairKey } from '../shared/box'
import { fmtDate, fmtDelta, fmtLevel } from '../shared/util'
import { isActive } from '../shared/stats'
import { button, callout, deliver, ensureEmailTokensStmt, esc, heading, muted, type OutgoingEmail, personalEmail, scoreLine, siteOrigin } from './email'
import { type MatchRow, type PlayerRow, toMatch } from './lib'

/**
 * Scheduled and bulk emails. Everything here loads what it needs in a handful of
 * queries and sends through Resend's batch endpoint, so a run stays within Workers'
 * per-invocation limits even for thousands of players.
 */

const DAY_MS = 86_400_000
const isoDay = (offset = 0, now = Date.now()) => new Date(now + offset * DAY_MS).toISOString().slice(0, 10)
const playerHref = (origin: string, p: PlayerRow) => `${origin}/players/${p.username ?? p.id}`
const firstName = (p: PlayerRow | undefined) => esc((p?.name ?? '?').split(' ')[0])
const listNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

async function playersByIds(db: D1Database, ids: string[]): Promise<Map<string, PlayerRow>> {
  if (ids.length === 0) return new Map()
  const { results } = await db.prepare('SELECT * FROM players WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...new Set(ids)])).all<PlayerRow>()
  return new Map(results.map((p) => [p.id, p]))
}

/** Prepares a bulk send: tokens for unsubscribe links, and the site origin for links. */
async function bulkStart(env: Env): Promise<string | null> {
  if (!env.RESEND_API_KEY) return null
  const origin = await siteOrigin(env.DB)
  if (!origin) return null
  await ensureEmailTokensStmt(env.DB).run()
  return origin
}

// ---------------------------------------------------------------------------
// Daily: "confirms tomorrow" reminders
// ---------------------------------------------------------------------------

/** Reminds players about pending matches that auto-confirm at the next run (recorded 2–3 days ago). */
export async function sendConfirmReminders(env: Env): Promise<number> {
  const origin = await bulkStart(env)
  if (!origin) return 0
  const db = env.DB
  const now = Date.now()
  const { results } = await db
    .prepare(
      `SELECT m.* FROM matches m
       JOIN players pa ON pa.id = m.player_a_id JOIN players pb ON pb.id = m.player_b_id
       WHERE m.status = 'pending' AND m.created_at >= ? AND m.created_at < ? AND pa.user_id IS NOT NULL AND pb.user_id IS NOT NULL`,
    )
    .bind(new Date(now - 3 * DAY_MS).toISOString(), new Date(now - 2 * DAY_MS).toISOString())
    .all<MatchRow>()
  const players = await playersByIds(db, results.flatMap((m) => [m.player_a_id, m.player_b_id]))
  const emails: OutgoingEmail[] = []
  for (const row of results) {
    const a = players.get(row.player_a_id)
    const b = players.get(row.player_b_id)
    if (!a || !b) continue
    const m = toMatch(row)
    const line = scoreLine(m, a, b)
    for (const p of [a, b]) {
      if (p.user_id === m.createdBy) continue
      const body = `
        ${heading('This match confirms tomorrow')}
        ${muted(`${fmtDate(m.date)}${m.venue ? ` · ${esc(m.venue)}` : ''}`)}
        ${line.html}
        ${callout('If the score is right, there’s nothing to do — it counts automatically tomorrow. If it’s wrong, dispute it before then.')}
        ${button(`${origin}/activity`, 'Review match')}`
      const e = await personalEmail(env, origin, p, 'reminders', `[Confirms tomorrow] ${line.title}`, body)
      if (e) emails.push(e)
    }
  }
  return deliver(env, emails)
}

// ---------------------------------------------------------------------------
// Box leagues
// ---------------------------------------------------------------------------

interface RoundRow {
  id: string
  group_id: string
  name: string
  starts_on: string
  ends_on: string
  created_at: string
  group_name: string
  group_slug: string
}

async function loadRounds(db: D1Database, where: string, ...args: unknown[]) {
  const { results: rounds } = await db
    .prepare(`SELECT r.*, g.name AS group_name, g.slug AS group_slug FROM box_rounds r JOIN groups g ON g.id = r.group_id WHERE ${where}`)
    .bind(...args)
    .all<RoundRow>()
  if (rounds.length === 0) return { rounds: [] as Array<BoxRound & { row: RoundRow }>, matches: [] }
  const [entries, matches] = await db.batch([
    db.prepare('SELECT round_id, player_id, box FROM box_entries WHERE round_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(rounds.map((r) => r.id))),
    db
      .prepare("SELECT * FROM matches WHERE type = 'box' AND status = 'confirmed' AND date >= ? AND date <= ?")
      .bind(rounds.reduce((x, r) => (r.starts_on < x ? r.starts_on : x), '9999'), rounds.reduce((x, r) => (r.ends_on > x ? r.ends_on : x), '0000')),
  ])
  const boxes = new Map<string, string[][]>()
  for (const e of entries.results as Array<{ round_id: string; player_id: string; box: number }>) {
    const bs = boxes.get(e.round_id) ?? []
    ;(bs[e.box - 1] ??= []).push(e.player_id)
    boxes.set(e.round_id, bs)
  }
  return {
    rounds: rounds.map((r) => ({
      id: r.id,
      groupId: r.group_id,
      name: r.name,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      createdAt: r.created_at,
      boxes: Array.from(boxes.get(r.id) ?? [], (b) => b ?? []),
      row: r,
    })),
    matches: (matches.results as MatchRow[]).map(toMatch),
  }
}

/** Box-mates a player still has to play in a round. */
function stillToPlay(round: BoxRound, matches: ReturnType<typeof toMatch>[], playerId: string): string[] {
  const box = round.boxes.find((b) => b.includes(playerId))
  if (!box) return []
  const { cells } = boxResults(round, box, matches)
  return box.filter((id) => id !== playerId && !cells.has(pairKey(id, playerId)))
}

/** Tells everyone in a new round which box they're in and who to play. Called when a round is created. */
export async function sendRoundStartEmails(env: Env, origin: string, roundId: string): Promise<number> {
  if (!env.RESEND_API_KEY) return 0
  await ensureEmailTokensStmt(env.DB).run()
  const { rounds } = await loadRounds(env.DB, 'r.id = ?', roundId)
  const round = rounds[0]
  if (!round) return 0
  const players = await playersByIds(env.DB, round.boxes.flat())
  const emails: OutgoingEmail[] = []
  for (const [i, box] of round.boxes.entries()) {
    for (const id of box) {
      const p = players.get(id)
      if (!p?.user_id) continue
      const mates = box.filter((x) => x !== id).map((x) => players.get(x)).filter((x): x is PlayerRow => !!x)
      const body = `
        ${heading(`You’re in Box ${i + 1} of ${esc(round.name)}`)}
        ${muted(`${esc(round.row.group_name)} · ${fmtDate(round.startsOn)} – ${fmtDate(round.endsOn)}`)}
        <p style="margin:0 0 8px">Play everyone in your box by <strong>${fmtDate(round.endsOn)}</strong>:</p>
        <ul style="margin:0 0 8px;padding-left:20px">${mates.map((m) => `<li><a href="${playerHref(origin, m)}">${esc(m.name)}</a></li>`).join('')}</ul>
        ${callout(`Log each result as a <strong>Box</strong> match. ${i > 0 ? 'Top of the box moves up' : 'Top of the box stays on top'}${i < round.boxes.length - 1 ? ', bottom moves down.' : '.'}`)}
        ${button(`${origin}/groups/${round.row.group_slug}`, 'See your box')}`
      const e = await personalEmail(env, origin, p, 'leagues', `Your box for ${round.name}: ${mates.map((m) => m.name.split(' ')[0]).join(', ')}`, body)
      if (e) emails.push(e)
    }
  }
  return deliver(env, emails)
}

/** Five days before a round ends, nudges players who still have box matches to play. */
export async function sendBoxNudges(env: Env): Promise<number> {
  const origin = await bulkStart(env)
  if (!origin) return 0
  const today = isoDay()
  // Rounds ending in exactly 5 days that are at least 10 days long (shorter rounds don't need a nudge).
  const { rounds, matches } = await loadRounds(env.DB, "r.ends_on = ? AND julianday(r.ends_on) - julianday(r.starts_on) >= 9", isoDay(5))
  const live = rounds.filter((r) => r.startsOn <= today)
  const players = await playersByIds(env.DB, live.flatMap((r) => r.boxes.flat()))
  const emails: OutgoingEmail[] = []
  for (const round of live) {
    for (const id of round.boxes.flat()) {
      const p = players.get(id)
      const todo = stillToPlay(round, matches, id).map((x) => players.get(x)).filter((x): x is PlayerRow => !!x)
      if (!p?.user_id || todo.length === 0) continue
      const body = `
        ${heading(`5 days left in ${esc(round.name)}`)}
        ${muted(`${esc(round.row.group_name)} · ends ${fmtDate(round.endsOn)}`)}
        <p style="margin:0 0 8px">You still have ${todo.length === 1 ? 'a match' : `${todo.length} matches`} to play: <strong>${listNames(todo.map((t) => esc(t.name)))}</strong>.</p>
        ${callout('Unplayed matches score nothing, so get them on court — and log them as <strong>Box</strong> matches.')}
        ${button(`${origin}/groups/${round.row.group_slug}`, 'See your box')}`
      const e = await personalEmail(env, origin, p, 'leagues', `5 days left: still to play ${todo.map((t) => t.name.split(' ')[0]).join(', ')}`, body)
      if (e) emails.push(e)
    }
  }
  return deliver(env, emails)
}

// ---------------------------------------------------------------------------
// Weekly digest (Mondays)
// ---------------------------------------------------------------------------

const ordinalRank = (n: number) => `#${n}`

function ranks(players: PlayerRow[], level: (p: PlayerRow) => number | null) {
  const ranked = players.filter((p) => level(p) != null).sort((x, y) => level(y)! - level(x)! || x.name.localeCompare(y.name))
  return new Map(ranked.map((p, i) => [p.id, i + 1]))
}

/**
 * The Monday summary for each active player who had something happen: level and rank
 * change this week, results, matches waiting for them, box matches still to play, and
 * the biggest climber at their club. Quiet weeks get no email.
 */
export async function sendWeeklyDigest(env: Env, now = Date.now()): Promise<number> {
  const origin = await bulkStart(env)
  if (!origin) return 0
  const db = env.DB
  const weekAgo = isoDay(-7, now)
  const today = isoDay(0, now)
  const [playersRes, weekRes, pendingRes] = await db.batch([
    db.prepare('SELECT * FROM players'),
    db.prepare("SELECT * FROM matches WHERE status = 'confirmed' AND date > ?").bind(weekAgo),
    db.prepare("SELECT * FROM matches WHERE status = 'pending'"),
  ])
  const all = playersRes.results as PlayerRow[]
  const byId = new Map(all.map((p) => [p.id, p]))
  const active = all.filter((p) => isActive({ lastPlayed: p.last_played, createdAt: p.created_at }, now))
  const week = (weekRes.results as MatchRow[]).map(toMatch)
  const pending = (pendingRes.results as MatchRow[]).map(toMatch)
  const { rounds, matches: boxMatches } = await loadRounds(db, 'r.starts_on <= ?1 AND r.ends_on >= ?1', today)

  // Rankings now and a week ago: within each club, and overall.
  const level = (p: PlayerRow) => p.current_level ?? p.starting_level
  const overallNow = ranks(active, level)
  const overallThen = ranks(active, (p) => p.prev_level)
  const clubs = new Map<string, PlayerRow[]>()
  for (const p of active) if (p.club_slug) clubs.set(p.club_slug, [...(clubs.get(p.club_slug) ?? []), p])
  const clubNow = new Map<string, Map<string, number>>()
  const clubThen = new Map<string, Map<string, number>>()
  const climber = new Map<string, { p: PlayerRow; gain: number }>()
  for (const [slug, members] of clubs) {
    clubNow.set(slug, ranks(members, level))
    clubThen.set(slug, ranks(members, (p) => p.prev_level))
    for (const p of members) {
      const gain = p.prev_level == null ? 0 : level(p) - p.prev_level
      if (gain >= 0.5 && gain > (climber.get(slug)?.gain ?? 0)) climber.set(slug, { p, gain })
    }
  }

  const emails: OutgoingEmail[] = []
  for (const p of active) {
    if (!p.user_id || !p.email) continue
    const mine = week.filter((m) => m.playerAId === p.id || m.playerBId === p.id)
    const results = mine.map((m) => {
      const side = m.playerAId === p.id ? 'a' : 'b'
      const [gf, ga] = side === 'a' ? [m.games.filter((g) => g.a > g.b).length, m.games.filter((g) => g.b > g.a).length] : [m.games.filter((g) => g.b > g.a).length, m.games.filter((g) => g.a > g.b).length]
      return { m, won: gf > ga, lost: gf < ga, opp: byId.get(side === 'a' ? m.playerBId : m.playerAId), score: `${gf}–${ga}` }
    })
    const waiting = pending.filter((m) => (m.playerAId === p.id || m.playerBId === p.id) && m.createdBy !== p.user_id)
    const box = rounds
      .filter((r) => r.boxes.some((b) => b.includes(p.id)))
      .map((r) => ({ r, todo: stillToPlay(r, boxMatches, p.id).map((x) => byId.get(x)).filter((x): x is PlayerRow => !!x) }))
      .filter((x) => x.todo.length > 0)
    const change = p.prev_level == null ? null : level(p) - p.prev_level
    const moved = change != null && Math.abs(change) >= 0.5
    if (results.length === 0 && waiting.length === 0 && box.length === 0 && !moved) continue

    const inClub = p.club_slug && (clubs.get(p.club_slug)?.length ?? 0) >= 3
    const nowRank = inClub ? clubNow.get(p.club_slug!)!.get(p.id) : overallNow.get(p.id)
    const thenRank = inClub ? clubThen.get(p.club_slug!)!.get(p.id) : overallThen.get(p.id)
    const scopeLabel = inClub ? `at ${esc(p.club!)}` : 'on Boast'
    const scopeSize = inClub ? clubs.get(p.club_slug!)!.length : active.length
    const rankMove = nowRank && thenRank && thenRank !== nowRank ? ` (${thenRank > nowRank ? '▲' : '▼'}${Math.abs(thenRank - nowRank)})` : ''
    const top = p.club_slug ? climber.get(p.club_slug) : undefined
    const wins = results.filter((r) => r.won).length
    const losses = results.filter((r) => r.lost).length

    const lines = [
      `<li><strong>Level ${fmtLevel(level(p))}</strong> ${change == null ? '(new this week)' : moved ? `(${fmtDelta(change)} this week)` : '(no change this week)'}</li>`,
      nowRank ? `<li><strong>${ordinalRank(nowRank)}</strong> of ${scopeSize} ${scopeLabel}${rankMove}</li>` : '',
      results.length
        ? `<li>Played ${results.length}: won ${wins}, lost ${losses} — ${results
            .slice(0, 4)
            .map((r) => `${r.won ? 'beat' : r.lost ? 'lost to' : 'drew with'} ${firstName(r.opp)} ${r.score}`)
            .join(', ')}${results.length > 4 ? '…' : ''}</li>`
        : '',
      ...box.map((x) => `<li>Box league (${esc(x.r.name)}, ends ${fmtDate(x.r.endsOn)}): still to play ${listNames(x.todo.map((t) => esc(t.name)))}</li>`),
      top && top.p.id !== p.id ? `<li>Biggest climber ${scopeLabel}: ${esc(top.p.name)} ${fmtDelta(top.gain)}</li>` : '',
    ].filter(Boolean)
    const body = `
      ${heading('Your week on Boast')}
      <ul style="margin:0 0 8px;padding-left:20px;line-height:1.6">${lines.join('')}</ul>
      ${waiting.length ? callout(`${waiting.length === 1 ? 'A match is' : `${waiting.length} matches are`} waiting for you to confirm.`) + button(`${origin}/activity`, 'Confirm or dispute') : button(inClub ? `${origin}/clubs/${p.club_slug}` : `${origin}/`, 'See the leaderboard')}`
    const subject = `Your week: ${fmtLevel(level(p))}${moved ? ` (${fmtDelta(change)})` : ''}${nowRank ? ` · ${ordinalRank(nowRank)} ${inClub ? `at ${p.club}` : 'overall'}` : ''}`
    const e = await personalEmail(env, origin, p, 'digest', subject, body)
    if (e) emails.push(e)
  }
  return deliver(env, emails)
}
