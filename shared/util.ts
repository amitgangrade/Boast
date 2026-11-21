import { canonicalCountry } from './countries'

/** URL-safe identifier for clubs and groups: "Westside SRC & Co" → "westside-src-co". */
export function slugify(name: string | null | undefined): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Two addresses are the same mailbox iff their normalisations match. Gmail
 * ignores dots and "+tags" in the local part, and googlemail.com is an alias.
 */
export function normEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at <= 0 || at === e.length - 1) return null
  let local = e.slice(0, at)
  let domain = e.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '')
  return local ? `${local}@${domain}` : null
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** New placeholder players must be claimable later, and sign-in is Google-only. */
export function isGoogleMail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1]
  return domain === 'gmail.com' || domain === 'googlemail.com'
}

export const GENDERS = ['male', 'female'] as const
export type Gender = (typeof GENDERS)[number]
export const GENDER_LABEL: Record<Gender, string> = { male: 'Male', female: 'Female' }

export const HANDS = ['right', 'left', 'ambi'] as const
export type Hand = (typeof HANDS)[number]
export const HAND_LABEL: Record<Hand, string> = { right: 'Right', left: 'Left', ambi: 'Ambidextrous' }

const CITY_RE = /^[\p{L}][\p{L}\p{M} .'’()-]{0,79}$/u

export interface LocationFields {
  country: string
  city: string
}

/** Validates and canonicalises country + city. Returns an error message or the cleaned values. */
export function parseLocation(input: { country?: string | null; city?: string | null }):
  | { ok: true; value: LocationFields }
  | { ok: false; error: string } {
  const countryRaw = (input.country ?? '').trim()
  const city = (input.city ?? '').trim().replace(/\s+/g, ' ')
  if (!countryRaw) return { ok: false, error: 'Country is required' }
  const country = canonicalCountry(countryRaw)
  if (!country) return { ok: false, error: `"${countryRaw}" isn't a country we recognise — pick one from the list` }
  if (!city) return { ok: false, error: 'City is required' }
  if (!CITY_RE.test(city)) return { ok: false, error: 'City should only contain letters, spaces, hyphens and apostrophes' }
  return { ok: true, value: { country, city } }
}

export function validBirthYear(y: number): boolean {
  return Number.isInteger(y) && y >= 1900 && y <= new Date().getFullYear()
}

export function fmtLevel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

export function fmtDelta(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return ''
  const r = Math.round(n)
  if (r === 0) return n === 0 ? '±0' : n > 0 ? '+<1' : '−<1'
  return r > 0 ? `+${r.toLocaleString('en-US')}` : `−${Math.abs(r).toLocaleString('en-US')}`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function ageFromBirthYear(y: number | null | undefined): number | null {
  return y ? new Date().getFullYear() - y : null
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0]
  const last = parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? ''
  return (first + last).toUpperCase()
}
