import { expect, test } from 'vitest'
import { explainMatch, type ExplainInput } from '../shared/explain'
import { DEFAULT_SETTINGS as S, updateLevels } from '../shared/rating'

function input(over: Partial<ExplainInput> = {}): ExplainInput {
  const base = { levelA: 4292, levelB: 2462, games: [{ a: 11, b: 9 }, { a: 14, b: 12 }, { a: 11, b: 9 }], type: 'friendly' as const, provisionalA: false, provisionalB: false }
  const merged = { ...base, ...over }
  const u = updateLevels({ ...merged, settings: S })
  return { ...merged, deltaA: u.deltaA, deltaB: u.deltaB, nameA: 'Amit', nameB: 'Vijoy', settings: S, side: 'a', ...over }
}

test('a narrow win by the big favourite reads as worse than predicted', () => {
  const e = explainMatch(input())
  expect(Math.round(e.expected * 100)).toBe(85)
  expect(Math.round(e.actual * 100)).toBe(77)
  expect(e.lines[0]).toContain('expected to win 85%')
  expect(e.lines.join(' ')).toMatch(/Worse than predicted, so Amit loses 27 points and Vijoy gains 15 points/)
})

test('the other player sees the mirror image', () => {
  const e = explainMatch(input({ side: 'b' }))
  expect(Math.round(e.expected * 100)).toBe(15)
  expect(Math.round(e.actual * 100)).toBe(23)
  expect(e.lines.join(' ')).toMatch(/Better than predicted, so Vijoy gains 15 points and Amit loses 27 points/)
})

test('a one-sided provisional match explains who is protected', () => {
  const e = explainMatch(input({ levelA: 1000, levelB: 1500, provisionalA: true }))
  expect(e.lines.join(' ')).toContain('only Amit’s level moved — Vijoy’s is protected')
  expect(e.lines.join(' ')).not.toContain('Vijoy gains')
})

test('the match-type line names the weight', () => {
  expect(explainMatch(input({ type: 'tournament' })).lines.join(' ')).toContain('Tournament matches count ×1.6')
})

test('preview wording talks about what would happen', () => {
  const text = explainMatch(input({ preview: true, levelA: 1000, levelB: 1500, provisionalA: true })).lines.join(' ')
  expect(text).toContain('is expected to win')
  expect(text).toMatch(/Amit would gain \d+ points/)
  expect(text).toContain('Amit is provisional')
})
