import { useId } from 'react'
import { COUNTRIES } from '../../shared/countries'
import { GENDER_LABEL, GENDERS, HAND_LABEL, HANDS, parseLocation, validBirthYear, type Gender, type Hand } from '../../shared/util'
import { useClubs } from '../api'
import { Field } from './ui'

export interface IdentityDraft {
  name: string
  phone: string
  country: string
  city: string
  club: string
  birthYear: string
  gender: Gender | ''
  dominantHand: Hand | ''
}

export const emptyIdentity: IdentityDraft = { name: '', phone: '', country: '', city: '', club: '', birthYear: '', gender: '', dominantHand: '' }

export function identityFrom(p: { name?: string; phone?: string | null; country?: string | null; city?: string | null; club?: string | null; birthYear?: number | null; gender?: Gender | null; dominantHand?: Hand | null }): IdentityDraft {
  return {
    name: p.name ?? '',
    phone: p.phone ?? '',
    country: p.country ?? '',
    city: p.city ?? '',
    club: p.club ?? '',
    birthYear: p.birthYear ? String(p.birthYear) : '',
    gender: p.gender ?? '',
    dominantHand: p.dominantHand ?? '',
  }
}

/** Client-side check mirroring the server, so errors show before submitting. */
export function validateIdentity(d: IdentityDraft, nameLabel = 'Name'): string | null {
  if (!d.name.trim()) return `${nameLabel} is required`
  const loc = parseLocation(d)
  if (!loc.ok) return loc.error
  if (d.birthYear && !validBirthYear(Number(d.birthYear))) return 'Year of birth looks wrong'
  return null
}

export function identityPayload(d: IdentityDraft) {
  return {
    phone: d.phone.trim() || null,
    country: d.country.trim(),
    city: d.city.trim(),
    club: d.club.trim() || null,
    birthYear: d.birthYear ? Number(d.birthYear) : null,
    gender: d.gender || null,
    dominantHand: d.dominantHand || null,
  }
}

export function IdentityFields({ value, onChange, nameLabel = 'Full name', showName = true }: { value: IdentityDraft; onChange: (v: IdentityDraft) => void; nameLabel?: string; showName?: boolean }) {
  const { data: clubs } = useClubs()
  const countriesId = useId()
  const clubsId = useId()
  const set = <K extends keyof IdentityDraft>(k: K, v: IdentityDraft[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {showName && (
        <div className="sm:col-span-2">
          <Field label={nameLabel}>
            <input className="input" value={value.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" />
          </Field>
        </div>
      )}
      <Field label="Country">
        <input className="input" list={countriesId} value={value.country} onChange={(e) => set('country', e.target.value)} placeholder="Singapore" autoComplete="country-name" />
        <datalist id={countriesId}>
          {COUNTRIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="City">
        <input className="input" value={value.city} onChange={(e) => set('city', e.target.value)} placeholder="Singapore" autoComplete="address-level2" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Club" optional hint="Pick from the list if your club is already there, so everyone lands in the same club.">
          <input className="input" list={clubsId} value={value.club} onChange={(e) => set('club', e.target.value)} placeholder="Your home club" />
          <datalist id={clubsId}>
            {(clubs ?? []).map((c) => (
              <option key={c.slug} value={c.name} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label="Phone" optional>
        <input className="input" type="tel" value={value.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+65 9123 4567" autoComplete="tel" />
      </Field>
      <Field label="Year of birth" optional>
        <input className="input" inputMode="numeric" value={value.birthYear} onChange={(e) => set('birthYear', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1985" />
      </Field>
      <Field label="Gender" optional>
        <select className="input" value={value.gender} onChange={(e) => set('gender', e.target.value as Gender | '')}>
          <option value="">Prefer not to say</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {GENDER_LABEL[g]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Dominant hand" optional>
        <select className="input" value={value.dominantHand} onChange={(e) => set('dominantHand', e.target.value as Hand | '')}>
          <option value="">Prefer not to say</option>
          {HANDS.map((h) => (
            <option key={h} value={h}>
              {HAND_LABEL[h]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  )
}
