import { expect, test } from 'vitest'
import { canonicalCountry } from '../shared/countries'
import { isGoogleMail, normEmail, parseLocation, slugify } from '../shared/util'

test('gmail addresses normalise dots, plus-tags and googlemail', () => {
  expect(normEmail('J.Doe+work@GoogleMail.com')).toBe('jdoe@gmail.com')
  expect(normEmail('Foo.Bar@Example.COM')).toBe('foo.bar@example.com')
  expect(normEmail('not-an-email')).toBeNull()
  expect(normEmail('')).toBeNull()
})

test('only Google mail can be used for placeholder players', () => {
  expect(isGoogleMail('a@gmail.com')).toBe(true)
  expect(isGoogleMail('a@googlemail.com')).toBe(true)
  expect(isGoogleMail('a@yahoo.com')).toBe(false)
})

test('slugs collapse case and punctuation', () => {
  expect(slugify('Westside Squash & Racquet Club')).toBe('westside-squash-racquet-club')
  expect(slugify('  westside   SRC ')).toBe(slugify('Westside SRC'))
  expect(slugify('   ')).toBe('')
})

test('countries are canonicalised and cities validated', () => {
  expect(canonicalCountry('singapore')).toBe('Singapore')
  expect(canonicalCountry('USA')).toBe('United States')
  expect(parseLocation({ country: 'Narnia', city: 'X' }).ok).toBe(false)
  expect(parseLocation({ country: 'India', city: 'asdf123' }).ok).toBe(false)
  expect(parseLocation({ country: 'india', city: "Saint-Jean d'Arc" })).toEqual({ ok: true, value: { country: 'India', city: "Saint-Jean d'Arc" } })
})
