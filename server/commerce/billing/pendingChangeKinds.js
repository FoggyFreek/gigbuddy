// The single declaration of what `subscription_modules.pending_change_kind`
// MEANS. Every semantic a call site used to re-derive from the string lives
// here, so adding a kind is one edit plus the DB constraint (migration 187,
// which regenerates its CHECK from this list).
//
//   bindsCapacity       — the target plan's numeric limits are frozen into
//                         pending_limits_snapshot and bind through the
//                         entitlement resolver from the moment the change is
//                         recorded. Without it a customer can grow past the
//                         target while the change is pending and land over it.
//   purges              — losing a feature at landing deletes data, so the
//                         change needs a frozen purge manifest and informed
//                         consent before it may be recorded.
//   landsAt             — 'payment' once its own (prorated) charge settles;
//                         'boundary' when the next cycle-opening charge does.
//   blocksOtherChanges  — 'always', or 'after_trial' for a change that is
//                         freely re-selectable while the subscription is still
//                         trialing but is an in-flight commitment afterwards.
export const PENDING_CHANGE_KINDS = Object.freeze({
  upgrade: Object.freeze({
    bindsCapacity: false, purges: false, landsAt: 'payment', blocksOtherChanges: 'always',
  }),
  downgrade: Object.freeze({
    bindsCapacity: true, purges: true, landsAt: 'boundary', blocksOtherChanges: 'always',
  }),
  remove: Object.freeze({
    bindsCapacity: true, purges: true, landsAt: 'boundary', blocksOtherChanges: 'always',
  }),
  // A trial's selected paid plan. It binds capacity like a downgrade — the
  // selection is checked against current usage once and then installed
  // unattended at the boundary, so nothing else may grow past it in between.
  // It purges nothing: the trial tier keeps granting its features until the
  // first charge lands the selected plan.
  trial_selection: Object.freeze({
    bindsCapacity: true, purges: false, landsAt: 'boundary', blocksOtherChanges: 'after_trial',
  }),
})

// Kinds a cycle-opening charge installs, for the boundary query's predicate.
export const BOUNDARY_KINDS = Object.freeze(
  Object.entries(PENDING_CHANGE_KINDS)
    .filter(([, spec]) => spec.landsAt === 'boundary')
    .map(([name]) => name),
)

// Does this module already carry a change that forbids recording another one?
// Unknown kinds fail CLOSED — a kind added to the DB without a declaration here
// blocks rather than silently behaving like an exempt one.
export function blocksNewChange(sub, module) {
  if (module.status === 'pending') return true
  const kind = module.pending_change_kind
  if (!kind) return false
  const spec = PENDING_CHANGE_KINDS[kind]
  if (!spec) return true
  switch (spec.blocksOtherChanges) {
    case 'always': return true
    case 'after_trial': return sub.status !== 'trialing'
    default: return true
  }
}

// Subscription-wide: a prorated charge must be unambiguously attributable to
// ONE change, so any module's in-flight change blocks a new one. A pending
// payment counts too — it is a change whose landing is not yet decided.
//
// Boundary changes are per-module (a customer may schedule one on each ladder),
// so that flow asks blocksNewChange about its own module instead.
export function changeInFlight(sub, modules) {
  if (sub.pending_payment_id) return true
  return modules.some((m) => blocksNewChange(sub, m))
}
