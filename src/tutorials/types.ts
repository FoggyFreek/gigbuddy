import type { ComponentType } from 'react'
import type { Permission } from '../auth/permissions.ts'
import type { Feature } from '../auth/entitlements.ts'

// Synchronous signals a tutorial's `eligible` predicate reads. All are derivable
// from already-loaded state (permissions, plan, route) so eligibility is cheap.
// Extend this as new tutorials need more signals.
export interface TutorialContext {
  can: (permission: Permission) => boolean
  isSuperAdmin: boolean
  hasFeature: (feature: Feature) => boolean
  financeReadOnly: boolean
  pathname: string
}

// Props every tutorial card receives from the host.
export interface TutorialCardProps {
  // Persist the dismissal and close (the card's close / "maybe later" action).
  onDismiss: () => void
  // Dismiss, then navigate to `to` (a primary "get started" action).
  onAccept: (to: string) => void
}

// One registered tutorial. Add a tutorial by appending a TutorialDef to
// TUTORIALS (src/tutorials/registry.tsx) with its own Card and i18n copy — no
// backend change is needed for a purely informational tutorial.
export interface TutorialDef {
  // Stable slug persisted in user_tutorial_dismissals — NEVER rename a shipped key.
  key: string
  // Synchronous gate from already-loaded state. Return false to skip entirely.
  // Omitted = always eligible.
  eligible?: (ctx: TutorialContext) => boolean
  // Optional async precondition (e.g. "no opening balance yet"), run only after
  // `eligible` passes. Omitted = always true.
  condition?: () => Promise<boolean>
  // The overlay content (a self-contained MUI Dialog).
  Card: ComponentType<TutorialCardProps>
}
