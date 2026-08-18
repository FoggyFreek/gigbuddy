import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import { DialogContext } from './dialogContext.ts'
import type {
  ConfirmOptions, DialogAction, DialogContextValue, DialogOutcome, DialogRequest,
} from './dialogContext.ts'
import { DIALOG_REGISTRY } from '../dialogs/dialogRegistry.ts'
import type { DialogDefinition, DialogId, DialogParams } from '../dialogs/dialogRegistry.ts'
import { isDialogSuppressed, resetDialogSuppression, suppressDialog } from '../dialogs/dialogSuppression.ts'
import { navTargetPath } from '../app/navTargets.ts'
import type { NavTarget } from '../app/navTargets.ts'

interface QueueEntry {
  request: DialogRequest
  resolve: (outcome: DialogOutcome) => void
}

interface DialogProviderProps {
  children: ReactNode
}

/**
 * One modal host for the whole app. Requests queue, so a dialog raised while
 * another is open waits its turn instead of replacing it, and the queue is
 * mirrored in a ref because `showDialog` must dedupe by id at call time (React
 * state is a render behind).
 */
export function DialogProvider({ children }: Readonly<DialogProviderProps>) {
  const { t } = useTranslation(['dialogs', 'common'])
  const navigate = useNavigate()
  const queueRef = useRef<QueueEntry[]>([])
  const [queue, setQueue] = useState<QueueEntry[]>([])
  // The entry on screen is only dropped once the close transition has finished,
  // so the fade-out keeps its content. `closing` holds the host shut until then;
  // without it the head of the queue would re-open the dialog it is closing and
  // the exit would never complete.
  const [closing, setClosing] = useState(false)
  const [suppressChecked, setSuppressChecked] = useState(false)

  const current = queue[0] ?? null
  const open = current !== null && !closing

  const showDialog = useCallback((request: DialogRequest) => new Promise<DialogOutcome>((resolve) => {
    if (request.suppressible && isDialogSuppressed(request.id)) {
      resolve(null)
      return
    }
    if (queueRef.current.some((entry) => entry.request.id === request.id)) {
      resolve(null)
      return
    }
    queueRef.current = [...queueRef.current, { request, resolve }]
    setQueue(queueRef.current)
  }), [])

  // Resolve the entry on screen and start the close transition. The entry is
  // dropped in onExited so nothing flashes mid-fade.
  const finish = useCallback((outcome: DialogOutcome) => {
    const entry = queueRef.current[0]
    if (!entry) return
    if (entry.request.suppressible && suppressChecked) suppressDialog(entry.request.id)
    entry.resolve(outcome)
    setClosing(true)
  }, [suppressChecked])

  const handleExited = useCallback(() => {
    queueRef.current = queueRef.current.slice(1)
    setQueue(queueRef.current)
    setSuppressChecked(false)
    setClosing(false)
  }, [])

  const navigateTo = useCallback((target: NavTarget) => {
    navigate(navTargetPath(target))
  }, [navigate])

  const handleAction = useCallback(async (action: DialogAction) => {
    await action.onClick?.()
    if (action.navigateTo) navigateTo(action.navigateTo)
    if (!action.keepOpen) finish(action.id)
  }, [finish, navigateTo])

  const confirm = useCallback((options: ConfirmOptions) => showDialog({
    id: options.id ?? `confirm:${options.title}`,
    title: options.title,
    body: options.body,
    suppressible: options.suppressible,
    actions: [
      { id: 'cancel', label: options.cancelLabel ?? t($ => $.common.actions.cancel) },
      {
        id: 'confirm',
        label: options.confirmLabel ?? t($ => $.common.actions.confirm),
        variant: 'contained',
        color: options.destructive ? 'error' : 'primary',
        autoFocus: true,
      },
    ],
  }).then((outcome) => outcome === 'confirm'), [showDialog, t])

  const openDialog = useCallback(<K extends DialogId>(
    id: K,
    ...args: DialogParams[K] extends void ? [] : [DialogParams[K]]
  ) => {
    const definition: DialogDefinition<DialogParams[K]> = DIALOG_REGISTRY[id]
    return showDialog({ id, ...definition.build({ t, params: args[0] as DialogParams[K] }) })
  }, [showDialog, t])

  const value = useMemo<DialogContextValue>(() => ({
    showDialog,
    confirm,
    openDialog,
    closeDialog: () => finish(null),
    navigateTo,
    isDialogSuppressed,
    resetDialogSuppression,
  }), [showDialog, confirm, openDialog, finish, navigateTo])

  return (
    <DialogContext.Provider value={value}>
      {children}
      <Dialog
        open={open}
        onClose={() => finish(null)}
        maxWidth={current?.request.maxWidth ?? 'xs'}
        fullWidth
        slotProps={{ transition: { onExited: handleExited } }}
      >
        <DialogTitle>{current?.request.title}</DialogTitle>
        {current?.request.body !== undefined && (
          <DialogContent>
            {typeof current.request.body === 'string'
              ? <DialogContentText>{current.request.body}</DialogContentText>
              : current.request.body}
          </DialogContent>
        )}
        <DialogActions sx={{ flexWrap: 'wrap', justifyContent: 'space-between', px: 3, pb: 2 }}>
          {current?.request.suppressible ? (
            <FormControlLabel
              control={(
                <Checkbox
                  size="small"
                  checked={suppressChecked}
                  onChange={(event) => setSuppressChecked(event.target.checked)}
                />
              )}
              label={t($ => $.dontShowAgain)}
              slotProps={{ typography: { variant: 'body2' } }}
            />
          ) : <span />}
          <span>
            {current?.request.actions.map((action) => (
              <Button
                key={action.id}
                onClick={() => { void handleAction(action) }}
                variant={action.variant}
                color={action.color}
                autoFocus={action.autoFocus}
                sx={{ ml: 1 }}
              >
                {action.label}
              </Button>
            ))}
          </span>
        </DialogActions>
      </Dialog>
    </DialogContext.Provider>
  )
}
