# AGENTS.md

Rules for anyone (human or AI) changing Boast. Read [README.md](README.md) first.

## Mental model

One Cloudflare Worker serves the React app (`src/`) and a JSON API (`worker/`, mounted at `/api`). D1 is the only datastore (including profile photos). All permission checks happen in the Worker; the client mirrors them only to hide buttons (`src/viewer.ts`).

## Invariants

- **Levels are derived, never edited.** `players.current_level`, `players.matches_played`, `players.last_played`, `players.prev_level` (level 7 days ago, for leaderboard movement) and the `matches.level_*`, `delta_*`, `provisional_*` columns are written only by `recomputeLevels` (`worker/levels.ts`), which replays confirmed matches through `shared/rating.ts`. Call it after anything that can change ratings: confirming, disputing, editing or deleting a match, changing a starting level, the seeded flag or join date, deleting a player, changing settings, importing. For a single match change pass `{ from: <the match's earliest (date, created_at, id) key>, players: [its two players] }` so only the tail of the history is replayed; everything else (and the daily cron) uses the full replay. `test/worker/levels.test.ts` checks the two always agree — keep it passing.
- **One rating implementation.** Change the maths in `shared/rating.ts` only, and keep `test/rating.test.ts` passing.
- **Match order** is `(date, created_at, id)`.
- **Provisional** = fewer than `provisionalThreshold` rated matches **and** not `seeded_rating`. Use `isProvisional`.
- **Email is identity.** A user claims the unclaimed player whose `email_norm` matches theirs (Gmail dots/plus-tags ignored, see `normEmail`). Sign-in is Google or a one-time emailed link (`/api/auth/email`), so placeholder players can have any address; both sign-in routes resolve to the same user by `email_norm`.
- **Match permissions** (`canWriteMatch`): global admin, club admin of either player's club, or admin of a group containing both players. Participants can't edit matches; they confirm or dispute. The recorder can't confirm their own match.
- **Only global admins delete players.** Soft delete removes the account and keeps the player unclaimed; hard delete removes the player and their matches.
- **Every write is audited** in the same `db.batch` as the write (`auditStmt`). Settings, admin and club-admin changes are `privileged` (hidden from club/group admins).
- **Contact details** (`email`, `phone`, `notes`) are only returned to the player themself, global admins and their club admins.
- **Mutating requests** must send the `x-boast: 1` header (CSRF guard). `src/api.ts` does this. The only exception is `POST /api/unsubscribe/one-click`, which mail providers call; its secret `email_token` is the guard.
- **Emails** about a player's activity go through `personalEmail` (`worker/email.ts`), which respects their `notify_*` preference and adds the unsubscribe link; send them with `deliver` (batches of 100 for bulk). Bulk and scheduled emails live in `worker/jobs.ts` and must load data in a handful of queries (Workers caps queries and subrequests per run). The daily cron auto-confirms, recomputes levels, then sends reminders and box-league nudges; Mondays add the weekly digest.
- **Cached directory:** `/players` and `/clubs` are cached per isolate and revalidated with one read of `data_versions.directory`, which triggers bump on any change to `players` or `clubs`. Don't write to those tables in a way that bypasses SQL (there isn't one), and don't mutate cached objects.
- **Box leagues** (`box_rounds`, `box_entries`) only store who is in which box; results are derived from confirmed `box` matches between box-mates inside the round's dates (`shared/box.ts`). Group admins manage rounds.
- **Activity:** a player is active if they played a confirmed match, or joined, within `ACTIVE_DAYS` (`shared/stats.ts`). The leaderboard hides inactive players by default.

## Database changes

Add a new numbered file in `migrations/` (never edit one that has shipped) and add it to the list in `worker/migrate.ts`. It runs automatically on the next request after deploy. Update the row types in `worker/lib.ts`, the API types in `shared/api.ts`, and the import/export column lists in `worker/routes/admin.ts`.

Keep queries per request low (the free plan caps them). For bulk writes, send one JSON parameter and use `json_each`, as `recomputeLevels` does.

## UI

Tailwind v4. Shared styles (`btn-*`, `input`, `card`, `label`, `hint`, `tag`, `muted`, `link`) are `@utility` blocks in `src/styles.css`. Reuse the components in `src/components/` (`MatchCard`, `PlayerSearch`, `LeaderboardTable`, `IdentityFields`, `ui.tsx`) instead of re-creating them.

- **Colours:** only `--black`, `--white`, `--yellow` and `--navy` (in `:root` in `src/styles.css`). Every Tailwind colour the app uses (`ink`, `ball`, `slate`, `amber`, `emerald`, `red`, …) is remapped to mixes of those four, so don't add raw hex values or new palette names.
- **Confirmations and messages:** use `askConfirm` and `toast` from `src/components/feedback.tsx`, never `window.confirm`/`alert`. Offer Undo in the toast for reversible removals.
- **Filters and pagination** live in the URL (`useSearchParams`, `replace: true`), so Back, refresh and shared links keep them.
- **Theme:** dark mode is `data-theme="dark"` on `<html>` (the `dark:` variant follows it), set by `src/theme.ts` and the inline script in `index.html`. Don't use `prefers-color-scheme` media queries directly.
- **Dialogs** use `Modal` (rendered in a portal). Don't leave a `transform` on page wrappers: animations use `animation-fill-mode: backwards`.
- **Buttons that run an action** use `ActionButton` with the mutation's `status` (spinner and disabled while pending, checkmark on success).
- **Loading states** use `<Loading variant=… />` / `Skeleton`, shaped like the content (`rows`, `matches`, `tiles`, `player`, `page`).
- **Motion:** short (0.2–0.6s), from the keyframes in `styles.css`; `src/reveal.ts` fades in cards as they scroll into view. Everything honours `prefers-reduced-motion`.
- **Charts:** colours come from the `--series-N` tokens; slots 5–8 reuse slots 1–4's colours and are drawn dashed (`seriesDash`, `SeriesSwatch`). Keep a compared player's slot stable while they're on the chart.

## Checks

```bash
npm test
npm run build
```

Tests that import Worker code go in `test/worker/` (type-checked by `tsconfig.workertest.json`); `test/worker/d1.ts` runs the real migrations on `node:sqlite` as a stand-in for D1. There are no UI tests; walk the flow you changed with `npm run dev` and the local dev sign-in (`/api/auth/dev?email=…`).
