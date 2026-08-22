// Subscription statuses with a label under billing:status. `Subscription.status`
// is a plain string on the payload, so unknown values fall back to the raw value.
// Shared by the billing section and the settings summary card — one owner.
// Trial verification stays `trialing`; its open/pending state lives on the
// €0.01 payment row. Direct paid signup uses `pending_activation` until paid.
export const STATUS_KEYS = {
  pending_activation: 'pending_activation',
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
} as const

export type StatusKey = keyof typeof STATUS_KEYS
