import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import RequireAdmin from './components/RequireAdmin.jsx'

const AvailabilityPage = lazy(() => import('./pages/AvailabilityPage.jsx'))
const BandEventsPage = lazy(() => import('./pages/BandEventsPage.jsx'))
const ContactsPage = lazy(() => import('./pages/ContactsPage.jsx'))
const EmailTemplatesPage = lazy(() => import('./pages/EmailTemplatesPage.jsx'))
const GigsPage = lazy(() => import('./pages/GigsPage.jsx'))
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'))
const MembersPage = lazy(() => import('./pages/MembersPage.jsx'))
const PendingApprovalPage = lazy(() => import('./pages/PendingApprovalPage.jsx'))
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'))
const RehearsalsPage = lazy(() => import('./pages/RehearsalsPage.jsx'))
const TasksPage = lazy(() => import('./pages/TasksPage.jsx'))
const VenuesPage = lazy(() => import('./pages/VenuesPage.jsx'))

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pending" element={<PendingApprovalPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<ProfilePage />} />
            <Route path="/gigs" element={<GigsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/rehearsals" element={<RehearsalsPage />} />
            <Route path="/events" element={<BandEventsPage />} />
            <Route path="/venues" element={<VenuesPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/availability" element={<AvailabilityPage />} />
            <Route path="/email-templates" element={<EmailTemplatesPage />} />
            <Route element={<RequireAdmin />}>
              <Route path="/members" element={<MembersPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
