import * as client from 'openid-client'

let config

export async function initOidc() {
  config = await client.discovery(
    new URL('https://accounts.google.com'),
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )
}

export function getConfig() {
  return config
}

export async function buildAuthUrl(session) {
  const codeVerifier = client.randomPKCECodeVerifier()
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
  const state = client.randomState()
  const nonce = client.randomNonce()

  session.oidcCodeVerifier = codeVerifier
  session.oidcState = state
  session.oidcNonce = nonce

  return client.buildAuthorizationUrl(config, {
    redirect_uri: process.env.OIDC_REDIRECT_URI,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  })
}

export async function handleCallback(session, currentUrl) {
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: session.oidcCodeVerifier,
    expectedState: session.oidcState,
    expectedNonce: session.oidcNonce,
  })
  const claims = tokens.claims()
  if (claims.email_verified !== true) {
    const err = new Error('Email not verified by identity provider')
    err.status = 403
    throw err
  }
  return claims
}
