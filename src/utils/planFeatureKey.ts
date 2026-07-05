// Maps a plan entitlement feature flag to its i18n leaf key under
// billing:features. Kept as a self-contained `as const` map (rather than
// derived from shared/entitlements.js, whose values widen to string) so the
// typed selector index `t($ => $.features[key])` stays a compile-time check.
// A new feature flag must be added here and in en/nl billing.json.
const PLAN_FEATURE_KEYS = {
  finance: 'finance',
  integrations: 'integrations',
  song_files: 'song_files',
  chordpro: 'chordpro',
  customization: 'customization',
  public_promotion: 'public_promotion',
} as const

export type PlanFeatureKey = keyof typeof PLAN_FEATURE_KEYS

export function planFeatureKey(feature: string): PlanFeatureKey | null {
  return feature in PLAN_FEATURE_KEYS ? (feature as PlanFeatureKey) : null
}
