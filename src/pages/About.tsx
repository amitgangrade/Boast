import { Link } from 'react-router-dom'
import { DEFAULT_SETTINGS, MATCH_TYPE_LABEL, MATCH_TYPE_WEIGHT, MATCH_TYPES } from '../../shared/rating'
import { useSettings } from '../api'

export function AboutPage() {
  const { data } = useSettings()
  const s = data ?? DEFAULT_SETTINGS
  return (
    <article className="mx-auto max-w-2xl space-y-5 [&_p]:leading-relaxed">
      <h1>How levels work</h1>
      <p>
        Your <strong>level</strong> is a number that says how well you play. Twice the level means roughly twice as good: a 2,000 player should beat a 1,000 player most of the time, and win most of
        the points too. New players start at 1,000 unless they already have a rating.
      </p>
      <h2>After every match</h2>
      <p>
        Before the match, Boast works out how each player is <em>expected</em> to do from the gap between your levels. After it, it compares that with what <em>actually</em> happened — counting both
        the games you won and the points you scored, so a close 3–2 loss to a much stronger player can still move you up.
      </p>
      <p>
        If you did better than expected you go up and your opponent goes down by the same proportion; if worse, the reverse. Each match moves levels by at most about {Math.round(s.dampingK * 100)}% —
        more for bigger occasions:
      </p>
      <ul className="card grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {MATCH_TYPES.map((t) => (
          <li key={t}>
            <div className="font-semibold">{MATCH_TYPE_LABEL[t]}</div>
            <div className="muted">×{MATCH_TYPE_WEIGHT[t]}</div>
          </li>
        ))}
      </ul>
      <h2>New players are provisional</h2>
      <p>
        Someone without a known rating is <strong>provisional</strong> for their first {s.provisionalThreshold} rated matches. Their level moves to where it belongs, while an established opponent’s level
        doesn’t move at all against them — so a mis-rated newcomer can’t drag anyone else around. Players who join with a SquashLevels / LevelTech rating or a coach’s estimate skip this.
      </p>
      <h2>Confirming results</h2>
      <p>
        When you log a match, your opponent confirms it (or disputes it). If they don’t respond within 3 days it counts automatically. A match counts straight away if you recorded your own loss, or if an
        admin recorded it. Disputed matches don’t count until an admin sorts them out.
      </p>
      <h2>Always recalculated in order</h2>
      <p>
        Levels are replayed from everyone’s starting level through every confirmed match in date order. So if a match is logged late, edited or deleted, every level after it is recalculated straight
        away — nothing goes stale.
      </p>
      <p>
        <Link to="/" className="link">
          ← Back to the leaderboard
        </Link>
      </p>
    </article>
  )
}
