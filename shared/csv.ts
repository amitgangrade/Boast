import { canonicalCountry } from './countries'
import { EMAIL_RE, type Gender, type Hand, normEmail, validBirthYear } from './util'

/** Parses CSV (comma, semicolon or tab separated, as Excel exports in different locales), with quoted fields. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', ';', '\t'].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ',')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''))
}

export interface MemberDraft {
  name: string
  email: string
  rating: number | null
  gender: Gender | null
  birthYear: number | null
  phone: string | null
  city: string | null
  country: string | null
  dominantHand: Hand | null
}

export interface MemberRow {
  line: number
  member: MemberDraft | null
  error: string | null
}

const HEADERS: Record<keyof MemberDraft, string[]> = {
  name: ['name', 'full name', 'player', 'player name', 'member', 'member name'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  rating: ['rating', 'level', 'squash level', 'starting level', 'grade'],
  gender: ['gender', 'sex'],
  birthYear: ['birth year', 'year of birth', 'born', 'yob', 'dob', 'date of birth', 'birthday'],
  phone: ['phone', 'mobile', 'telephone', 'phone number', 'mobile number'],
  city: ['city', 'town'],
  country: ['country', 'nation'],
  dominantHand: ['hand', 'dominant hand', 'handedness', 'plays'],
}
const FIRST = ['first name', 'firstname', 'given name', 'forename']
const LAST = ['last name', 'lastname', 'surname', 'family name']

const norm = (h: string) => h.toLowerCase().replace(/[_*]/g, ' ').replace(/\s+/g, ' ').trim()

function gender(v: string): Gender | null | undefined {
  const x = v.toLowerCase()
  if (!x) return null
  if (['m', 'male', 'man', 'men'].includes(x)) return 'male'
  if (['f', 'female', 'woman', 'women', 'w'].includes(x)) return 'female'
  return undefined
}
function hand(v: string): Hand | null | undefined {
  const x = v.toLowerCase()
  if (!x) return null
  if (['r', 'right', 'right-handed', 'right handed'].includes(x)) return 'right'
  if (['l', 'left', 'left-handed', 'left handed'].includes(x)) return 'left'
  if (['ambi', 'both', 'ambidextrous'].includes(x)) return 'ambi'
  return undefined
}

/**
 * Turns CSV rows (with a header row) into members to import. Headers are matched loosely
 * ("E-mail", "Year of birth", "First name" + "Surname"…); unknown columns are ignored.
 * Duplicate emails within the file are flagged.
 */
export function membersFromCsv(rows: string[][]): { rows: MemberRow[]; missing: string[] } {
  if (rows.length === 0) return { rows: [], missing: ['name', 'email'] }
  const header = rows[0].map(norm)
  const col = (names: string[]) => header.findIndex((h) => names.includes(h))
  const idx = Object.fromEntries((Object.keys(HEADERS) as Array<keyof MemberDraft>).map((k) => [k, col(HEADERS[k])])) as Record<keyof MemberDraft, number>
  const first = col(FIRST)
  const last = col(LAST)
  const missing = [idx.name < 0 && first < 0 ? 'name' : null, idx.email < 0 ? 'email' : null].filter((x): x is string => !!x)
  if (missing.length) return { rows: [], missing }
  const seen = new Set<string>()
  const out: MemberRow[] = rows.slice(1).map((r, i) => {
    const get = (k: keyof MemberDraft) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '')
    const line = i + 2
    const name = (idx.name >= 0 ? get('name') : [r[first], last >= 0 ? r[last] : ''].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim()
    const email = get('email').toLowerCase()
    const fail = (error: string): MemberRow => ({ line, member: null, error })
    if (!name) return fail('Missing name')
    if (!EMAIL_RE.test(email)) return fail(email ? `“${email}” isn’t a valid email` : 'Missing email')
    const key = normEmail(email)!
    if (seen.has(key)) return fail('Same email as an earlier row')
    seen.add(key)
    const ratingRaw = get('rating').replace(/,/g, '')
    const rating = ratingRaw ? Number(ratingRaw) : null
    if (rating != null && !(rating > 0 && rating <= 100000)) return fail(`Rating “${get('rating')}” isn’t a positive number`)
    const g = gender(get('gender'))
    if (g === undefined) return fail(`Gender “${get('gender')}” should be M or F`)
    const h = hand(get('dominantHand'))
    if (h === undefined) return fail(`Hand “${get('dominantHand')}” should be right, left or ambi`)
    const yearMatch = get('birthYear').match(/(19|20)\d{2}/)
    const birthYear = yearMatch ? Number(yearMatch[0]) : null
    if (get('birthYear') && (!birthYear || !validBirthYear(birthYear))) return fail(`Birth year “${get('birthYear')}” doesn’t look right`)
    const countryRaw = get('country')
    const country = countryRaw ? canonicalCountry(countryRaw) : null
    if (countryRaw && !country) return fail(`“${countryRaw}” isn’t a country we recognise`)
    return {
      line,
      error: null,
      member: { name: name.slice(0, 120), email, rating, gender: g, birthYear, phone: get('phone').slice(0, 40) || null, city: get('city').slice(0, 80) || null, country, dominantHand: h },
    }
  })
  return { rows: out, missing: [] }
}

export const MEMBER_TEMPLATE = 'Name,Email,Rating,Gender,Birth year,Phone,City,Country,Hand\nAlex Morgan,alex@example.com,2400,M,1984,,London,United Kingdom,Right\n'
