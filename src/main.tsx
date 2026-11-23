import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from './api'
import { Layout } from './components/Layout'
import { AboutPage } from './pages/About'
import { ActivityPage } from './pages/Activity'
import { AdminPage } from './pages/Admin'
import { AuditPage } from './pages/Audit'
import { ClubPage, ClubsPage } from './pages/Clubs'
import { GroupPage, GroupsPage } from './pages/Groups'
import { HistoryPage } from './pages/History'
import { LeaderboardPage } from './pages/Leaderboard'
import { LogMatchPage } from './pages/LogMatch'
import { MatchPage } from './pages/Match'
import { NotFoundPage } from './pages/NotFound'
import { PlayerPage } from './pages/Player'
import { PrivacyPage } from './pages/Privacy'
import { ProfilePage } from './pages/Profile'
import { HeadToHeadPage } from './pages/HeadToHead'
import { UnsubscribePage } from './pages/Unsubscribe'
import { SignInPage, VerifySignInPage } from './pages/SignIn'
import { ClubPosterPage, JoinClubPage } from './pages/JoinClub'
import { startReveal } from './reveal'
import './theme'
import './styles.css'

const root = document.getElementById('root')!
startReveal(root)

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<LeaderboardPage />} />
            <Route path="players/:key" element={<PlayerPage />} />
            <Route path="matches/:id" element={<MatchPage />} />
            <Route path="log" element={<LogMatchPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="clubs" element={<ClubsPage />} />
            <Route path="clubs/:slug" element={<ClubPage />} />
            <Route path="clubs/:slug/poster" element={<ClubPosterPage />} />
            <Route path="join/:slug" element={<JoinClubPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="groups/:slug" element={<GroupPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="h2h" element={<HeadToHeadPage />} />
            <Route path="unsubscribe" element={<UnsubscribePage />} />
            <Route path="signin" element={<SignInPage />} />
            <Route path="signin/verify" element={<VerifySignInPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
