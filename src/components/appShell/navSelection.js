// Shared route-matching rule for sidebar nav items. Dashboard ('/') matches
// exactly; every other item matches by path prefix. Imported by AppShell (to
// resolve the active accordion group), NavGroup, and NavItem so the rule stays
// in one place.
export function isItemSelected(to, pathname) {
  return to === '/' ? pathname === '/' : pathname.startsWith(to)
}
