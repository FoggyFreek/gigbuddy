import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { NavTarget } from '../app/navTargets.ts'
import type { DialogId, DialogParams } from '../dialogs/dialogRegistry.ts'

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

export const DialogContext = createContext<DialogContextValue | null>(null)

/** Throws outside a DialogProvider — a silently missing dialog is worse. */
export function useDialog(): DialogContextValue {
  const value = useContext(DialogContext)
  if (!value) throw new Error('useDialog must be used within a DialogProvider')
  return value
}
