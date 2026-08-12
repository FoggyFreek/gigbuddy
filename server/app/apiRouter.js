import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import gigsRouter from '../planning/gigs/gigs.js'
import tasksRouter from '../planning/tasks/tasks.js'
import profileRouter from '../people/profiles/profile.js'
import bandMembersRouter from '../people/roster/bandMembers.js'
import availabilityRouter from '../planning/availability/availability.js'
import rehearsalsRouter from '../planning/rehearsals/rehearsals.js'
import achievementsRouter from '../user/achievements/achievements.js'
import bandEventsRouter from '../planning/events/bandEvents.js'
import emailTemplatesRouter from '../people/profiles/emailTemplates.js'
import venuesRouter from '../people/venues/venues.js'
import contactsRouter from '../people/contacts/contacts.js'
import songsRouter from '../music/songs/songs.js'
import setlistsRouter from '../music/setlists/setlists.js'
import invoicesRouter from '../finance/invoices/invoices.js'
import purchasesRouter from '../finance/purchases/purchases.js'
import merchRouter from '../commerce/merch/merch.js'
import accountsRouter from '../finance/accounts/accounts.js'
import accountingProfileRouter from '../finance/accounting-profile/accountingProfile.js'
import journalRouter from '../finance/ledger/journal.js'
import ledgerRouter from '../finance/ledger/ledger.js'
import bankImportRouter from '../finance/bank-import/bankImport.js'
import financeOnboardingRouter from '../finance/onboarding/financeOnboarding.js'
import reimbursementsRouter from '../finance/reimbursements/reimbursements.js'
import vatReturnsRouter from '../finance/vat/vatReturns.js'
import pushRouter from '../user/push/push.js'
import notificationsRouter from '../user/notifications/notifications.js'
import tutorialsRouter from '../user/tutorials/tutorials.js'
import authRouter from '../user/identity/auth.js'
import usersRouter from '../people/memberships/users.js'
import tenantsRouter from '../people/workspaces/tenants.js'
import tenantsSelfRouter from '../people/workspaces/tenantsSelf.js'
import tenantSettingsRouter from '../people/workspaces/tenantSettings.js'
import bandDirectoryRouter from '../people/band-directory/bandDirectory.js'
import meRouter from '../planning/agenda/me.js'
import meAvailabilityRouter from '../user/availability/meAvailability.js'
import meMembershipsRouter from '../people/memberships/meMemberships.js'
import bandProfilesRouter from '../people/band-profiles/bandProfiles.js'
import myBandsRouter from '../people/my-bands/myBands.js'
import bandProfileClaimsRouter from '../people/band-profiles/bandProfileClaims.js'
import adminBandProfileClaimsRouter from '../admin/band-profile-claims/adminBandProfileClaims.js'
import platformSettingsRouter from '../admin/platform-settings/platformSettings.js'
import adminUsersRouter from '../admin/users/adminUsers.js'
import adminPlansRouter from '../admin/plans/adminPlans.js'
import adminSubscriptionsRouter from '../admin/subscriptions/adminSubscriptions.js'
import adminStorageRouter from '../admin/storage/adminStorage.js'
import billingRouter from '../commerce/billing/billing.js'
import publicBillingMollieRouter from '../commerce/billing/publicBillingMollie.js'
import sharePhotosRouter from '../promotion/sharing/sharePhotos.js'
import filesRouter from '../platform/files/files.js'
import geocodeRouter from '../people/venues/geocode.js'
import placesRouter from '../people/venues/places.js'
import bandsintownRouter from '../promotion/bandsintown/bandsintown.js'
import { adminRouter as invitesAdminRouter, redeemRouter as invitesRedeemRouter } from '../people/memberships/invites.js'
import { tenantRouter as statisticsRouter, adminRouter as adminStatisticsRouter } from '../people/workspaces/statistics.js'
import publicMollieRouter from '../finance/invoices/publicMollie.js'
import publicInvoicesRouter from '../finance/invoices/publicInvoices.js'
import publicCalendarRouter from '../promotion/calendar-feed/publicCalendar.js'
import publicLinkpageRouter from '../promotion/linkpage/publicLinkpage.js'
import linkpageRouter from '../promotion/linkpage/linkpage.js'
import calendarFeedRouter from '../promotion/calendar-feed/calendarFeed.js'
import { loadUser, requireApproved, requireCurrentTerms } from '../middleware/auth.js'
import {
  resolveTenantId,
  requireTenantMember,
  requireTenantCapability,
  requireTenantCapabilityForBodyFields,
  resolveMemberTenantIds,
  requireSuperAdmin,
} from '../middleware/tenant.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { requireEntitlement, requireEntitlementForWrites } from '../middleware/entitlements.js'
import { FEATURES } from '../auth/entitlements.js'
import { TENANT_CAPABILITIES } from '../../shared/tenantCapabilities.js'
import { csrf } from '../middleware/csrf.js'

