# Boast

Squash ratings for every player. Log your matches, have your opponent confirm, and watch your level move.

- **Google sign-in** and a one-page onboarding. If someone already logged matches against your Gmail address, you take over that player and its history.
- **Levels** that move after every confirmed match, weighted by match type, with a provisional period for new players. [How levels work](src/pages/About.tsx)
- **Confirm or dispute**: your opponent confirms, or it counts automatically after 3 days. Recording your own loss counts straight away.
- **Leaderboard** with club, city and country filters. **Player pages** with a level chart (compare up to 7 others), head-to-head and full history.
- **Clubs** (formed automatically from players' profiles), **groups** (your own mini-leaderboards), and **challenges**.
- **Admins** at three levels: global, per club, and per group. Every change is in the **audit log**.
- **Backup & import** — including importing an export from the old SquashLevel app.
- Optional **emails** when a match is logged (via Resend), and link previews when you share a player or match.

## How it's hosted (and why it won't go to sleep)

Everything runs on **Cloudflare's free plan**, as a single Worker:

| Piece | Cloudflare product | Free allowance (check Cloudflare’s pricing pages for current numbers) |
| --- | --- | --- |
| Web app + API | Workers (static assets + `/api`) | 100,000 requests/day; static files are free and unlimited |
| Database + profile photos | D1 (SQLite) | 5 GB storage, 5 M rows read/day, 100 k rows written/day |
| 3-day auto-confirm | Cron Trigger (daily at 03:17 UTC) | included |

Unlike Supabase's free plan, **nothing pauses or gets deleted when the app is idle**, and no credit card is needed. A small club uses a tiny fraction of these limits.

Deploys are automatic: every push to `main` builds and deploys, and pull requests get their own preview URL. Previews use a separate `boast-preview` D1 database (the `previews` block in `wrangler.jsonc`), so they never touch live data; they don't get production secrets, so Google sign-in only works there if you add the secrets for previews in the dashboard. The database schema updates itself on first request after a deploy (see `worker/migrate.ts`), so there is no separate migration step.

## Set it up (one time, about 20 minutes)

### 1. Create a Google sign-in client

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). You can reuse the project you used for SquashLevel.
2. **Create credentials → OAuth client ID → Web application** (or open your existing one).
3. Under **Authorized redirect URIs** add `https://boast.<your-subdomain>.workers.dev/api/auth/callback`. You'll know the exact address after step 2 below; come back and add it then.
4. Keep the **Client ID** and **Client secret** handy.
5. On the **OAuth consent screen**, make sure the app is **In production** (not "Testing"), otherwise only listed test users can sign in.

### 2. Connect the repository to Cloudflare

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. **Workers & Pages → Create → Import a repository**, connect GitHub and pick this repository.
3. Settings: project name **boast**, build command `npm run build`, deploy command `npx wrangler deploy`. Save and deploy.
4. The first deploy creates the database automatically. Your app is now live at `https://boast.<your-subdomain>.workers.dev`.

### 3. Add the secrets

In the Worker: **Settings → Variables and Secrets → Add**, type **Secret**:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | from step 1 |
| `GOOGLE_CLIENT_SECRET` | from step 1 |
| `OWNER_EMAIL` | your Gmail address — you become admin the first time you sign in |
| `RESEND_API_KEY` | optional, for match emails ([resend.com](https://resend.com), free tier) |

To send emails from your own domain, also change `EMAIL_FROM` in `wrangler.jsonc`.

### 4. Bring over your SquashLevel data

1. In the **old** app, sign in as admin → **Settings → Backup & restore → Export JSON**. Do this while the old Supabase project is still running, so profile photos can be copied too.
2. In **Boast**, sign in with your owner email → **Admin → Backup & import** → choose the file → type `REPLACE` → confirm.
3. Boast imports everything, recalculates every level, and copies the photos. If the export includes your old account, you're switched to it straight away.

People sign in with the same Google account they used before and land on their existing player.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Open http://localhost:5173. Google sign-in needs real credentials, so locally you can sign in as anyone with `http://localhost:5173/api/auth/dev?email=you@gmail.com` (this only works on localhost with `DEV_LOGIN=1`).

```bash
npm test          # rating engine and helpers
npm run build     # type-check + production build
```

To wipe your local database: `npx wrangler d1 execute DB --local --file scripts/reset-local.sql`.

## Project layout

| Path | What's there |
| --- | --- |
| `shared/rating.ts` | The rating engine — the only implementation, used by the server and the Log Match preview |
| `shared/api.ts` | API types and request validation, shared by both sides |
| `worker/` | The Cloudflare Worker: auth, permissions, routes, level recompute, cron, emails, link previews |
| `migrations/` | Database schema. Add `0002_….sql` and list it in `worker/migrate.ts` |
| `src/` | The React app (pages, components, API hooks) |

See [AGENTS.md](AGENTS.md) for the rules of the codebase.
