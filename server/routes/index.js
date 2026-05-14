import { Router } from 'express'
import rateLimit from 'express-rate-limit'
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
import pushRouter from './push.js'
import authRouter from './auth.js'
import usersRouter from './users.js'
import tenantsRouter from './tenants.js'
import adminUsersRouter from './adminUsers.js'
import sharePhotosRouter from './sharePhotos.js'
import filesRouter from './files.js'
import { adminRouter as invitesAdminRouter, redeemRouter as invitesRedeemRouter } from './invites.js'
import { loadUser, requireApproved } from '../middleware/auth.js'
import {
  resolveTenantId,
  requireTenantMember,
  requireTenantAdmin,
  requireSuperAdmin,
} from '../middleware/tenant.js'
import { csrf } from '../middleware/csrf.js'

const router = Router()

// Skip rate limiting entirely in the test environment so the test harness
// can fire many requests without hitting artificial ceilings.
const isTest = process.env.NODE_ENV === 'test'

// Broad API-wide limit — prevents bulk scraping and automated abuse.
// Applied before any route so every /api/* endpoint is covered.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: () => isTest,
})

// Tight limit for OIDC entry points — prevents brute-force of auth flows.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: () => isTest,
})

// Invite-code redemption — prevents code enumeration.
const redeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: () => isTest,
})

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

router.use(apiLimiter)
router.use(csrf)

router.use('/auth', authLimiter, authRouter)

const tenantMember = [requireApproved, resolveTenantId, requireTenantMember]
const tenantAdmin = [requireApproved, resolveTenantId, requireTenantAdmin]
const superAdmin = [requireApproved, requireSuperAdmin]

router.use('/invites/redeem', redeemLimiter, loadUser, invitesRedeemRouter)
router.use('/admin/tenants', superAdmin, tenantsRouter)
router.use('/admin/users', superAdmin, adminUsersRouter)
router.use('/invites', tenantAdmin, invitesAdminRouter)
router.use('/users', tenantAdmin, usersRouter)
router.use('/gigs', tenantMember, gigsRouter)
router.use('/tasks', tenantMember, tasksRouter)
router.use('/profile', tenantMember, profileRouter)
router.use('/band-members', tenantMember, bandMembersRouter)
router.use('/availability', tenantMember, availabilityRouter)
router.use('/rehearsals', tenantMember, rehearsalsRouter)
router.use('/band-events', tenantMember, bandEventsRouter)
router.use('/email-templates', tenantMember, emailTemplatesRouter)
router.use('/venues', tenantMember, venuesRouter)
router.use('/contacts', tenantMember, contactsRouter)
router.use('/push', tenantMember, pushRouter)
router.use('/share/photos', tenantMember, sharePhotosRouter)
router.use('/files', tenantMember, filesRouter)

export default router
