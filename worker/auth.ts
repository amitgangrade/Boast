import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { EMAIL_RE, normEmail } from '../shared/util'
import { type AppEnv, type Ctx, HttpError, nowIso, uuid } from './lib'
import { loadViewer } from './perms'

const SESSION_COOKIE = 'boast_session'
const OAUTH_COOKIE = 'boast_oauth'
const SESSION_DAYS = 90
const DAY_MS = 86_400_000

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return b64url(new Uint8Array(digest))
}

const isLocal = (c: Ctx) => ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname)

/** Attaches the signed-in viewer (or null) to every API request. */
export async function sessionMiddleware(c: Ctx, next: () => Promise<void>) {
  c.set('viewer', null)
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const id = await sha256(token)
    const session = await c.env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
      .bind(id)
      .first<{ user_id: string; expires_at: string }>()
    if (session && session.expires_at > nowIso()) {
      c.set('viewer', await loadViewer(c.env.DB, session.user_id))
      // Sliding expiry, written at most about once a month.
      if (Date.parse(session.expires_at) - Date.now() < (SESSION_DAYS - 30) * DAY_MS) {
        const expires = new Date(Date.now() + SESSION_DAYS * DAY_MS)
        await c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(expires.toISOString(), id).run()
        setSessionCookie(c, token, expires)
      }
    } else if (session) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run()
    }
  }
  // State-changing requests must come from our own pages: a cross-site form
  // can't set this header, and SameSite=Lax keeps the cookie off cross-site POSTs.
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-boast') !== '1') {
    throw new HttpError(403, 'Missing request header')
  }
  await next()
}

function setSessionCookie(c: Ctx, token: string, expires: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: !isLocal(c),
    sameSite: 'Lax',
    path: '/',
    expires,
  })
}

async function startSession(c: Ctx, userId: string) {
  const token = randomToken()
  const expires = new Date(Date.now() + SESSION_DAYS * DAY_MS)
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, expires.toISOString())
    .run()
  setSessionCookie(c, token, expires)
}

function safeReturn(path: string | undefined | null): string {
  return path && path.startsWith('/') && !path.startsWith('//') ? path : '/'
}

/**
 * Finds the user for a Google identity: by Google id first, then by email for
 * accounts that were imported or created before they ever signed in.
 */
async function upsertGoogleUser(env: Env, info: { sub: string; email: string; name: string | null }): Promise<string> {
  const db = env.DB
  const bySub = await db.prepare('SELECT id FROM users WHERE google_sub = ?').bind(info.sub).first<{ id: string }>()
  const emailNorm = normEmail(info.email)!
  if (bySub) {
    await db.prepare('UPDATE users SET email = ?, email_norm = ?, google_name = ? WHERE id = ?')
      .bind(info.email, emailNorm, info.name, bySub.id)
      .run()
    return bySub.id
  }
  const byEmail = await db
    .prepare('SELECT id FROM users WHERE email_norm = ? AND google_sub IS NULL ORDER BY created_at LIMIT 1')
    .bind(emailNorm)
    .first<{ id: string }>()
  if (byEmail) {
    await db.prepare('UPDATE users SET google_sub = ?, email = ?, google_name = ? WHERE id = ?')
      .bind(info.sub, info.email, info.name, byEmail.id)
      .run()
    return byEmail.id
  }
  const id = uuid()
  const owner = normEmail(env.OWNER_EMAIL)
  await db.prepare(
    'INSERT INTO users (id, email, email_norm, google_sub, google_name, is_admin) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, info.email, emailNorm, info.sub, info.name, owner && owner === emailNorm ? 1 : 0)
    .run()
  return id
}

export const authRoutes = new Hono<AppEnv>()

authRoutes.get('/google', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) throw new HttpError(500, 'Google sign-in is not configured (GOOGLE_CLIENT_ID)')
  const state = randomToken(16)
  const verifier = randomToken(48)
  const challenge = await sha256(verifier)
  const origin = new URL(c.req.url).origin
  setCookie(c, OAUTH_COOKIE, `${state}.${verifier}.${encodeURIComponent(safeReturn(c.req.query('return')))}`, {
    httpOnly: true,
    secure: !isLocal(c),
    sameSite: 'Lax',
    path: '/api/auth',
    maxAge: 600,
  })
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

authRoutes.get('/callback', async (c) => {
  const [state, verifier, ret] = (getCookie(c, OAUTH_COOKIE) ?? '').split('.')
  deleteCookie(c, OAUTH_COOKIE, { path: '/api/auth' })
  const code = c.req.query('code')
  if (!code || !state || state !== c.req.query('state')) {
    return c.redirect('/?signin=failed')
  }
  const origin = new URL(c.req.url).origin
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/api/auth/callback`,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  })
  if (!res.ok) {
    console.error('google token exchange failed', res.status, await res.text())
    return c.redirect('/?signin=failed')
  }
  const { id_token } = (await res.json()) as { id_token?: string }
  // The token came straight from Google over TLS in exchange for our code, so
  // its claims can be read without verifying the signature (OIDC §3.1.3.7).
  const claims = JSON.parse(atob((id_token ?? '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
    sub: string
    email?: string
    email_verified?: boolean
    name?: string
    aud: string
  }
  if (claims.aud !== c.env.GOOGLE_CLIENT_ID || !claims.email || !claims.email_verified) {
    return c.redirect('/?signin=failed')
  }
  const userId = await upsertGoogleUser(c.env, { sub: claims.sub, email: claims.email, name: claims.name ?? null })
  await startSession(c, userId)
  return c.redirect(safeReturn(decodeURIComponent(ret ?? '')))
})

/** Local-only sign-in for development and automated tests. */
authRoutes.get('/dev', async (c) => {
  if (c.env.DEV_LOGIN !== '1' || !isLocal(c)) throw new HttpError(404, 'Not found')
  const email = c.req.query('email')?.trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) throw new HttpError(400, 'valid email required')
  const userId = await upsertGoogleUser(c.env, {
    sub: `dev:${normEmail(email)}`,
    email,
    name: c.req.query('name') ?? null,
  })
  await startSession(c, userId)
  return c.redirect(safeReturn(c.req.query('return')))
})

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})
