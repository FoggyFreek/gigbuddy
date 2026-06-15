import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell.tsx'
import RequireAuth from './components/RequireAuth.tsx'
import RequireTenantAdmin from './components/RequireTenantAdmin.tsx'
import RequireSuperAdmin from './components/RequireSuperAdmin.tsx'

const AvailabilityPage = lazy(() => import('./pages/AvailabilityPage.tsx'))
const DashboardPage = lazy(() => import('./pages/DashboardPage.tsx'))
const FinancialDashboardPage = lazy(() => import('./pages/FinancialDashboardPage.tsx'))
const BandEventDetailPage = lazy(() => import('./pages/BandEventDetailPage.tsx'))
const BandEventsPage = lazy(() => import('./pages/BandEventsPage.tsx'))
const ContactDetailPage = lazy(() => import('./pages/ContactDetailPage.tsx'))
const ContactsPage = lazy(() => import('./pages/ContactsPage.tsx'))
const SuppliersPage = lazy(() => import('./pages/SuppliersPage.tsx'))
const SongsPage = lazy(() => import('./pages/SongsPage.tsx'))
const SongDetailPage = lazy(() => import('./pages/SongDetailPage.tsx'))
const SetlistsPage = lazy(() => import('./pages/SetlistsPage.tsx'))
const SetlistEditorPage = lazy(() => import('./pages/SetlistEditorPage.tsx'))
const EmailTemplatesPage = lazy(() => import('./pages/EmailTemplatesPage.tsx'))
const GigDetailPage = lazy(() => import('./pages/GigDetailPage.tsx'))
const GigMapPage = lazy(() => import('./pages/GigMapPage.tsx'))
const GigsPage = lazy(() => import('./pages/GigsPage.tsx'))
const LoginPage = lazy(() => import('./pages/LoginPage.tsx'))
const MembersPage = lazy(() => import('./pages/MembersPage.tsx'))
const PendingApprovalPage = lazy(() => import('./pages/PendingApprovalPage.tsx'))
const ProfilePage = lazy(() => import('./pages/ProfilePage.tsx'))
const RedeemInvitePage = lazy(() => import('./pages/RedeemInvitePage.tsx'))
const RehearsalDetailPage = lazy(() => import('./pages/RehearsalDetailPage.tsx'))
const RehearsalsPage = lazy(() => import('./pages/RehearsalsPage.tsx'))
const TasksPage = lazy(() => import('./pages/TasksPage.tsx'))
const VenueDetailPage = lazy(() => import('./pages/VenueDetailPage.tsx'))
const VenuesPage = lazy(() => import('./pages/VenuesPage.tsx'))
const InvoicesPage = lazy(() => import('./pages/InvoicesPage.tsx'))
const InvoiceDetailPage = lazy(() => import('./pages/InvoiceDetailPage.tsx'))
const PurchasesPage = lazy(() => import('./pages/PurchasesPage.tsx'))
const PurchaseDetailPage = lazy(() => import('./pages/PurchaseDetailPage.tsx'))
const MerchPage = lazy(() => import('./pages/MerchPage.tsx'))
const MerchandiseDetailsPage = lazy(() => import('./pages/MerchandiseDetailsPage.tsx'))
const JournalPage = lazy(() => import('./pages/JournalPage.tsx'))
const LedgerEntriesPage = lazy(() => import('./pages/LedgerEntriesPage.tsx'))
const LedgerEntrySearchPage = lazy(() => import('./pages/LedgerEntrySearchPage.tsx'))
const LedgerEntryDetailPage = lazy(() => import('./pages/LedgerEntryDetailPage.tsx'))
const ReportsPage = lazy(() => import('./pages/ReportsPage.tsx'))
const ReimbursementsPage = lazy(() => import('./pages/ReimbursementsPage.tsx'))
const VatReturnsPage = lazy(() => import('./pages/VatReturnsPage.tsx'))
const VatReturnDetailPage = lazy(() => import('./pages/VatReturnDetailPage.tsx'))
const TenantSettingsPage = lazy(() => import('./pages/TenantSettingsPage.tsx'))
const PaymentThanksPage = lazy(() => import('./pages/PaymentThanksPage.tsx'))
const TenantsPage = lazy(() => import('./pages/admin/TenantsPage.tsx'))
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage.tsx'))

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
            <Route path="/merch" element={<MerchPage />}>
              <Route path=":id" element={<MerchandiseDetailsPage />} />
            </Route>
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/ledger" element={<LedgerEntriesPage />} />
            <Route path="/ledger-entries" element={<LedgerEntrySearchPage />} />
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
