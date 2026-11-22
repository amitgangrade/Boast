import { Link } from 'react-router-dom'

export function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-4 [&_p]:leading-relaxed [&_li]:leading-relaxed">
      <h1>Privacy policy</h1>
      <p className="text-sm muted">Last updated 22 November 2026</p>
      <p>
        Boast is a free, non-commercial squash rating app run by volunteers for the people who play with us. This page explains what we store and why.
      </p>

      <h2>What we store</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>From your Google account</strong>, when you sign in: your name and email address. We never see your Google password, and we don’t access anything else in your
          Google account.
        </li>
        <li>
          <strong>What you enter in your profile</strong>: name, country, city, and optionally your club, phone number, year of birth, gender, dominant hand and a photo.
        </li>
        <li>
          <strong>Squash activity</strong>: matches you or your opponents record, the levels calculated from them, challenges, and the groups and clubs you belong to.
        </li>
        <li>
          <strong>A record of changes</strong> (who changed what, and when), so admins can fix mistakes and prevent abuse.
        </li>
      </ul>

      <h2>Who can see it</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Everyone</strong>, including people who aren’t signed in: your name, photo, club, city, country, age, level, matches and results. That’s what a leaderboard is.
          Members of private groups are only visible to that group.
        </li>
        <li>
          <strong>Only you and Boast admins</strong>: your email address and phone number.
        </li>
      </ul>

      <h2>What we don’t do</h2>
      <p>We don’t sell or share your data, show ads, or use tracking or analytics tools. The only cookie Boast sets is the one that keeps you signed in.</p>

      <h2>Services we use</h2>
      <p>
        Boast runs on Cloudflare, which stores the data. If match emails are switched on, they are sent through Resend. Sign-in is handled by Google. Each of these only
        processes the data needed to provide its service.
      </p>

      <h2>Your choices</h2>
      <p>
        You can change your profile at any time on the <Link to="/profile" className="link">My profile</Link> page. To have your account or your data removed, ask a Boast admin
        through your club or group, and we’ll delete it.
      </p>

      <p>
        <Link to="/" className="link">
          ← Back to Boast
        </Link>
      </p>
    </article>
  )
}
