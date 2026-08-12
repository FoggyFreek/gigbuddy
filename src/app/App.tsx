import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import AppShell from '../components/AppShell.tsx'
import RequireAuth from '../components/RequireAuth.tsx'
import RequireSuperAdmin from '../components/RequireSuperAdmin.tsx'
import RequirePermission from '../components/RequirePermission.tsx'
import RequireTenantCapability from '../components/RequireTenantCapability.tsx'
import { PERMISSIONS } from '../auth/permissions.ts'
import { TENANT_CAPABILITIES } from '../auth/tenantCapabilities.ts'

const AchievementsPage = lazy(() => import('../user/achievements/AchievementsPage.tsx'))
const AvailabilityPage = lazy(() => import('../planning/availability/AvailabilityPage.tsx'))
const DashboardPage = lazy(() => import('./dashboard/DashboardPage.tsx'))
const FinancialDashboardPage = lazy(() => import('../finance/reports/FinancialDashboardPage.tsx'))
const FinanceOnboardingPage = lazy(() => import('../finance/onboarding/FinanceOnboardingPage.tsx'))
const BandEventDetailPage = lazy(() => import('../planning/events/BandEventDetailPage.tsx'))
const BandEventsPage = lazy(() => import('../planning/events/BandEventsPage.tsx'))
const ContactDetailPage = lazy(() => import('../people/contacts/ContactDetailPage.tsx'))
const ContactsPage = lazy(() => import('../people/contacts/ContactsPage.tsx'))
const SuppliersPage = lazy(() => import('../people/contacts/SuppliersPage.tsx'))
const SongsPage = lazy(() => import('../music/songs/SongsPage.tsx'))
const SongDetailPage = lazy(() => import('../music/songs/SongDetailPage.tsx'))
const SetlistsPage = lazy(() => import('../music/setlists/SetlistsPage.tsx'))
const SetlistEditorPage = lazy(() => import('../music/setlists/SetlistEditorPage.tsx'))
const EmailTemplatesPage = lazy(() => import('../people/profiles/EmailTemplatesPage.tsx'))
const MyBandsPage = lazy(() => import('../people/my-bands/MyBandsPage.tsx'))
const BandProfileClaimsPage = lazy(() => import('../admin/band-profile-claims/BandProfileClaimsPage.tsx'))
const GigDetailPage = lazy(() => import('../planning/gigs/GigDetailPage.tsx'))
const GigMapPage = lazy(() => import('../planning/gigs/GigMapPage.tsx'))
const GigsPage = lazy(() => import('../planning/gigs/GigsPage.tsx'))
const LoginPage = lazy(() => import('../user/identity/LoginPage.tsx'))
const PendingApprovalPage = lazy(() => import('../user/identity/PendingApprovalPage.tsx'))
const ProfilePage = lazy(() => import('../people/profiles/ProfilePage.tsx'))
const RedeemInvitePage = lazy(() => import('../people/memberships/RedeemInvitePage.tsx'))
const OnboardingPage = lazy(() => import('../user/identity/OnboardingPage.tsx'))
const AcceptTermsPage = lazy(() => import('../user/identity/AcceptTermsPage.tsx'))
const RehearsalDetailPage = lazy(() => import('../planning/rehearsals/RehearsalDetailPage.tsx'))
const RehearsalsPage = lazy(() => import('../planning/rehearsals/RehearsalsPage.tsx'))
const TasksPage = lazy(() => import('../planning/tasks/TasksPage.tsx'))
const VenueDetailPage = lazy(() => import('../people/venues/VenueDetailPage.tsx'))
const VenuesPage = lazy(() => import('../people/venues/VenuesPage.tsx'))
const InvoicesPage = lazy(() => import('../finance/invoices/InvoicesPage.tsx'))
const InvoiceDetailPage = lazy(() => import('../finance/invoices/InvoiceDetailPage.tsx'))
const PurchasesPage = lazy(() => import('../finance/purchases/PurchasesPage.tsx'))
const PurchaseDetailPage = lazy(() => import('../finance/purchases/PurchaseDetailPage.tsx'))
const MerchPage = lazy(() => import('../commerce/merch/MerchPage.tsx'))
const MerchandiseDetailsPage = lazy(() => import('../commerce/merch/MerchandiseDetailsPage.tsx'))
const JournalPage = lazy(() => import('../finance/ledger/JournalPage.tsx'))
const LedgerEntriesPage = lazy(() => import('../finance/ledger/LedgerEntriesPage.tsx'))
const LedgerEntrySearchPage = lazy(() => import('../finance/ledger/LedgerEntrySearchPage.tsx'))
const LedgerEntryDetailPage = lazy(() => import('../finance/ledger/LedgerEntryDetailPage.tsx'))
const ReportsPage = lazy(() => import('../finance/reports/ReportsPage.tsx'))
const ReimbursementsPage = lazy(() => import('../finance/reimbursements/ReimbursementsPage.tsx'))
const VatReturnsPage = lazy(() => import('../finance/vat/VatReturnsPage.tsx'))
const VatReturnDetailPage = lazy(() => import('../finance/vat/VatReturnDetailPage.tsx'))
const SettingsPage = lazy(() => import('../people/workspaces/SettingsPage.tsx'))
const PaymentThanksPage = lazy(() => import('../commerce/billing/PaymentThanksPage.tsx'))
const LockedFeaturePage = lazy(() => import('../commerce/billing/LockedFeaturePage.tsx'))
const TenantsPage = lazy(() => import('../admin/tenants/TenantsPage.tsx'))
const AdminUsersPage = lazy(() => import('../admin/users/AdminUsersPage.tsx'))
const SubscriptionsPage = lazy(() => import('../admin/subscriptions/SubscriptionsPage.tsx'))

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pending" element={<PendingApprovalPage />} />
        <Route path="/payment/thanks" element={<PaymentThanksPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/redeem-invite" element={<RedeemInvitePage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/accept-terms" element={<AcceptTermsPage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            {/* No sidebar nav entry — reached via the dashboard card's Show all. */}
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            {/* Unified settings — reachable by every member; each section gates
                its own content by role. Old /account and /members deep links
                redirect here so existing bookmarks keep working. */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:section" element={<SettingsPage />} />
            <Route path="/account" element={<Navigate to="/settings" replace />} />
            <Route path="/account/billing" element={<Navigate to="/settings/billing" replace />} />
            <Route path="/account/:section" element={<Navigate to="/settings/preferences" replace />} />
            <Route path="/members" element={<Navigate to="/settings/members" replace />} />
            {/* Upsell landing for tier-locked features (diamond nav items). */}
            <Route path="/upgrade/:feature" element={<LockedFeaturePage />} />
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
            <Route element={<RequireTenantCapability capability={TENANT_CAPABILITIES.SETLISTS} />}>
              <Route path="/setlists" element={<SetlistsPage />} />
              <Route path="/setlists/:id" element={<SetlistEditorPage />} />
            </Route>
            {/* Contributors+ (purchase.create) may add purchases for reimbursement. */}
            <Route element={<RequirePermission permission={PERMISSIONS.PURCHASE_CREATE} />}>
              <Route path="/purchases" element={<PurchasesPage />}>
                <Route path=":id" element={<PurchaseDetailPage />} />
              </Route>
            </Route>
            {/* Finance manage surface — the setup wizard writes settings + opening balance. */}
            <Route element={<RequirePermission permission={PERMISSIONS.FINANCE_MANAGE} />}>
              <Route path="/finance-onboarding" element={<FinanceOnboardingPage />} />
            </Route>
            {/* Finance surfaces — financial_admin / tenant_admin / super admin. */}
            <Route element={<RequirePermission permission={PERMISSIONS.FINANCE_VIEW} />}>
              <Route path="/financial" element={<FinancialDashboardPage />} />
              <Route path="/invoices" element={<InvoicesPage />}>
                <Route path=":id" element={<InvoiceDetailPage />} />
              </Route>
              <Route element={<RequireTenantCapability capability={TENANT_CAPABILITIES.MERCH} />}>
                <Route path="/merch" element={<MerchPage />}>
                  <Route path=":id" element={<MerchandiseDetailsPage />} />
                </Route>
              </Route>
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/ledger" element={<LedgerEntriesPage />} />
              <Route path="/ledger-entries" element={<LedgerEntrySearchPage />} />
              <Route path="/ledger/:id" element={<LedgerEntryDetailPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/reimbursements" element={<ReimbursementsPage />} />
              <Route path="/vat-returns" element={<VatReturnsPage />}>
                <Route path=":id" element={<VatReturnDetailPage />} />
              </Route>
            </Route>
            <Route path="/availability" element={<AvailabilityPage />}>
              <Route path="gigs/:id" element={<GigDetailPage />} />
              <Route path="rehearsals/:id" element={<RehearsalDetailPage />} />
              <Route path="events/:id" element={<BandEventDetailPage />} />
            </Route>
            <Route path="/email-templates" element={<EmailTemplatesPage />} />
            <Route element={<RequireTenantCapability capability={TENANT_CAPABILITIES.MY_BANDS} />}>
              <Route path="/my-bands" element={<MyBandsPage />} />
            </Route>
            <Route element={<RequireSuperAdmin />}>
              <Route path="/admin/tenants" element={<TenantsPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/band-profile-claims" element={<BandProfileClaimsPage />} />
              <Route path="/admin/subscriptions" element={<SubscriptionsPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
