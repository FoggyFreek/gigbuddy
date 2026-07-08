import * as client from 'openid-client'

// Personal Microsoft accounts live in the fixed "consumers" tenant. Discovery
// must use the tenant GUID (not the /consumers alias): the alias document
// reports this GUID as its issuer, and openid-client v6 rejects a discovery
// URL that doesn't match the issuer. Pinning the GUID also means work/school
// (org tenant) tokens can never pass issuer validation.
const MICROSOFT_CONSUMERS_ISSUER =
  'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0'

const PROVIDERS = {
  google: {
    issuerUrl: 'https://accounts.google.com',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    redirectUriEnv: 'OIDC_REDIRECT_URI',
  },
  microsoft: {
    issuerUrl: MICROSOFT_CONSUMERS_ISSUER,
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
    redirectUriEnv: 'MICROSOFT_REDIRECT_URI',
  },
}

export const PROVIDER_NAMES = Object.keys(PROVIDERS)

const configs = new Map()

export function isKnownProvider(provider) {
  return Object.hasOwn(PROVIDERS, provider)
}

export function isProviderConfigured(provider) {
  return configs.has(provider)
}

// Discovers every provider whose client id is configured. Microsoft is
// optional: without MICROSOFT_* env vars its routes answer 503 instead of
// blocking startup (dev environments predate the Entra registration).
export async function initOidc() {
  for (const [name, def] of Object.entries(PROVIDERS)) {
    const clientId = process.env[def.clientIdEnv]
    if (!clientId) continue
    const config = await client.discovery(
      new URL(def.issuerUrl),
      clientId,
      process.env[def.clientSecretEnv],
    )
    configs.set(name, config)
  }
}

function requireConfig(provider) {
  const config = configs.get(provider)
  if (!config) {
    const err = new Error(`OIDC provider not configured: ${provider}`)
    err.status = 503
    throw err
  }
  return config
}

// Strictly typed per-provider claim validation. Only a *boolean* true
// email_verified counts as verified — string "true"/"false", numbers, or a
// missing field all fail (an IdP or parser quirk must never fail open).
export function validateProviderClaims(provider, claims) {
  if (!isKnownProvider(provider)) {
    throw new Error(`Unknown OIDC provider: ${provider}`)
  }
  const forbid = (message) => {
    const err = new Error(message)
    err.status = 403
    throw err
  }
  if (typeof claims?.sub !== 'string' || claims.sub === '') {
    forbid('Missing subject claim from identity provider')
  }
  if (typeof claims?.email !== 'string' || claims.email === '') {
    forbid('Email not provided by identity provider')
  }
  if (provider === 'google' && claims.email_verified !== true) {
    forbid('Email not verified by identity provider')
  }
  // microsoft (consumers tenant) never emits email_verified: the email claim
  // is accepted for display/contact only. Callers must never use it for
  // account mapping — sign-in resolution is by sub alone.
}

export async function buildAuthUrl(session, provider, { reauth = false } = {}) {
  const config = requireConfig(provider)
  const codeVerifier = client.randomPKCECodeVerifier()
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
  const state = client.randomState()
  const nonce = client.randomNonce()

  session.oidcCodeVerifier = codeVerifier
  session.oidcState = state
  session.oidcNonce = nonce
  session.oidcProvider = provider

  return client.buildAuthorizationUrl(config, {
    redirect_uri: process.env[PROVIDERS[provider].redirectUriEnv],
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    // Re-auth (account linking) demands a fresh credential entry at the IdP,
    // not a lingering SSO cookie.
    ...(reauth ? { prompt: 'login', max_age: '0' } : {}),
  })
}

export async function handleCallback(session, provider, currentUrl) {
  if (session.oidcProvider !== provider) {
    const err = new Error('OIDC callback provider mismatch')
    err.status = 400
    throw err
  }
  const config = requireConfig(provider)
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: session.oidcCodeVerifier,
    expectedState: session.oidcState,
    expectedNonce: session.oidcNonce,
  })
  const claims = tokens.claims()
  validateProviderClaims(provider, claims)
  return claims
}
