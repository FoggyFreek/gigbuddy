import type { TFunction } from 'i18next'
import type { DialogRequest } from '../contexts/dialogContext.ts'

// The catalogue of app-defined dialogs. A definition owns its copy and its
// buttons; call sites only say `openDialog('trial-ended')`, which is what keeps
// the dozens of one-off confirmation modals across the app from each shipping
// their own component.
//
// Ids are persisted by the "don't show this message again" store — never rename
// a shipped one.

/** Params each registered dialog takes; `void` = none. Keys are the dialog ids. */
export interface DialogParams {
  'trial-ended': void
  'trial-grace': void
}

export type DialogId = keyof DialogParams

export const DIALOG_IDS = {
  TRIAL_ENDED: 'trial-ended',
  TRIAL_GRACE: 'trial-grace',
} as const satisfies Record<string, DialogId>

/** `dialogs` is the definitions' own namespace; `common` carries shared labels. */
export type DialogT = TFunction<['dialogs', 'common']>

export interface DialogDefinition<P> {
  build: (ctx: { t: DialogT; params: P }) => Omit<DialogRequest, 'id'>
}

export const DIALOG_REGISTRY: { [K in DialogId]: DialogDefinition<DialogParams[K]> } = {
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