const router = Router()

// Skip rate limiting entirely in the test environment so the test harness
// can fire many requests without hitting artificial ceilings.
const isTest = process.env.NODE_ENV === 'test'

// express-rate-limit v8 draft-8 headers hash the keyGenerator result; use the
// IPv6-aware helper when falling back to an IP-derived key.
const keyGenerator = (req) => ipKeyGenerator(req.ip ?? req.socket?.remoteAddress ?? 'unknown')

// Broad API-wide limit — prevents bulk scraping and automated abuse.
// Applied before any route so every /api/* endpoint is covered.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator,
  skip: () => isTest,
})

// Tight limit for OIDC entry points — prevents brute-force of auth flows.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator,
  skip: () => isTest,
})

// Invite-code redemption — prevents code enumeration.
const redeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator,
  skip: () => isTest,
})

// Public webhook endpoints — unauthenticated and CSRF-exempt; this limiter
// caps abuse from random callers hitting our endpoint with guessed invoice IDs.
const publicWebhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator,
  skip: () => isTest,
})

// The band directory answers questions about tenants the caller has no
// membership in. The outstanding-request cap governs how many requests may be
// OPEN; this limiter governs how fast someone may knock — and bounds scraping
// of the directory itself.
const bandDirectoryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator,
  skip: () => isTest,
})

// Global band profiles are readable by any authenticated user and searched as
// the artist types, so the same reasoning as the directory applies: bound how
// fast the table can be enumerated.
const bandProfileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator,
  skip: () => isTest,
})

// Place lookup hits a metered third-party API once per debounced keystroke, so
// the blanket apiLimiter (1000) is far too loose to bound the upstream bill.
const placeSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator,
  skip: () => isTest,
})

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Public unauthenticated routes — mounted before CSRF and auth middleware.
router.use('/public/mollie', publicWebhookLimiter, publicMollieRouter)
router.use('/public/billing', publicWebhookLimiter, publicBillingMollieRouter)
router.use('/public/invoices', publicWebhookLimiter, publicInvoicesRouter)
router.use('/public/calendar', publicWebhookLimiter, publicCalendarRouter)
router.use('/public/linkpage', publicWebhookLimiter, publicLinkpageRouter)

router.use(apiLimiter)
router.use(csrf)

router.use('/auth/login', authLimiter)
router.use('/auth/callback', authLimiter)
router.use('/auth/link', authLimiter)
router.use('/auth', authRouter)

