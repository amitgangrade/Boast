import { type Context, Hono } from 'hono'
import { authRoutes, purgeLoginTokensStmt, sessionMiddleware } from './auth'
import { type AppEnv, HttpError } from './lib'
import { sendBoxNudges, sendConfirmReminders, sendWeeklyDigest } from './jobs'
import { recomputeLevels } from './levels'
import { ensureSchema } from './migrate'
import { serveWithMeta } from './og'
import { adminRoutes } from './routes/admin'
import { boxRoutes } from './routes/boxes'
import { challengeRoutes } from './routes/challenges'
import { clubRoutes } from './routes/clubs'
import { groupRoutes } from './routes/groups'
import { autoConfirmAged, matchRoutes } from './routes/matches'
import { playerRoutes } from './routes/players'

const api = new Hono<AppEnv>()
api.use('*', sessionMiddleware)
api.route('/auth', authRoutes)
api.route('/', playerRoutes)
api.route('/', matchRoutes)
api.route('/', challengeRoutes)
api.route('/', clubRoutes)
api.route('/', groupRoutes)
api.route('/', boxRoutes)
api.route('/', adminRoutes)
api.get('/health', (c) => c.json({ ok: true }))
api.notFound((c) => c.json({ error: 'Not found' }, 404))

const app = new Hono<AppEnv>()
app.use('*', async (c, next) => {
  await ensureSchema(c.env.DB)
  await next()
})
app.route('/api', api)
app.get('/players/*', (c) => serveWithMeta(c.req.raw, c.env))
app.get('/matches/*', (c) => serveWithMeta(c.req.raw, c.env))

const onError = (err: Error, c: Context<AppEnv>) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Something went wrong on our side. Please try again.' }, 500)
}
api.onError(onError)
app.onError(onError)

export default {
  fetch: app.fetch,
  // Daily: auto-confirm old matches, recompute levels (which also rolls the 7-day
  // rank-movement baseline forward), tidy up, then send the day's emails. Mondays
  // also get the weekly digest. Each step runs even if an earlier email step fails.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        await ensureSchema(env.DB)
        const confirmed = await autoConfirmAged(env)
        await recomputeLevels(env.DB)
        await purgeLoginTokensStmt(env.DB).run()
        const step = (name: string, run: () => Promise<number>) =>
          run().catch((e) => {
            console.error(`${name} failed`, e)
            return 0
          })
        const reminded = await step('reminders', () => sendConfirmReminders(env))
        const nudged = await step('box nudges', () => sendBoxNudges(env))
        const digests = new Date().getUTCDay() === 1 ? await step('digest', () => sendWeeklyDigest(env)) : 0
        console.log(`auto-confirmed ${confirmed}; emailed ${reminded} reminders, ${nudged} box nudges, ${digests} digests`)
      })(),
    )
  },
} satisfies ExportedHandler<Env>
