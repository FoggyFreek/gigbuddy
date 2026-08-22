// Source of truth for in-app notification types. Every dispatched notification
// and every type preference must use one of these. The frontend mirrors this
// list with localized labels (src/i18n notifications namespace).
export const NOTIFICATION_TYPES = Object.freeze([
  'gig-new',
  'gig-confirmed',
  'gig-import',
  'rehearsal-new',
  'rehearsal-confirmed',
  'option-member-unavailable',
  'option-all-responded',
  'invoice-paid',
  'task-assigned',
  'invite-redeemed',
  'membership-requested',
  'achievement-unlocked',
  // A band an artist tags events against has arrived on gigbuddy.
  'band-profile-claimed',
  // A super admin approved or rejected this band's claim.
  'band-profile-claim-decided',
])

// User-level billing notification types. Deliberately NOT in NOTIFICATION_TYPES:
// those drive the tenant-scoped preference UI and audience fan-out, whereas
// billing notices target the subscription owner directly and are always
// delivered (dispatchUserNotification bypasses prefs). The frontend labels
// these separately.
export const BILLING_NOTIFICATION_TYPES = Object.freeze({
  TRIAL_ENDING: 'billing-trial-ending',
  PAYMENT_FAILED: 'billing-payment-failed',
  // The first combined charge settled — the trial converted into a paid cycle.
  ACTIVATED: 'billing-activated',
  // Advance notice of the combined renewal charge (T-7 and T-1 share the type;
  // the dedupe key carries the period end and the offset).
  RENEWAL_UPCOMING: 'billing-renewal-upcoming',
  RENEWED: 'billing-renewed',
  CANCELED: 'billing-canceled',
  PLAN_CHANGED: 'billing-plan-changed',
  DOWNGRADE_SCHEDULED: 'billing-downgrade-scheduled',
  COMPLIMENTARY_GRANTED: 'billing-complimentary-granted',
  REFUNDED: 'billing-refunded',
})
