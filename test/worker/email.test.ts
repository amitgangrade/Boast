import { afterEach, expect, test, vi } from 'vitest'
import type { Match } from '../../shared/api'
import { sendChallengeEmail, sendMatchEmail } from '../../worker/email'
import type { ChallengeRow, PlayerRow } from '../../worker/lib'

function player(over: Partial<PlayerRow>): PlayerRow {
  return {
    id: 'p', user_id: 'u', username: null, name: 'Pat', email: 'pat@gmail.com', email_norm: 'pat@gmail.com', phone: null, country: null,
    city: null, club: null, club_slug: null, avatar_url: null, birth_year: null, gender: null, dominant_hand: null, notes: null,
    starting_level: 1000, seeded_rating: 0, current_level: 1000, matches_played: 0, created_by: null, created_at: '2026-01-01',
    last_played: null, prev_level: null, notify_matches: 1, notify_challenges: 1, notify_reminders: 1, notify_digest: 1, notify_leagues: 1, email_token: 'tok1234567890abcdef', ...over,
  }
}

const match = {
  id: 'm1', date: '2026-03-01', playerAId: 'a', playerBId: 'b', games: [{ a: 11, b: 5 }, { a: 11, b: 7 }, { a: 11, b: 9 }], type: 'friendly',
  venue: null, notes: null, status: 'pending', unranked: false, autoConfirmed: false, confirmedAt: null, disputedAt: null, createdBy: 'ua',
  createdAt: '2026-03-01T10:00:00Z', levelABefore: null, levelBBefore: null, levelAAfter: null, levelBAfter: null, deltaA: null, deltaB: null,
  provisionalA: null, provisionalB: null,
} as Match

/** A D1 stand-in that hands out a token for players created before the migration. */
const db = {
  prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => ({ email_token: 'fresh-token-000000' }) }) }),
} as unknown as D1Database

function setup() {
  const sent: Array<{ to: string[]; subject: string; html: string; headers: Record<string, string> }> = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    return new Response('{}', { status: 200 })
  })
  const env = { RESEND_API_KEY: 'k', EMAIL_FROM: 'Boast <x@y.z>', DB: db } as unknown as Env
  return { sent, env }
}
afterEach(() => vi.unstubAllGlobals())

test('match emails respect preferences and carry unsubscribe links', async () => {
  const { sent, env } = setup()
  const a = player({ id: 'a', user_id: 'ua', name: 'Ann <script>', email: 'ann@gmail.com' })
  const b = player({ id: 'b', user_id: 'ub', name: 'Bob', email: 'bob@gmail.com', email_token: null })
  await sendMatchEmail(env, match, a, b, 'https://boast.test')
  expect(sent.map((s) => s.to[0])).toEqual(['ann@gmail.com', 'bob@gmail.com'])
  // Bob didn't record it, so he's asked to confirm; his token is created on demand.
  expect(sent[1].subject).toMatch(/^\[Please confirm\]/)
  expect(sent[1].headers['List-Unsubscribe']).toBe('<https://boast.test/api/unsubscribe/one-click?t=fresh-token-000000>')
  expect(sent[1].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  expect(sent[0].html).toContain('/unsubscribe?t=tok1234567890abcdef&kind=matches')
  expect(sent[0].html).not.toContain('<script>')

  sent.length = 0
  await sendMatchEmail(env, match, { ...a, notify_matches: 0 }, b, 'https://boast.test')
  expect(sent.map((s) => s.to[0])).toEqual(['bob@gmail.com'])
})

test('challenge emails go to the challenged player unless they opted out', async () => {
  const { sent, env } = setup()
  const ch = { id: 'c', from_player_id: 'a', to_player_id: 'b', message: 'Rematch?', proposed_date: '2026-03-05', venue: 'Court 1' } as ChallengeRow
  const from = player({ id: 'a', name: 'Ann' })
  await sendChallengeEmail(env, ch, from, player({ id: 'b', email: 'bob@gmail.com' }), 'https://boast.test')
  expect(sent).toHaveLength(1)
  expect(sent[0].subject).toBe('Ann challenged you to a match')
  expect(sent[0].html).toContain('Rematch?')
  await sendChallengeEmail(env, ch, from, player({ id: 'b', notify_challenges: 0 }), 'https://boast.test')
  expect(sent).toHaveLength(1)
})
