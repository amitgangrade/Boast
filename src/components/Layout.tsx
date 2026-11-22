import clsx from 'clsx'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { signIn, signOut, useActivity } from '../api'
import { useViewer } from '../viewer'
import { Onboarding } from './Onboarding'
import { Avatar, Loading, playerHref } from './ui'

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="Boast home">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-ink-800 dark:fill-ink-700" />
        <circle cx="16" cy="16" r="7" className="fill-ball-400" />
        <circle cx="14.6" cy="14.6" r="2" fill="#0b0f1c" opacity=".85" />
        <circle cx="18" cy="17.8" r="2" fill="#0b0f1c" opacity=".85" />
      </svg>
      <span className="text-lg font-extrabold tracking-tight">Boast</span>
    </Link>
  )
}

function Badge({ n }: { n: number }) {
  if (!n) return null
  return <span className="ml-1 inline-grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[11px] font-bold text-white">{n > 99 ? '99+' : n}</span>
}

function useActionCount() {
  const { signedIn, myPlayer } = useViewer()
  const { data } = useActivity(signedIn && !!myPlayer)
  return data ? data.pendingForMe.length + data.incomingChallenges.length : 0
}

function DesktopLink({ to, children, end }: { to: string; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx('rounded-md px-3 py-2 text-sm font-medium', isActive ? 'bg-white/10 text-white' : 'text-ink-200 hover:bg-white/5 hover:text-white')
      }
    >
      {children}
    </NavLink>
  )
}

function Menu({ label, button, children }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-ink-100 hover:bg-white/10">
        {button}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-lg bg-white py-1 text-slate-800 shadow-lg ring-1 ring-black/5 dark:bg-ink-900 dark:text-slate-100 dark:ring-ink-700">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

const menuItem = 'block w-full px-4 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-ink-800'

function MobileTab({ to, label, icon, badge, end }: { to: string; label: string; icon: ReactNode; badge?: number; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => clsx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-ink-900 dark:text-ball-300' : 'text-slate-500')}>
      <span className="relative">
        {icon}
        {!!badge && <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{badge}</span>}
      </span>
      {label}
    </NavLink>
  )
}

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)
const ICONS = {
  trophy: icon('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3'),
  inbox: icon('M4 13h4l2 3h4l2-3h4M5 5h14l1 8v6H4v-6l1-8Z'),
  history: icon('M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2'),
  more: icon('M4 6h16M4 12h16M4 18h16'),
  plus: icon('M12 5v14M5 12h14'),
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const v = useViewer()
  const item = 'block rounded-lg px-4 py-3 text-base font-medium hover:bg-slate-100 dark:hover:bg-ink-800'
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:hidden" onClick={onClose}>
      <nav className="w-full rounded-t-2xl bg-white p-3 pb-[max(1rem,env(safe-area-inset-bottom))] dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <Link to="/clubs" className={item} onClick={onClose}>Clubs</Link>
        <Link to="/groups" className={item} onClick={onClose}>Groups</Link>
        {v.myPlayer && <Link to={playerHref(v.myPlayer)} className={item} onClick={onClose}>My player page</Link>}
        {v.myPlayer && <Link to="/profile" className={item} onClick={onClose}>Edit my profile</Link>}
        {v.hasAdminScope && <Link to="/audit" className={item} onClick={onClose}>Audit log</Link>}
        {v.isAdmin && <Link to="/admin" className={item} onClick={onClose}>Admin</Link>}
        <Link to="/about" className={item} onClick={onClose}>How levels work</Link>
        {v.signedIn ? (
          <button className={clsx(item, 'w-full text-left text-red-600')} onClick={() => signOut()}>Sign out</button>
        ) : (
          <button className={clsx(item, 'w-full text-left')} onClick={() => signIn()}>Sign in with Google</button>
        )}
      </nav>
    </div>
  )
}

export function Layout() {
  const v = useViewer()
  const actions = useActionCount()
  const [more, setMore] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="min-h-dvh pb-24 sm:pb-10">
      <header className="sticky top-0 z-30 bg-ink-900 text-white shadow dark:bg-ink-950 dark:ring-1 dark:ring-ink-800">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <div className="text-white">
            <Logo />
          </div>
          <nav className="ml-4 hidden items-center gap-1 sm:flex">
            <DesktopLink to="/" end>Leaderboard</DesktopLink>
            <DesktopLink to="/clubs">Clubs</DesktopLink>
            <DesktopLink to="/groups">Groups</DesktopLink>
            <DesktopLink to="/history">History</DesktopLink>
            {v.signedIn && (
              <DesktopLink to="/activity">
                Activity
                <Badge n={actions} />
              </DesktopLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {v.signedIn && (
              <Link to="/log" className="btn-accent btn-sm hidden sm:inline-flex">
                + Log match
              </Link>
            )}
            {v.hasAdminScope && (
              <div className="hidden sm:block">
                <Menu label="Admin menu" button={<>Admin ▾</>}>
                  {(close) => (
                    <>
                      {v.isAdmin && <Link className={menuItem} to="/admin" onClick={close}>Admin settings</Link>}
                      <Link className={menuItem} to="/audit" onClick={close}>Audit log</Link>
                    </>
                  )}
                </Menu>
              </div>
            )}
            {v.signedIn ? (
              <div className="hidden sm:block">
                <Menu label="Account menu" button={<Avatar name={v.myPlayer?.name ?? v.me?.user.email ?? '?'} url={v.myPlayer?.avatarUrl} size={30} />}>
                  {(close) => (
                    <>
                      <div className="truncate px-4 py-2 text-xs muted">{v.me?.user.email}</div>
                      {v.myPlayer && <Link className={menuItem} to={playerHref(v.myPlayer)} onClick={close}>My player page</Link>}
                      {v.myPlayer && <Link className={menuItem} to="/profile" onClick={close}>Edit my profile</Link>}
                      <Link className={menuItem} to="/about" onClick={close}>How levels work</Link>
                      <button className={clsx(menuItem, 'text-red-600')} onClick={() => signOut()}>Sign out</button>
                    </>
                  )}
                </Menu>
              </div>
            ) : (
              !v.loading && (
                <button className="btn-accent btn-sm" onClick={() => signIn()}>
                  Sign in
                </button>
              )
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {v.loading ? <Loading /> : v.needsOnboarding && !(v.isAdmin && pathname.startsWith('/admin')) ? <Onboarding /> : <Outlet />}
      </main>
      <footer className="mx-auto flex max-w-5xl gap-4 px-4 pb-6 text-xs muted">
        <Link to="/about" className="hover:underline">How levels work</Link>
        <Link to="/privacy" className="hover:underline">Privacy</Link>
      </footer>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-end border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-ink-800 dark:bg-ink-950/95 sm:hidden">
        <MobileTab to="/" end label="Leaderboard" icon={ICONS.trophy} />
        <MobileTab to="/activity" label="Activity" icon={ICONS.inbox} badge={actions} />
        <Link to={v.signedIn ? '/log' : '#'} onClick={(e) => { if (!v.signedIn) { e.preventDefault(); signIn('/log') } }} className="-mt-5 flex flex-1 flex-col items-center" aria-label="Log match">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-ball-400 text-ink-950 shadow-lg ring-4 ring-white dark:ring-ink-950">{ICONS.plus}</span>
        </Link>
        <MobileTab to="/history" label="History" icon={ICONS.history} />
        <button className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-500" onClick={() => setMore(true)} aria-label="More">
          {ICONS.more}
          More
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
    </div>
  )
}
