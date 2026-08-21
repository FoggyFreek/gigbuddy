// Named places in the app, so callers that need to send the user somewhere can
// name the destination instead of hand-writing a URL. The dialog layer
// (src/dialogs) is the main consumer: a dialog action declares `navigateTo` and
// the provider resolves it to a path.
//
// The settings section ids live here rather than in SettingsPage so the page and
// everything that links into it share one owner — a renamed section is a compile
// error at every call site.

export const SETTINGS_SECTIONS = [
  'preferences', 'billing', 'connected-accounts', 'my-availability',
  'accent', 'members', 'storage',
  'integrations', 'chart-of-accounts', 'default-accounts',
  'financial-profile', 'accounting-profile', 'invoice-mode', 'delete-account',
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]

/** A destination: a settings section by name, or any route path. */
export type NavTarget = { settings: SettingsSectionId } | { path: string }

export const settingsPath = (section: SettingsSectionId) => `/settings/${section}`

export function navTargetPath(target: NavTarget): string {
  return 'settings' in target ? settingsPath(target.settings) : target.path
}
