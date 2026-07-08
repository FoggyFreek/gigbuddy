// Post-login redirect stash. Survives the full-page OIDC round trip so a
// deep link (e.g. an invite URL carrying its code) can be replayed after
// sign-in. Both RequireAuth and the global 401 handler stash through here so
// the "never stash /login or /" rule stays in one place.
const KEY = 'gigbuddy:redirectAfterLogin'

export function stashRedirectAfterLogin(intended: string) {
  if (intended !== '/login' && intended !== '/') {
    localStorage.setItem(KEY, intended)
  }
}

// Reads and consumes the stash: replaying twice (or leaking a previous
// user's target into the next login) must be impossible.
export function takeRedirectAfterLogin(): string | null {
  const intended = localStorage.getItem(KEY)
  if (intended) localStorage.removeItem(KEY)
  return intended
}

export function clearRedirectAfterLogin() {
  localStorage.removeItem(KEY)
}
