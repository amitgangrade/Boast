import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { recomputeLevels } from '../../worker/levels'
import { sendBoxNudges, sendConfirmReminders, sendRoundStartEmails, sendWeeklyDigest } from '../../worker/jobs'
import { testDb } from './d1'

type Sent = { to: string[]; subject: string; html: string; headers?: Record<string, string> }
let sent: Sent[] = []
let requests = 0

beforeEach(() => {
  sent = []
  requests = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests++
    const body = JSON.parse(String(init.body))
    sent.push(...(url.endsWith('/batch') ? body : [body]))
    return new Response('{}', { status: 200 })
  })
})
afterEach(() => vi.unstubAllGlobals())

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const games = (aWins: boolean) => JSON.stringify(Array.from({ length: 3 }, () => (aWins ? { a: 11, b: 6 } : { a: 6, b: 11 })))

function world() {
  const { d1, raw } = testDb()
  const env = { DB: d1, RESEND_API_KEY: 'k', EMAIL_FROM: 'Boast <b@x.y>' } as unknown as Env
  raw.prepare("INSERT INTO settings (id, data) VALUES ('site', '{\"origin\":\"https://boast.test\"}')").run()
  const people = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay']
  people.forEach((id, i) => {
    raw.prepare('INSERT INTO users (id, email, email_norm) VALUES (?, ?, ?)').run(`u-${id}`, `${id}@x.y`, `${id}@x.y`)
    raw
      .prepare("INSERT INTO players (id, user_id, name, email, club, club_slug, starting_level, created_at) VALUES (?, ?, ?, ?, 'Hampstead SC', 'hampstead-sc', ?, '2025-01-01T00:00:00.000Z')")
      .run(id, `u-${id}`, `${id[0].toUpperCase()}${id.slice(1)} Smith`, `${id}@x.y`, 2000 - i * 100)
  })
  let n = 0
  const match = (a: string, b: string, date: string, opts: { aWins?: boolean; status?: string; type?: string; createdBy?: string; createdAt?: string } = {}) =>
    raw
      .prepare('INSERT INTO matches (id, date, player_a_id, player_b_id, games, type, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`m${++n}`, date, a, b, games(opts.aWins ?? true), opts.type ?? 'friendly', opts.status ?? 'confirmed', opts.createdBy ?? `u-${a}`, opts.createdAt ?? new Date().toISOString())
  return { env, raw, d1, match }
}

test('weekly digest: level, club rank and results for players who played; quiet and opted-out players get nothing', async () => {
  const { env, raw, d1, match } = world()
  match('ann', 'bob', day(-30))
  match('cat', 'dan', day(-30))
  await recomputeLevels(d1)
  match('fay', 'ann', day(-2), { aWins: true }) // Fay (lowest) beats Ann this week
  match('bob', 'cat', day(-1), { status: 'pending', createdBy: 'u-bob' }) // waiting for Cat
  raw.prepare("UPDATE players SET notify_digest = 0 WHERE id = 'bob'").run()
  // Last week's baseline: levels as of 7 days ago are today's minus this week's match.
  await recomputeLevels(d1)

  await sendWeeklyDigest(env)
  const to = sent.map((s) => s.to[0]).sort()
  // Ann and Fay played; Cat has a match to confirm; Bob opted out; Dan and Eve had a quiet week.
  expect(to).toEqual(['ann@x.y', 'cat@x.y', 'fay@x.y'])
  const fay = sent.find((s) => s.to[0] === 'fay@x.y')!
  expect(fay.subject).toMatch(/^Your week: [\d,]+ \(\+\d+\) · #\d at Hampstead SC$/)
  expect(fay.html).toContain('beat Ann 3–0')
  // Eve hasn't played or joined in over a year, so she's inactive and not ranked.
  expect(fay.html).toContain('<strong>#5</strong> of 5 at Hampstead SC</li>')
  expect(fay.html).toContain('(+71 this week)')
  expect(fay.headers?.['List-Unsubscribe']).toMatch(/one-click\?t=[0-9a-f]{32}>$/)
  const cat = sent.find((s) => s.to[0] === 'cat@x.y')!
  expect(cat.html).toContain('A match is waiting for you to confirm')
  expect(requests).toBe(1) // one batch request for all of them
})

test('confirm reminders go to the player who has to confirm, for matches logged 2–3 days ago', async () => {
  const { env, match } = world()
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()
  match('ann', 'bob', day(-2), { status: 'pending', createdBy: 'u-ann', createdAt: at(2.5) })
  match('cat', 'dan', day(-1), { status: 'pending', createdBy: 'u-cat', createdAt: at(1) })
  await sendConfirmReminders(env)
  expect(sent.map((s) => [s.to[0], s.subject])).toEqual([['bob@x.y', '[Confirms tomorrow] Ann Smith 3–0 Bob Smith']])
})

test('box league: round start emails list box-mates; the 5-day nudge lists only unplayed opponents', async () => {
  const { env, raw, match } = world()
  raw.prepare("INSERT INTO groups (id, name, slug) VALUES ('g', 'Tuesday Box', 'tuesday-box')").run()
  raw.prepare("INSERT INTO box_rounds (id, group_id, name, starts_on, ends_on) VALUES ('r', 'g', 'December', ?, ?)").run(day(-20), day(5))
  for (const [id, box] of [['ann', 1], ['bob', 1], ['cat', 1], ['dan', 2], ['eve', 2]] as const) {
    raw.prepare("INSERT INTO box_entries (round_id, player_id, box) VALUES ('r', ?, ?)").run(id, box)
  }
  raw.prepare("UPDATE players SET notify_leagues = 0 WHERE id = 'eve'").run()

  await sendRoundStartEmails(env, 'https://boast.test', 'r')
  expect(sent.map((s) => s.to[0]).sort()).toEqual(['ann@x.y', 'bob@x.y', 'cat@x.y', 'dan@x.y'])
  expect(sent.find((s) => s.to[0] === 'ann@x.y')!.subject).toBe('Your box for December: Bob, Cat')

  sent = []
  match('ann', 'bob', day(-3), { type: 'box' })
  match('ann', 'cat', day(-3), { type: 'friendly' }) // not a box match, so it doesn't count
  await sendBoxNudges(env)
  const subjects = Object.fromEntries(sent.map((s) => [s.to[0], s.subject]))
  expect(subjects).toEqual({
    'ann@x.y': '5 days left: still to play Cat',
    'bob@x.y': '5 days left: still to play Cat',
    'cat@x.y': '5 days left: still to play Ann, Bob',
    'dan@x.y': '5 days left: still to play Eve',
  })
})

test('nothing is sent without an email service configured', async () => {
  const { env } = world()
  const off = { ...env, RESEND_API_KEY: '' } as Env
  expect(await sendWeeklyDigest(off)).toBe(0)
  expect(await sendBoxNudges(off)).toBe(0)
  expect(requests).toBe(0)
})
