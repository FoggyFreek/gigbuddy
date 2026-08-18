import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { NavTarget } from '../app/navTargets.ts'
import { isDialogSuppressed, resetDialogSuppression } from '../dialogs/dialogSuppression.ts'
import type { ConfirmDeleteParams, DialogId, DialogParams } from '../dialogs/dialogRegistry.ts'

/** One button in the dialog's action row. Labels arrive already translated. */
export interface DialogAction {
  /**
   * Identifies the click to the caller — `showDialog()` resolves with it.
   * `confirm()` relies on the ids `confirm` / `cancel`.
   */
  id: string
  label: string
  /** Where clicking sends the user. Applied after `onClick` settles. */
  navigateTo?: NavTarget
  onClick?: () => void | Promise<void>
  variant?: 'text' | 'outlined' | 'contained'
  color?: 'primary' | 'secondary' | 'error' | 'inherit'
  /** Leave the dialog open after the click (default: close it). */
  keepOpen?: boolean
  autoFocus?: boolean
}

export interface DialogRequest {
  /**
   * Stable identity. It dedupes a dialog already queued AND doubles as the
   * "don't show this again" storage key, so never rename a shipped id.
   */
  id: string
  title: string
  body?: ReactNode
  actions: DialogAction[]
  /** Offer a "don't show this message again" checkbox (persisted per id). */
  suppressible?: boolean
  maxWidth?: 'xs' | 'sm' | 'md'
}

export interface ConfirmOptions {
  /** Only needed when the confirmation is suppressible; defaults to the title. */
  id?: string
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Renders the confirm button in `error` colour. */
  destructive?: boolean
  suppressible?: boolean
}

/** The clicked action's id, or null when the dialog was dismissed or suppressed. */
export type DialogOutcome = string | null

/**
 * Params are optional exactly when the registered dialog takes none, so
 * `openDialog('trial-ended')` type-checks while a parameterised dialog cannot
 * be opened without its params.
 */
type OpenArgs<K extends DialogId> = DialogParams[K] extends void ? [] : [DialogParams[K]]

export interface DialogContextValue {
  /** Queue an ad-hoc dialog. Resolves once it closes. */
  showDialog: (request: DialogRequest) => Promise<DialogOutcome>
  /** Shorthand for the cancel/confirm pair that most call sites need. */
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /**
   * The destructive confirmation every delete goes through — one owner for the
   * wording of the buttons and the danger colour. Resolves true when confirmed.
   */
  confirmDelete: (params: ConfirmDeleteParams) => Promise<boolean>
  /** Open a dialog defined in the registry, by id. */
  openDialog: <K extends DialogId>(id: K, ...args: OpenArgs<K>) => Promise<DialogOutcome>
  /** Close the dialog on screen (resolves it as dismissed). */
  closeDialog: () => void
  /** Send the user to a named settings section or any route path. */
  navigateTo: (target: NavTarget) => void
  isDialogSuppressed: (id: string) => boolean
  /** Clear one suppression, or all of them when called without an id. */
  resetDialogSuppression: (id?: string) => void
}

/**
 * Fallback used when there is no DialogProvider above the caller. Rendering is
 * allowed — plenty of components hold a delete affordance nobody clicks, and a
 * unit test of one should not have to mount the whole dialog stack. Opening a
 * dialog, on the other hand, is a real bug: it throws where the mistake is,
 * rather than silently doing nothing (the difference from `useToast()`, whose
 * missing provider only costs a message).
 */
function noProvider(): never {
  throw new Error('useDialog: no DialogProvider above this component (see src/main.tsx)')
}

const NO_PROVIDER: DialogContextValue = {
  showDialog: noProvider,
  confirm: noProvider,
  confirmDelete: noProvider,
  openDialog: noProvider,
  closeDialog: noProvider,
  navigateTo: noProvider,
  // Suppression is plain localStorage, so it answers honestly either way — and
  // a watcher can decide to stay quiet without a provider being mounted.
  isDialogSuppressed,
  resetDialogSuppression,
}

export const DialogContext = createContext<DialogContextValue>(NO_PROVIDER)

export function useDialog(): DialogContextValue {
  return useContext(DialogContext)
}
