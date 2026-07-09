import { Router } from 'express'
import * as oidc from '../oidc.js'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import {
  buildMePayload,
  bootstrapCallbackUser,
  canUseTenant,
  linkProviderIdentity,
  unlinkProvider,
  startLinkContext,
  matchesProviderSub,
  acceptTerms,
} from '../services/authService.js'
import { clearOnboardingTenant } from '../repositories/authRepository.js'
import { requireCurrentTerms } from '../middleware/auth.js'
import { sendError } from './routeHelpers.js'

const router = Router()

// Linking a provider demands a fresh primary re-auth; the second OIDC hop
// must complete inside this window.
const LINK_REAUTH_WINDOW_MS = 5 * 60 * 1000

function saveSession(session) {
  return new Promise((resolve, reject) =>
    session.save((err) => (err ? reject(err) : resolve())),
  )
}

function appUrl() {
  return process.env.APP_URL || 'http://localhost:5173'
}

function settingsRedirect(res, params) {
  const qs = new URLSearchParams(params).toString()
  res.redirect(`${appUrl()}/settings/connected-accounts?${qs}`)
}

// Every OIDC handshake key, for both login and link flows. Cleared before a
// new flow starts and after every link-flow outcome (login callbacks wipe
// them via session.regenerate).
function clearOidcSession(session) {
  delete session.oidcCodeVerifier
  delete session.oidcState
  delete session.oidcNonce
  delete session.oidcProvider
  delete session.oidcFlow
  delete session.oidcLinkTarget
  delete session.oidcLinkUserId
  delete session.linkReauthAt
}

async function startLogin(req, res, next, provider) {
  try {
    clearOidcSession(req.session)
    req.session.oidcFlow = 'login'
    const authUrl = await oidc.buildAuthUrl(req.session, provider)
    await saveSession(req.session)
    res.redirect(authUrl.href)
  } catch (err) {
    next(err)
  }
}

router.get('/login', (req, res, next) => startLogin(req, res, next, 'google'))
router.get('/login/microsoft', (req, res, next) => startLogin(req, res, next, 'microsoft'))

async function handleLoginCallback(req, res, provider, claims) {
  const { user, activeTenantId } = await bootstrapCallbackUser(pool, provider, claims)

  await new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  )
  req.session.userId = user.id
  req.session.activeTenantId = activeTenantId
  await saveSession(req.session)

  auditLog(req, 'auth.login', { userId: user.id, email: user.email })
  res.redirect(appUrl())
}

// Step 1 of the link flow completed: the user freshly re-entered their
// primary credentials. Verify the identity matches the account (not just any
// IdP session), then hop straight into the target provider's flow.
async function handleLinkReauthCallback(req, res, provider, claims) {
  const userId = req.session.userId
  const target = req.session.oidcLinkTarget
  if (!userId || req.session.oidcLinkUserId !== userId || !oidc.isKnownProvider(target)) {
    clearOidcSession(req.session)
    await saveSession(req.session)
    return res.status(403).json({ error: 'Forbidden' })
  }
  if (!(await matchesProviderSub(pool, userId, provider, claims.sub))) {
    clearOidcSession(req.session)
    await saveSession(req.session)
    return settingsRedirect(res, { linkError: 'reauth_mismatch' })
  }

  req.session.oidcFlow = 'link'
  req.session.linkReauthAt = Date.now()
  // Overwrites verifier/state/nonce/oidcProvider for the second hop; the
  // link-* keys set above survive.
  const authUrl = await oidc.buildAuthUrl(req.session, target)
  await saveSession(req.session)
  res.redirect(authUrl.href)
}

// Step 2 completed: attach the new identity to the session user.
async function handleLinkCallback(req, res, provider, claims) {
  const userId = req.session.userId
  const freshReauth =
    typeof req.session.linkReauthAt === 'number' &&
    Date.now() - req.session.linkReauthAt < LINK_REAUTH_WINDOW_MS
  const authorized =
    userId &&
    req.session.oidcLinkUserId === userId &&
    req.session.oidcLinkTarget === provider &&
    freshReauth

  clearOidcSession(req.session)
  await saveSession(req.session)

  if (!authorized) return settingsRedirect(res, { linkError: 'expired' })

  const result = await linkProviderIdentity(pool, userId, provider, claims)
  if (result.error) {
    return settingsRedirect(res, { linkError: result.error.body.code ?? 'failed' })
  }
  auditLog(req, `auth.link.${provider}`, { userId })
  settingsRedirect(res, { linked: provider })
}

