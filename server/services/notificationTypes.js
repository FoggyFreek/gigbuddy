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
])
