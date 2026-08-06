// Subscription statuses with a label under billing:status. `Subscription.status`
// is a plain string on the payload, so unknown values fall back to the raw value.
// Shared by the billing section and the settings summary card — one owner.
export const STATUS_KEYS = {
  pending_mandate: 'pending_mandate',
  pending_activation: 'pending_activation',
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
} as const

export type StatusKey = keyof typeof STATUS_KEYS
