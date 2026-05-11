import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import RequireTenantAdmin from './components/RequireTenantAdmin.jsx'
import RequireSuperAdmin from './components/RequireSuperAdmin.jsx'

const AvailabilityPage = lazy(() => import('./pages/AvailabilityPage.jsx'))
const BandEventDetailPage = lazy(() => import('./pages/BandEventDetailPage.jsx'))
const BandEventsPage = lazy(() => import('./pages/BandEventsPage.jsx'))
const ContactDetailPage = lazy(() => import('./pages/ContactDetailPage.jsx'))
const ContactsPage = lazy(() => import('./pages/ContactsPage.jsx'))
const EmailTemplatesPage = lazy(() => import('./pages/EmailTemplatesPage.jsx'))
const GigDetailPage = lazy(() => import('./pages/GigDetailPage.jsx'))
const GigsPage = lazy(() => import('./pages/GigsPage.jsx'))
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'))
const MembersPage = lazy(() => import('./pages/MembersPage.jsx'))
const PendingApprovalPage = lazy(() => import('./pages/PendingApprovalPage.jsx'))
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'))
const RedeemInvitePage = lazy(() => import('./pages/RedeemInvitePage.jsx'))
const RehearsalDetailPage = lazy(() => import('./pages/RehearsalDetailPage.jsx'))
const RehearsalsPage = lazy(() => import('./pages/RehearsalsPage.jsx'))
const TasksPage = lazy(() => import('./pages/TasksPage.jsx'))
const VenueDetailPage = lazy(() => import('./pages/VenueDetailPage.jsx'))
const VenuesPage = lazy(() => import('./pages/VenuesPage.jsx'))
const TenantSettingsPage = lazy(() => import('./pages/TenantSettingsPage.jsx'))
const TenantsPage = lazy(() => import('./pages/admin/TenantsPage.jsx'))
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage.jsx'))

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pending" element={<PendingApprovalPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/redeem-invite" element={<RedeemInvitePage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<ProfilePage />} />
            <Route path="/gigs" element={<GigsPage />} />
            <Route path="/gigs/:id" element={<GigDetailPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/rehearsals" element={<RehearsalsPage />} />
            <Route path="/rehearsals/:id" element={<RehearsalDetailPage />} />
            <Route path="/events" element={<BandEventsPage />} />
            <Route path="/events/:id" element={<BandEventDetailPage />} />
            <Route path="/venues" element={<VenuesPage />} />
            <Route path="/venues/:id" element={<VenueDetailPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/contacts/:id" element={<ContactDetailPage />} />
            <Route path="/availability" element={<AvailabilityPage />} />
            <Route path="/email-templates" element={<EmailTemplatesPage />} />
            <Route element={<RequireTenantAdmin />}>
              <Route path="/members" element={<MembersPage />} />
              <Route path="/settings" element={<TenantSettingsPage />} />
            </Route>
            <Route element={<RequireSuperAdmin />}>
              <Route path="/admin/tenants" element={<TenantsPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
