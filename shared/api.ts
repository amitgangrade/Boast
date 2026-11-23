import { z } from 'zod'
import { MATCH_TYPES, type Game, type MatchType, type Settings } from './rating'
import { GENDERS, HANDS, type Gender, type Hand } from './util'

export interface Player {
  id: string
  name: string
  username: string | null
  claimed: boolean
  startingLevel: number
  seededRating: boolean
  currentLevel: number
  matchesPlayed: number
  club: string | null
  clubSlug: string | null
  city: string | null
  country: string | null
  avatarUrl: string | null
  birthYear: number | null
  gender: Gender | null
  dominantHand: Hand | null
  createdAt: string
  /** Date of their most recent confirmed match. */
  lastPlayed: string | null
  /** Level 7 days ago, for leaderboard movement; null if they joined since. */
  prevLevel: number | null
  /** Only present when the viewer may see contact details (self, admins). */
  email?: string | null
  phone?: string | null
  notes?: string | null
}

export type MatchStatus = 'pending' | 'confirmed' | 'disputed'

export interface Match {
  id: string
  date: string
  playerAId: string
  playerBId: string
  games: Game[]
  type: MatchType
  venue: string | null
  notes: string | null
  status: MatchStatus
  unranked: boolean
  autoConfirmed: boolean
  confirmedAt: string | null
  disputedAt: string | null
  createdBy: string | null
  createdAt: string
  levelABefore: number | null
  levelBBefore: number | null
  levelAAfter: number | null
  levelBAfter: number | null
  deltaA: number | null
  deltaB: number | null
  provisionalA: boolean | null
  provisionalB: boolean | null
}

export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'

export interface Challenge {
  id: string
  fromPlayerId: string
  toPlayerId: string
  message: string | null
  proposedDate: string | null
  venue: string | null
  status: ChallengeStatus
  createdAt: string
  respondedAt: string | null
}

export interface Me {
  user: { id: string; email: string; isAdmin: boolean }
  player: Player | null
  clubAdminSlugs: string[]
  /** groupId → member player ids, for every group the user administers. */
  groupAdminScope: Record<string, string[]>
  /** True when the configured owner email matches and nobody is admin yet. */
  ownerHint: boolean
  /** Which emails the user's player receives (null before onboarding). */
  notifications: NotificationPrefs | null
}

export interface NotificationPrefs {
  matches: boolean
  challenges: boolean
  reminders: boolean
  digest: boolean
  leagues: boolean
}
export const NotificationPrefsInput = z.object({
  matches: z.boolean(),
  challenges: z.boolean(),
  reminders: z.boolean(),
  digest: z.boolean(),
  leagues: z.boolean(),
})

/** What an unsubscribe link shows: enough to confirm whose emails, nothing more. */
export interface UnsubscribeInfo {
  firstName: string
  prefs: NotificationPrefs
}

export interface BoxRound {
  id: string
  groupId: string
  name: string
  startsOn: string
  endsOn: string
  /** boxes[0] is box 1 (the top box): player ids in that box. */
  boxes: string[][]
  createdAt: string
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
export const BoxRoundInput = z
  .object({
    name: z.string().trim().min(1, 'Name the round').max(80),
    startsOn: isoDay,
    endsOn: isoDay,
    boxes: z.array(z.array(z.string().min(1)).min(2, 'Each box needs at least two players').max(12)).min(1, 'Add at least one box').max(30),
  })
  .refine((r) => r.endsOn >= r.startsOn, 'The round must end after it starts')
export type BoxRoundInput = z.input<typeof BoxRoundInput>

/** Bulk-adds club members as unclaimed players (shared/csv.ts builds these from a spreadsheet). */
export const ImportMembersInput = z.object({
  members: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email looks invalid'),
        rating: z.number().positive().max(100000).nullable(),
        gender: z.enum(GENDERS).nullable(),
        birthYear: z.number().int().nullable(),
        phone: z.string().max(40).nullable(),
        city: z.string().max(80).nullable(),
        country: z.string().max(80).nullable(),
        dominantHand: z.enum(HANDS).nullable(),
      }),
    )
    .min(1, 'Nothing to import')
    .max(500, 'Import at most 500 members at a time'),
})
export type ImportMembersInput = z.input<typeof ImportMembersInput>
export interface ImportMembersResult {
  added: Array<{ id: string; name: string }>
  /** Already on Boast (matched by email): left as they are. */
  existing: Array<{ id: string; name: string; inClub: boolean }>
}

export interface ClubSummary {
  slug: string
  name: string
  city: string | null
  country: string | null
  description: string | null
  members: number
  registered: boolean
}

export interface ClubDetail extends ClubSummary {
  memberIds: string[]
  admins: Array<{ userId: string; name: string }>
}

