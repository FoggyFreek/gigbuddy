import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import type { DialogRequest } from '../contexts/dialogContext.ts'

// The catalogue of app-defined dialogs. A definition owns its copy and its
// buttons; call sites only say `openDialog('trial-ended')`, which is what keeps
// the dozens of one-off confirmation modals across the app from each shipping
// their own component.
//
// Ids are persisted by the "don't show this message again" store — never rename
// a shipped one.

/** What a destructive confirmation needs to say. Buttons are fixed by the definition. */
export interface ConfirmDeleteParams {
  /** Question in the title bar, e.g. "Delete this song?" — feature copy. */
  title: string
  /** Defaults to the shared "This cannot be undone." line. */
  body?: ReactNode
}

/** Params each registered dialog takes; `void` = none. Keys are the dialog ids. */
export interface DialogParams {
  'trial-ended': void
  'trial-grace': void
  'confirm-delete': ConfirmDeleteParams
}

export type DialogId = keyof DialogParams

export const DIALOG_IDS = {
  TRIAL_ENDED: 'trial-ended',
  TRIAL_GRACE: 'trial-grace',
  CONFIRM_DELETE: 'confirm-delete',
} as const satisfies Record<string, DialogId>

/** `dialogs` is the definitions' own namespace; `common` carries shared labels. */
export type DialogT = TFunction<['dialogs', 'common']>

export interface DialogDefinition<P> {
  build: (ctx: { t: DialogT; params: P }) => Omit<DialogRequest, 'id'>
}

export const DIALOG_REGISTRY: { [K in DialogId]: DialogDefinition<DialogParams[K]> } = {
  // The one destructive confirmation the whole app uses: same buttons, same
  // colour, same "cannot be undone" default wherever something gets deleted.
  // Reach for it through `confirmDelete()` rather than opening it by id.
  'confirm-delete': {
    build: ({ t, params }) => ({
      title: params.title,
      body: params.body ?? t($ => $.common.confirmation.cannotUndo),
      actions: [
        { id: 'cancel', label: t($ => $.common.actions.cancel) },
        {
          id: 'confirm',
          label: t($ => $.common.actions.delete),
          variant: 'contained',
          color: 'error',
          autoFocus: true,
        },
      ],
    }),
  },
  // Fires once the grace window has closed too: the modules are back on the
  // free fallback plan. The primary action drops the user straight into the
  // billing section of settings.
  'trial-ended': {
    build: ({ t }) => ({
      title: t($ => $.trialEnded.title),
      body: t($ => $.trialEnded.body),
      suppressible: true,
      actions: [
        { id: 'later', label: t($ => $.trialEnded.later) },
        {
          id: 'billing',
          label: t($ => $.trialEnded.cta),
          variant: 'contained',
          navigateTo: { settings: 'billing' },
          autoFocus: true,
        },
      ],
    }),
  },
  // The warning shot, raised during the grace window: the trial is over but the
  // resolver still unlocks its features and the modules have not fallen back to
  // the free plan yet, so there is still something to keep.
  'trial-grace': {
    build: ({ t }) => ({
      title: t($ => $.trialGrace.title),
      body: t($ => $.trialGrace.body),
      suppressible: true,
      actions: [
        { id: 'later', label: t($ => $.trialGrace.later) },
        {
          id: 'billing',
          label: t($ => $.trialGrace.cta),
          variant: 'contained',
          navigateTo: { settings: 'billing' },
          autoFocus: true,
        },
      ],
    }),
  },
}