const tenantMember = [requireApproved, resolveTenantId, requireTenantMember, requireCurrentTerms]
const superAdmin = [requireApproved, requireSuperAdmin]
const currentTermsUser = [requireApproved, requireCurrentTerms]
// Finance surfaces: any read/export requires finance.view; routers gate their
// own mutations/side-effects with requirePermission(finance.manage) internally.
// The entitlement write gate is the finance read-only mode: when the owner's
// plan lacks the finance feature, reads/exports survive (a downgrade must not
// cut users off from their own records — the fiscal retention duty is theirs,
// not the platform's) but every non-GET is blocked. Inert while the tenant has
// no owner.
const financeWrites = requireEntitlementForWrites(FEATURES.FINANCE)
const financeView = [...tenantMember, requirePermission(PERMISSIONS.FINANCE_VIEW), financeWrites]
const integrations = requireEntitlement(FEATURES.INTEGRATIONS)
// Membership administration (invites, role changes) is gated on members.manage;
// tenant-level settings/usage on tenant.manage. These capabilities map to the
// tenant_admin role in the matrix, but the routes gate on the *permission* so
// the matrix stays the single source of truth (see auth/permissions.js).
const membersManage = [...tenantMember, requirePermission(PERMISSIONS.MEMBERS_MANAGE)]
const tenantManage = [...tenantMember, requirePermission(PERMISSIONS.TENANT_MANAGE)]
// Kind-specific surfaces use the shared capability registry. These backend
// gates are authoritative; the frontend consumes the same registry for UX.
const bandMembershipAdmin = requireTenantCapability(TENANT_CAPABILITIES.BAND_MEMBERSHIP_ADMIN)
const bandRoster = requireTenantCapability(TENANT_CAPABILITIES.BAND_ROSTER)
const bandAvailability = requireTenantCapability(TENANT_CAPABILITIES.BAND_AVAILABILITY)
const setlists = requireTenantCapability(TENANT_CAPABILITIES.SETLISTS)
const merch = requireTenantCapability(TENANT_CAPABILITIES.MERCH)
const bandPromotion = requireTenantCapability(TENANT_CAPABILITIES.BAND_PROMOTION_INTEGRATIONS)
const bandLinkpage = requireTenantCapability(TENANT_CAPABILITIES.BAND_LINKPAGE)
const myBands = requireTenantCapability(TENANT_CAPABILITIES.MY_BANDS)
const bandProfileClaim = requireTenantCapability(TENANT_CAPABILITIES.BAND_PROFILE_CLAIM)
const bandSlugChange = requireTenantCapability(TENANT_CAPABILITIES.BAND_SLUG_CHANGE)
// Tagging an event with a band is personal-only, but the planning endpoints
// themselves are shared. The field variant keeps them shared: it gates only the
// requests that actually mention my_band_id.
const myBandField = requireTenantCapabilityForBodyFields(TENANT_CAPABILITIES.MY_BANDS, ['my_band_id'])

