import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import gigsRouter from './gigs.js'
import tasksRouter from './tasks.js'
import profileRouter from './profile.js'
import bandMembersRouter from './bandMembers.js'
import availabilityRouter from './availability.js'
import rehearsalsRouter from './rehearsals.js'
import bandEventsRouter from './bandEvents.js'
import emailTemplatesRouter from './emailTemplates.js'
import venuesRouter from './venues.js'
import contactsRouter from './contacts.js'
import songsRouter from './songs.js'
import setlistsRouter from './setlists.js'
import invoicesRouter from './invoices.js'
import purchasesRouter from './purchases.js'
import merchRouter from './merch.js'
import accountsRouter from './accounts.js'
import journalRouter from './journal.js'
import ledgerRouter from './ledger.js'
import reimbursementsRouter from './reimbursements.js'
import vatReturnsRouter from './vatReturns.js'
import pushRouter from './push.js'
import authRouter from './auth.js'
import usersRouter from './users.js'
import tenantsRouter from './tenants.js'
import adminUsersRouter from './adminUsers.js'
import sharePhotosRouter from './sharePhotos.js'
import filesRouter from './files.js'
import geocodeRouter from './geocode.js'
import { adminRouter as invitesAdminRouter, redeemRouter as invitesRedeemRouter } from './invites.js'
import { tenantRouter as statisticsRouter, adminRouter as adminStatisticsRouter } from './statistics.js'
import publicMollieRouter from './publicMollie.js'
import publicInvoicesRouter from './publicInvoices.js'
import { loadUser, requireApproved } from '../middleware/auth.js'
import {
  resolveTenantId,
  requireTenantMember,
  requireSuperAdmin,
} from '../middleware/tenant.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
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

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Public unauthenticated routes — mounted before CSRF and auth middleware.
router.use('/public/mollie', publicWebhookLimiter, publicMollieRouter)
router.use('/public/invoices', publicWebhookLimiter, publicInvoicesRouter)

router.use(apiLimiter)
router.use(csrf)

router.use('/auth/login', authLimiter)
router.use('/auth/callback', authLimiter)
router.use('/auth', authRouter)

const tenantMember = [requireApproved, resolveTenantId, requireTenantMember]
const superAdmin = [requireApproved, requireSuperAdmin]
// Finance surfaces: any read/export requires finance.view; routers gate their
// own mutations/side-effects with requirePermission(finance.manage) internally.
const financeView = [...tenantMember, requirePermission(PERMISSIONS.FINANCE_VIEW)]
// Membership administration (invites, role changes) is gated on members.manage;
// tenant-level settings/usage on tenant.manage. These capabilities map to the
// tenant_admin role in the matrix, but the routes gate on the *permission* so
// the matrix stays the single source of truth (see auth/permissions.js).
const membersManage = [...tenantMember, requirePermission(PERMISSIONS.MEMBERS_MANAGE)]
const tenantManage = [...tenantMember, requirePermission(PERMISSIONS.TENANT_MANAGE)]

router.use('/invites/redeem', redeemLimiter, loadUser, invitesRedeemRouter)
router.use('/admin/tenants', superAdmin, tenantsRouter)
router.use('/admin/users', superAdmin, adminUsersRouter)
router.use('/admin/statistics', superAdmin, adminStatisticsRouter)
router.use('/invites', membersManage, invitesAdminRouter)
router.use('/users', membersManage, usersRouter)
router.use('/statistics', tenantManage, statisticsRouter)
router.use('/gigs', tenantMember, gigsRouter)
router.use('/geocode', tenantMember, geocodeRouter)
router.use('/tasks', tenantMember, tasksRouter)
router.use('/profile', tenantMember, profileRouter)
router.use('/band-members', tenantMember, bandMembersRouter)
router.use('/availability', tenantMember, availabilityRouter)
router.use('/rehearsals', tenantMember, rehearsalsRouter)
router.use('/band-events', tenantMember, bandEventsRouter)
router.use('/email-templates', tenantMember, emailTemplatesRouter)
router.use('/venues', tenantMember, venuesRouter)
router.use('/contacts', tenantMember, contactsRouter)
router.use('/songs', tenantMember, songsRouter)
router.use('/setlists', tenantMember, setlistsRouter)
router.use('/invoices', financeView, invoicesRouter)
// Purchases is mixed: contributors create + view their own purchases
// (purchase.create); the full register and payments are finance-gated inside.
router.use('/purchases', tenantMember, purchasesRouter)
router.use('/merch', financeView, merchRouter)
router.use('/accounts', financeView, accountsRouter)
router.use('/journal', financeView, journalRouter)
router.use('/ledger', financeView, ledgerRouter)
router.use('/reimbursements', financeView, reimbursementsRouter)
router.use('/vat-returns', financeView, vatReturnsRouter)
router.use('/push', tenantMember, pushRouter)
router.use('/share/photos', tenantMember, sharePhotosRouter)
router.use('/files', tenantMember, filesRouter)

export default router
