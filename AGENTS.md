# AGENTS.md

Rules for anyone (human or AI) changing Boast. Read [README.md](README.md) first.

## Mental model

One Cloudflare Worker serves the React app (`src/`) and a JSON API (`worker/`, mounted at `/api`). D1 is the only datastore (including profile photos). All permission checks happen in the Worker; the client mirrors them only to hide buttons (`src/viewer.ts`).

## Invariants

- **Levels are derived, never edited.** `players.current_level`, `players.matches_played` and the `matches.level_*`, `delta_*`, `provisional_*` columns are written only by `recomputeLevels` (`worker/levels.ts`), which replays every confirmed match through `shared/rating.ts`. Call it after anything that can change ratings: confirming, disputing, editing or deleting a match, changing a starting level, the seeded flag or join date, deleting a player, changing settings, importing.
- **One rating implementation.** Change the maths in `shared/rating.ts` only, and keep `test/rating.test.ts` passing.
- **Match order** is `(date, created_at, id)`.
- **Provisional** = fewer than `provisionalThreshold` rated matches **and** not `seeded_rating`. Use `isProvisional`.
- **Email is identity.** A user claims the unclaimed player whose `email_norm` matches theirs (Gmail dots/plus-tags ignored, see `normEmail`). New placeholder players must have a Gmail address, because sign-in is Google-only.
- **Match permissions** (`canWriteMatch`): global admin, club admin of either player's club, or admin of a group containing both players. Participants can't edit matches; they confirm or dispute. The recorder can't confirm their own match.
- **Only global admins delete players.** Soft delete removes the account and keeps the player unclaimed; hard delete removes the player and their matches.
- **Every write is audited** in the same `db.batch` as the write (`auditStmt`). Settings, admin and club-admin changes are `privileged` (hidden from club/group admins).
- **Contact details** (`email`, `phone`, `notes`) are only returned to the player themself, global admins and their club admins.
- **Mutating requests** must send the `x-boast: 1` header (CSRF guard). `src/api.ts` does this.

## Database changes

Add a new numbered file in `migrations/` (never edit one that has shipped) and add it to the list in `worker/migrate.ts`. It runs automatically on the next request after deploy. Update the row types in `worker/lib.ts`, the API types in `shared/api.ts`, and the import/export column lists in `worker/routes/admin.ts`.

Keep queries per request low (the free plan caps them). For bulk writes, send one JSON parameter and use `json_each`, as `recomputeLevels` does.

## UI

Tailwind v4. Shared styles (`btn-*`, `input`, `card`, `label`, `hint`, `tag`, `muted`, `link`) are `@utility` blocks in `src/styles.css`. Reuse the components in `src/components/` (`MatchCard`, `PlayerSearch`, `LeaderboardTable`, `IdentityFields`, `ui.tsx`) instead of re-creating them.

- **Colours:** only `--black`, `--white`, `--yellow` and `--navy` (in `:root` in `src/styles.css`). Every Tailwind colour the app uses (`ink`, `ball`, `slate`, `amber`, `emerald`, `red`, …) is remapped to mixes of those four, so don't add raw hex values or new palette names.
- **Buttons that run an action** use `ActionButton` with the mutation's `status` (spinner and disabled while pending, checkmark on success).
- **Loading states** use `<Loading variant=… />` / `Skeleton`, shaped like the content (`rows`, `matches`, `tiles`, `player`, `page`).
- **Motion:** short (0.2–0.6s), from the keyframes in `styles.css`; `src/reveal.ts` fades in cards as they scroll into view. Everything honours `prefers-reduced-motion`.
- **Charts:** colours come from the `--series-N` tokens; slots 5–8 reuse slots 1–4's colours and are drawn dashed (`seriesDash`, `SeriesSwatch`). Keep a compared player's slot stable while they're on the chart.

## Checks

```bash
npm test
npm run build
```

There are no UI tests; walk the flow you changed with `npm run dev` and the local dev sign-in (`/api/auth/dev?email=…`).
