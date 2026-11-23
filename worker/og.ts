import { gamesWon } from '../shared/rating'
import { fmtDate, fmtDelta, fmtLevel } from '../shared/util'
import type { MatchRow, PlayerRow } from './lib'

interface Meta {
  title: string
  description: string
}

async function metaFor(db: D1Database, path: string): Promise<Meta | null> {
  const [, kind, key] = path.split('/')
  if (kind === 'players' && key) {
    const p = await db
      .prepare('SELECT * FROM players WHERE id = ?1 OR username = ?1')
      .bind(decodeURIComponent(key))
      .first<PlayerRow>()
    if (!p) return null
    const where = [p.club, p.city, p.country].filter(Boolean).join(' · ')
    return {
      title: `${p.name} on Boast`,
      description: `Level ${fmtLevel(p.current_level ?? p.starting_level)} · ${p.matches_played} ${p.matches_played === 1 ? 'match' : 'matches'}${where ? ` · ${where}` : ''}`,
    }
  }
  if (kind === 'matches' && key) {
    const m = await db.prepare('SELECT * FROM matches WHERE id = ?').bind(key).first<MatchRow>()
    if (!m) return null
    const names = await db
      .prepare('SELECT id, name FROM players WHERE id IN (?, ?)')
      .bind(m.player_a_id, m.player_b_id)
      .all<{ id: string; name: string }>()
    const name = (id: string) => names.results.find((r) => r.id === id)?.name ?? 'Unknown'
    const games = JSON.parse(m.games) as Array<{ a: number; b: number }>
    const moved =
      m.status === 'confirmed' && m.delta_a != null && m.delta_b != null && !m.unranked
        ? ` · levels ${name(m.player_a_id).split(' ')[0]} ${fmtDelta(m.delta_a)}, ${name(m.player_b_id).split(' ')[0]} ${fmtDelta(m.delta_b)}`
        : ''
    return {
      title: `${name(m.player_a_id)} ${gamesWon(games, 'a')}–${gamesWon(games, 'b')} ${name(m.player_b_id)}`,
      description: `${games.map((g) => `${g.a}–${g.b}`).join(', ')} · ${fmtDate(m.date)}${moved} · Boast squash ratings`,
    }
  }
  return null
}

/**
 * Serves the app shell for shareable player/match URLs with link-preview
 * tags filled in, so chat apps and social sites show who/what it is.
 */
export async function serveWithMeta(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url)
  const shell = await env.ASSETS.fetch(new Request(new URL('/', url), req))
  const meta = await metaFor(env.DB, url.pathname).catch(() => null)
  if (!meta) return shell
  const image = new URL('/og.png', url).toString()
  const tags = [
    ['og:title', meta.title],
    ['og:description', meta.description],
    ['og:image', image],
    ['og:url', url.toString()],
    ['og:type', 'website'],
    ['twitter:card', 'summary_large_image'],
  ]
  const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(meta.title)
      },
    })
    .on('head', {
      element(el) {
        el.append(
          `<meta name="description" content="${attr(meta.description)}">` +
            tags.map(([k, v]) => `<meta property="${k}" content="${attr(v)}">`).join(''),
          { html: true },
        )
      },
    })
    .transform(shell)
}
