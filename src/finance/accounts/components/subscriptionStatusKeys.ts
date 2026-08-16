// Subscription statuses with a label under billing:status. `Subscription.status`
// is a plain string on the payload, so unknown values fall back to the raw value.
// Shared by the billing section and the settings summary card — one owner.
// 'pending_mandate' is gone: conversion's first charge takes the real amount AND
// establishes the mandate, so there is no separate verification state.
export const STATUS_KEYS = {
  pending_activation: 'pending_activation',
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
} as const

export type StatusKey = keyof typeof STATUS_KEYS
