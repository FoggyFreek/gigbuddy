// Source of truth for in-app notification types. Every dispatched notification
// and every type preference must use one of these. The frontend mirrors this
// list with localized labels (src/i18n notifications namespace).
export const NOTIFICATION_TYPES = Object.freeze([
  'gig-new',
  'gig-confirmed',
  'gig-import',
  'rehearsal-new',
  'rehearsal-confirmed',
  'invoice-paid',
  'task-assigned',
  'invite-redeemed',
])

// User-level billing notification types. Deliberately NOT in NOTIFICATION_TYPES:
// those drive the tenant-scoped preference UI and audience fan-out, whereas
// billing notices target the subscription owner directly and are always
// delivered (dispatchUserNotification bypasses prefs). The frontend labels
// these separately.
export const BILLING_NOTIFICATION_TYPES = Object.freeze({
  TRIAL_ENDING: 'billing-trial-ending',
  PAYMENT_FAILED: 'billing-payment-failed',
  RENEWED: 'billing-renewed',
  CANCELED: 'billing-canceled',
  PLAN_CHANGED: 'billing-plan-changed',
  DOWNGRADE_SCHEDULED: 'billing-downgrade-scheduled',
  COMPLIMENTARY_GRANTED: 'billing-complimentary-granted',
})
