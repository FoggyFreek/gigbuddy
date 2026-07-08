// Client mirror of the server's slugFromBandName (server/validators/
// tenantValidators.js) — used only for the live slug preview during
// onboarding. The server remains authoritative and may append a -2/-3…
// dedupe suffix, so previews carry a "may get a suffix" caveat.
const SLUG_BASE_MAX = 56

export function slugFromBandName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/, '')
  return base || 'band'
}
