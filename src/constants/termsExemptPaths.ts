// Paths that own the terms-acceptance UX themselves (or ARE the acceptance
// page), so the terms gate lets them render instead of bouncing to it:
// onboarding records acceptance in its welcome step, invite redemption is
// pre-membership, and /accept-terms is the target itself.
//
// Shared by RequireAuth (the router gate) and the api _client (the response
// gate) so both skip the SAME surfaces — a divergence here is the latent trap
// where a gated call could hard-redirect away from a page mid-flow.
export const TERMS_EXEMPT_PATHS = new Set(['/accept-terms', '/onboarding', '/redeem-invite'])
