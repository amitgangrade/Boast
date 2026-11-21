import { Link } from 'react-router-dom'
import { EmptyState } from '../components/ui'

export function NotFoundPage() {
  return (
    <EmptyState title="Page not found" action={<Link to="/" className="btn-secondary btn-sm">Go to the leaderboard</Link>}>
      The link may be old or mistyped.
    </EmptyState>
  )
}
