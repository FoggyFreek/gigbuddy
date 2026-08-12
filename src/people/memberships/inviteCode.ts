// Invite links point at /redeem-invite?code=…, and people paste the whole URL
// rather than picking the code out of it. Accept either form.
//
// Purely client-side convenience: the server validates the code regardless.
export function parseInviteCode(input: string | null | undefined): string {
  const trimmed = String(input ?? '').trim()
  if (!trimmed) return ''
  // Only treat it as a URL when it plainly is one — a bare code must never be
  // reinterpreted (a code like "abc:def" is not a scheme).
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('/')
  if (!looksLikeUrl) return trimmed
  try {
    // The base only matters for relative paths; the code lives in the query.
    return new URL(trimmed, 'http://invite.local').searchParams.get('code')?.trim() ?? ''
  } catch {
    return trimmed
  }
}
