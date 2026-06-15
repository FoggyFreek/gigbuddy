// Shared route-matching rule for sidebar nav items. Dashboard ('/') matches
// exactly; every other item matches its own path or a sub-path. Matching is
// segment-aware (a '/' boundary) so a sibling route is not treated as a
// sub-page: '/ledger' matches '/ledger' and '/ledger/123' (the detail page) but
// NOT '/ledger-entries', which is its own nav item. Imported by AppShell (to
// resolve the active accordion group), NavGroup, and NavItem so the rule stays
// in one place.
export function isItemSelected(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}