async function handleCallbackFor(req, res, next, provider) {
  const flow = req.session?.oidcFlow ?? 'login'
  try {
    const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`)
    const claims = await oidc.handleCallback(req.session, provider, currentUrl)

    if (flow === 'link-reauth') return await handleLinkReauthCallback(req, res, provider, claims)
    if (flow === 'link') return await handleLinkCallback(req, res, provider, claims)
    return await handleLoginCallback(req, res, provider, claims)
  } catch (err) {
    // Sign-in by an unknown sub whose email is already taken: guidance, not a
    // bare error page — the account must be linked from an authenticated
    // session instead (never auto-linked here).
    if (flow === 'login' && err?.code === 'account_exists') {
      return res.redirect(`${appUrl()}/login?authError=account_exists`)
    }
    if (flow === 'link' || flow === 'link-reauth') {
      clearOidcSession(req.session)
      await saveSession(req.session).catch(() => {})
      return settingsRedirect(res, { linkError: 'failed' })
    }
    next(err)
  }
}

router.get('/callback', (req, res, next) => handleCallbackFor(req, res, next, 'google'))
router.get('/callback/microsoft', (req, res, next) => handleCallbackFor(req, res, next, 'microsoft'))

// Begins the explicit link flow (settings → "Link account"): a navigation
// endpoint, so failures bounce back to the settings page with an error code.
router.get('/link/:provider/start', requireCurrentTerms, async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  const target = req.params.provider
  if (!oidc.isKnownProvider(target)) return res.status(404).json({ error: 'Not found' })
  try {
    const context = await startLinkContext(pool, req.session.userId, target)
    if (context.error) return settingsRedirect(res, { linkError: context.error.body.code ?? 'failed' })

    clearOidcSession(req.session)
    req.session.oidcFlow = 'link-reauth'
    req.session.oidcLinkTarget = target
    req.session.oidcLinkUserId = req.session.userId
    const authUrl = await oidc.buildAuthUrl(req.session, context.primaryProvider, { reauth: true })
    await saveSession(req.session)
    res.redirect(authUrl.href)
  } catch (err) {
    next(err)
  }
})

// Unsafe method on purpose: CSRF-protected, unlike the redirect GETs above.
router.post('/link/:provider/unlink', requireCurrentTerms, async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  const provider = req.params.provider
  if (!oidc.isKnownProvider(provider)) return res.status(404).json({ error: 'Not found' })
  try {
    const result = await unlinkProvider(pool, req.session.userId, provider)
    if (result.error) return sendError(res, result.error)
    auditLog(req, `auth.unlink.${provider}`, { userId: req.session.userId })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

router.post('/logout', (req, res, next) => {
  // Capture before session is destroyed.
  const userId = req.session?.userId ?? null
  req.session.destroy((err) => {
    if (err) return next(err)
    auditLog(req, 'auth.logout', { userId })
    res.clearCookie('connect.sid')
    res.status(204).end()
  })
})

router.get('/me', async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const result = await buildMePayload(pool, req.session.userId, req.session.activeTenantId ?? null)
    if (!result) return res.status(401).json({ error: 'Unauthorized' })

    if (req.session.activeTenantId !== result.activeTenantId) {
      req.session.activeTenantId = result.activeTenantId
      await saveSession(req.session)
    }

    res.json(result.payload)
  } catch (err) {
    next(err)
  }
})

// Terms acceptance is user-level and pre-membership (a fresh onboarding user
// has no tenant yet), so a session is the only gate — like /me.
router.post('/accept-terms', async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const result = await acceptTerms(pool, req.session.userId, req.body?.version)
    if (result.error) return sendError(res, result.error)
    auditLog(req, 'auth.terms_accept', { userId: req.session.userId })
    res.json({ termsAcceptedAt: result.termsAcceptedAt, termsVersion: result.termsVersion })
  } catch (err) {
    next(err)
  }
})

// Ends the onboarding flow: clears the resume pointer so a later /onboarding
// visit can never adopt (and overwrite) the now-established band. Idempotent.
router.post('/onboarding-complete', requireCurrentTerms, async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  try {
    await clearOnboardingTenant(pool, req.session.userId)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

router.post('/active-tenant', requireCurrentTerms, async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' })
  const tenantId = Number(req.body?.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return res.status(400).json({ error: 'tenantId required' })
  }
  try {
    if (!(await canUseTenant(pool, req.session.userId, tenantId))) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const prevTenantId = req.session.activeTenantId ?? null
    req.session.activeTenantId = tenantId
    await saveSession(req.session)

    auditLog(req, 'auth.tenant.switch', { fromTenantId: prevTenantId, toTenantId: tenantId })
    const result = await buildMePayload(pool, req.session.userId, tenantId)
    if (!result) return res.status(401).json({ error: 'Unauthorized' })
    res.json(result.payload)
  } catch (err) {
    next(err)
  }
})

export default router