export interface GroupSummary {
  id: string
  name: string
  slug: string
  description: string | null
  isPrivate: boolean
  memberCount: number
  adminNames: string[]
  viewerIsMember: boolean
  viewerIsAdmin: boolean
  createdAt: string
}

export interface GroupDetail extends GroupSummary {
  members: Array<{ playerId: string; isAdmin: boolean; addedAt: string }>
}

export interface Activity {
  pendingForMe: Match[]
  myPending: Match[]
  incomingChallenges: Challenge[]
  outgoingChallenges: Challenge[]
  pastChallenges: Challenge[]
  adminPending: Match[]
  disputed: Match[]
}

export interface AdminUser {
  id: string
  email: string
  isAdmin: boolean
  createdAt: string
  playerId: string | null
  name: string | null
  club: string | null
}

export interface ClubAdminGrant {
  userId: string
  clubSlug: string
  name: string
  email: string
  grantedAt: string
}

export interface AuditEvent {
  id: number
  at: string
  actorUserId: string | null
  actorLabel: string | null
  entityType: string
  entityId: string | null
  op: 'insert' | 'update' | 'delete'
  summary: string | null
  changed: unknown
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

const optText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null))

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')

export const GameSchema = z.object({
  a: z.number().int().min(0).max(99),
  b: z.number().int().min(0).max(99),
})

const identityFields = {
  phone: optText(40),
  country: z.string().max(80),
  city: z.string().max(80),
  club: optText(120),
  birthYear: z.number().int().nullish().transform((v) => v ?? null),
  gender: z.enum(GENDERS).nullish().transform((v) => v ?? null),
  dominantHand: z.enum(HANDS).nullish().transform((v) => v ?? null),
}

export const RATING_SOURCES = ['official', 'estimate', 'none'] as const

export const OnboardingInput = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(120),
  ...identityFields,
  ratingSource: z.enum(RATING_SOURCES),
  startingLevel: z.number().positive().max(100000).nullish(),
})
export type OnboardingInput = z.input<typeof OnboardingInput>

export const ProfileInput = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(120),
  ...identityFields,
})
export type ProfileInput = z.input<typeof ProfileInput>

export const PlayerCreateInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email looks invalid'),
  ratingKnown: z.boolean(),
  startingLevel: z.number().positive().max(100000).nullish(),
  notes: optText(500),
  ...identityFields,
})
export type PlayerCreateInput = z.input<typeof PlayerCreateInput>

export const PlayerUpdateInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email looks invalid')
    .nullish(),
  startingLevel: z.number().positive().max(100000),
  seededRating: z.boolean(),
  notes: optText(500),
  createdAt: isoDate.nullish(),
  ...identityFields,
})
export type PlayerUpdateInput = z.input<typeof PlayerUpdateInput>

export const MatchInput = z.object({
  playerAId: z.string().min(1),
  playerBId: z.string().min(1),
  date: isoDate,
  type: z.enum(MATCH_TYPES as [MatchType, ...MatchType[]]),
  games: z.array(GameSchema).min(1, 'Enter at least one game score').max(9),
  venue: optText(120),
  notes: optText(500),
  unranked: z.boolean().default(false),
})
export type MatchInput = z.input<typeof MatchInput>

export const MatchUpdateInput = MatchInput.extend({
  status: z.enum(['pending', 'confirmed', 'disputed']).optional(),
})
export type MatchUpdateInput = z.input<typeof MatchUpdateInput>

export const ChallengeInput = z.object({
  toPlayerId: z.string().min(1),
  fromPlayerId: z.string().nullish(),
  message: optText(500),
  proposedDate: isoDate.nullish().transform((v) => v ?? null),
  venue: optText(120),
})
export type ChallengeInput = z.input<typeof ChallengeInput>

export const GroupInput = z.object({
  name: z.string().trim().min(1, 'Group name is required').max(80),
  description: optText(500),
  isPrivate: z.boolean().default(false),
})
export type GroupInput = z.input<typeof GroupInput>

export const ClubInput = z.object({
  name: z.string().trim().min(1, 'Club name is required').max(120),
  city: optText(80),
  country: optText(80),
  description: optText(500),
})
export type ClubInput = z.input<typeof ClubInput>

export const SettingsInput = z.object({
  dampingK: z.number().positive().max(1),
  pointsWeight: z.number().min(0).max(1),
  pointsExponent: z.number().positive().max(20),
  gamesExponent: z.number().positive().max(20),
  provisionalThreshold: z.number().int().min(0).max(100),
  movingAverageWindow: z.number().int().min(1).max(50),
}) satisfies z.ZodType<Settings>
