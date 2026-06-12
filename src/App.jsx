import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import RequireTenantAdmin from './components/RequireTenantAdmin.jsx'
import RequireSuperAdmin from './components/RequireSuperAdmin.jsx'

const AvailabilityPage = lazy(() => import('./pages/AvailabilityPage.jsx'))
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'))
const FinancialDashboardPage = lazy(() => import('./pages/FinancialDashboardPage.jsx'))
const BandEventDetailPage = lazy(() => import('./pages/BandEventDetailPage.jsx'))
const BandEventsPage = lazy(() => import('./pages/BandEventsPage.jsx'))
const ContactDetailPage = lazy(() => import('./pages/ContactDetailPage.jsx'))
const ContactsPage = lazy(() => import('./pages/ContactsPage.jsx'))
const SuppliersPage = lazy(() => import('./pages/SuppliersPage.jsx'))
const SongsPage = lazy(() => import('./pages/SongsPage.jsx'))
const SongDetailPage = lazy(() => import('./pages/SongDetailPage.jsx'))
const SetlistsPage = lazy(() => import('./pages/SetlistsPage.jsx'))
const SetlistEditorPage = lazy(() => import('./pages/SetlistEditorPage.jsx'))
const EmailTemplatesPage = lazy(() => import('./pages/EmailTemplatesPage.jsx'))
const GigDetailPage = lazy(() => import('./pages/GigDetailPage.jsx'))
const GigMapPage = lazy(() => import('./pages/GigMapPage.jsx'))
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
const InvoicesPage = lazy(() => import('./pages/InvoicesPage.jsx'))
const InvoiceDetailPage = lazy(() => import('./pages/InvoiceDetailPage.jsx'))
const PurchasesPage = lazy(() => import('./pages/PurchasesPage.jsx'))
const PurchaseDetailPage = lazy(() => import('./pages/PurchaseDetailPage.jsx'))
const MerchPage = lazy(() => import('./pages/MerchPage.jsx'))
const JournalPage = lazy(() => import('./pages/JournalPage.jsx'))
const LedgerEntriesPage = lazy(() => import('./pages/LedgerEntriesPage.jsx'))
const LedgerEntryDetailPage = lazy(() => import('./pages/LedgerEntryDetailPage.jsx'))
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'))
const ReimbursementsPage = lazy(() => import('./pages/ReimbursementsPage.jsx'))
const VatReturnsPage = lazy(() => import('./pages/VatReturnsPage.jsx'))
const VatReturnDetailPage = lazy(() => import('./pages/VatReturnDetailPage.jsx'))
const TenantSettingsPage = lazy(() => import('./pages/TenantSettingsPage.jsx'))
const PaymentThanksPage = lazy(() => import('./pages/PaymentThanksPage.jsx'))
const TenantsPage = lazy(() => import('./pages/admin/TenantsPage.jsx'))
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage.jsx'))

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pending" element={<PendingApprovalPage />} />
        <Route path="/payment/thanks" element={<PaymentThanksPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/redeem-invite" element={<RedeemInvitePage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/financial" element={<FinancialDashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/gigs" element={<GigsPage />}>
              <Route path=":id" element={<GigDetailPage />} />
            </Route>
            <Route path="/map" element={<GigMapPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/rehearsals" element={<RehearsalsPage />}>
              <Route path=":id" element={<RehearsalDetailPage />} />
            </Route>
            <Route path="/events" element={<BandEventsPage />}>
              <Route path=":id" element={<BandEventDetailPage />} />
            </Route>
            <Route path="/venues" element={<VenuesPage />}>
              <Route path=":id" element={<VenueDetailPage />} />
            </Route>
            <Route path="/contacts" element={<ContactsPage />}>
              <Route path=":id" element={<ContactDetailPage />} />
            </Route>
            <Route path="/suppliers" element={<SuppliersPage />}>
              <Route path=":id" element={<ContactDetailPage />} />
            </Route>
            <Route path="/songs" element={<SongsPage />}>
              <Route path=":id" element={<SongDetailPage />} />
            </Route>
            <Route path="/setlists" element={<SetlistsPage />} />
            <Route path="/setlists/:id" element={<SetlistEditorPage />} />
            <Route path="/invoices" element={<InvoicesPage />}>
              <Route path=":id" element={<InvoiceDetailPage />} />
            </Route>
            <Route path="/purchases" element={<PurchasesPage />}>
              <Route path=":id" element={<PurchaseDetailPage />} />
            </Route>
            <Route path="/merch" element={<MerchPage />} />
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/ledger" element={<LedgerEntriesPage />} />
            <Route path="/ledger/:id" element={<LedgerEntryDetailPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reimbursements" element={<ReimbursementsPage />} />
            <Route path="/availability" element={<AvailabilityPage />}>
              <Route path="gigs/:id" element={<GigDetailPage />} />
              <Route path="rehearsals/:id" element={<RehearsalDetailPage />} />
              <Route path="events/:id" element={<BandEventDetailPage />} />
            </Route>
            <Route path="/email-templates" element={<EmailTemplatesPage />} />
            <Route element={<RequireTenantAdmin />}>
              <Route path="/members" element={<MembersPage />} />
              <Route path="/settings" element={<TenantSettingsPage />} />
              <Route path="/vat-returns" element={<VatReturnsPage />}>
                <Route path=":id" element={<VatReturnDetailPage />} />
              </Route>
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