router.use('/invites/redeem', redeemLimiter, loadUser, invitesRedeemRouter)
// Self-service owned tenants: user-level (no active-tenant resolution).
router.use('/tenants', requireApproved, tenantsSelfRouter)
// Band directory: user-level too — an artist searches and asks to join from
// inside their own workspace, with no membership in the target band.
router.use('/band-directory', currentTermsUser, bandDirectoryLimiter, bandDirectoryRouter)
// Global band profiles: bands that are not gigbuddy customers. User-level for
// the same reason — the row belongs to no tenant, so there is none to resolve.
router.use('/band-profiles', currentTermsUser, bandProfileLimiter, bandProfilesRouter)
// The cross-tenant artist agenda. Its own tier: authenticated + terms + the member tenant
// set, and deliberately NO resolveTenantId — see resolveMemberTenantIds.
// Availability is user-level, so it sits on the /me tier and resolves no
// tenant at all — mounted before the agenda router so `/me/availability` is not
// swallowed by it.
router.use('/me/availability', currentTermsUser, meAvailabilityRouter)
// Leaving a band is user-level too: no active tenant, no membership admin.
// Mounted before the agenda router so it is not swallowed by it.
router.use('/me/memberships', currentTermsUser, meMembershipsRouter)
router.use('/me', currentTermsUser, resolveMemberTenantIds, meRouter)
// User-level billing (subscription owner acts regardless of active tenant).
router.use('/billing', requireApproved, billingRouter)
router.use('/admin/tenants', superAdmin, tenantsRouter)
router.use('/admin/platform-settings', superAdmin, platformSettingsRouter)
router.use('/admin/users', superAdmin, adminUsersRouter)
router.use('/admin/plans', superAdmin, adminPlansRouter)
router.use('/admin/subscriptions', superAdmin, adminSubscriptionsRouter)
router.use('/admin/statistics', superAdmin, adminStatisticsRouter)
router.use('/admin/storage', superAdmin, adminStorageRouter)
router.use('/admin/band-profile-claims', superAdmin, adminBandProfileClaimsRouter)
router.use('/invites', membersManage, bandMembershipAdmin, invitesAdminRouter)
router.use('/users', membersManage, bandMembershipAdmin, usersRouter)
router.use('/statistics', tenantManage, statisticsRouter)
router.use(
  '/tenant',
  tenantManage,
  bandSlugChange,
  requireEntitlement(FEATURES.CUSTOM_SLUG),
  tenantSettingsRouter,
)
router.use('/gigs', tenantMember, myBandField, gigsRouter)
router.use('/geocode', tenantMember, geocodeRouter)
router.use('/places', tenantMember, placeSearchLimiter, placesRouter)
router.use('/bandsintown', tenantMember, bandPromotion, integrations, bandsintownRouter)
router.use('/tasks', tenantMember, tasksRouter)
router.use('/profile', tenantMember, profileRouter)
router.use('/band-members', tenantMember, bandRoster, bandMembersRouter)
router.use('/availability', tenantMember, bandAvailability, availabilityRouter)
router.use('/rehearsals', tenantMember, myBandField, rehearsalsRouter)
router.use('/achievements', tenantMember, achievementsRouter)
router.use('/band-events', tenantMember, myBandField, bandEventsRouter)
// The bands an artist plays in that aren't on gigbuddy. Personal-only: a band
// workspace's events are already the band's.
router.use('/my-bands', tenantMember, myBands, myBandsRouter)
// Claiming a global band profile: band-only, and an administrative act.
router.use('/band-profile-claims', tenantManage, bandProfileClaim, bandProfileClaimsRouter)
router.use('/email-templates', tenantMember, emailTemplatesRouter)
router.use('/venues', tenantMember, venuesRouter)
router.use('/contacts', tenantMember, contactsRouter)
router.use('/songs', tenantMember, songsRouter)
router.use('/setlists', tenantMember, setlists, setlistsRouter)
router.use('/invoices', financeView, invoicesRouter)
// Purchases is mixed: contributors create + view their own purchases
// (purchase.create); the full register and payments are finance-gated inside.
// Purchases are finance data (they post to the ledger), so writes fall under
// the finance entitlement too.
router.use('/purchases', tenantMember, financeWrites, purchasesRouter)
router.use('/merch', financeView, merch, merchRouter)
router.use('/accounts', financeView, accountsRouter)
router.use('/accounting-profile', financeView, accountingProfileRouter)
router.use('/journal', financeView, journalRouter)
router.use('/ledger', financeView, ledgerRouter)
router.use('/bank-import', financeView, bankImportRouter)
router.use('/finance-onboarding', financeView, financeOnboardingRouter)
router.use('/reimbursements', financeView, reimbursementsRouter)
router.use('/vat-returns', financeView, vatReturnsRouter)
router.use('/push', tenantMember, pushRouter)
// User-scoped, deliberately cross-tenant (the bell aggregates all bands) —
// requireApproved only, no resolveTenantId. See migration 097.
router.use('/notifications', currentTermsUser, notificationsRouter)
// User-scoped, cross-tenant tutorial dismissals (per-user, global).
router.use('/tutorials', currentTermsUser, tutorialsRouter)
// Not entitlement-gated at the mount: describing and revoking a feed token
// must stay possible after a downgrade (bearer-token erasure); only creating/
// rotating a token requires the integrations feature (gated in the router).
// The public feed itself 404s while the entitlement is missing.
router.use('/calendar-feed', tenantMember, calendarFeedRouter)
router.use('/share/photos', tenantMember, sharePhotosRouter)
// Link pages are a band surface, reserved to tenant admins and gated on the
// linkpage feature (silver/gold). The public export/image routes above stay
// open — the linkpage app enforces plan state from the entitlements in the
// export, and the export itself refuses a non-band slug.
router.use('/linkpage', tenantManage, bandLinkpage, requireEntitlement(FEATURES.LINKPAGE), linkpageRouter)
router.use('/files', tenantMember, filesRouter)

export default router
