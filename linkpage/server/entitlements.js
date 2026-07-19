// Plan entitlements for a page, read from the content snapshot GigBuddy
// embeds in every export (`content.entitlements`). GigBuddy's plan tiers are
// the source of truth; this module only normalizes what a snapshot carries.
//
// A snapshot without entitlements (pre-upgrade page, or an ownerless legacy
// band whose enforcement is skipped) stays enabled with defaults.

export const DEFAULT_STATS_RETENTION_DAYS = 30
export const MAX_STATS_RETENTION_DAYS = 90

export function pageEntitlements(content) {
  const raw = content?.entitlements
  if (!raw || typeof raw !== 'object') {
    return { enabled: true, maxReleasePages: null, statsRetentionDays: DEFAULT_STATS_RETENTION_DAYS }
  }
  const days = Number(raw.statsRetentionDays)
  return {
    enabled: raw.enabled !== false,
    maxReleasePages: Number.isInteger(raw.maxReleasePages) && raw.maxReleasePages >= 0
      ? raw.maxReleasePages
      : null,
    // The rolling statistics window is 30 or 90 days, never anything else.
    statsRetentionDays: days >= MAX_STATS_RETENTION_DAYS
      ? MAX_STATS_RETENTION_DAYS
      : DEFAULT_STATS_RETENTION_DAYS,
  }
}
