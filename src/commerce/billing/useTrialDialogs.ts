import { useEffect, useRef } from 'react'
import { useAuth } from '../../contexts/authContext.ts'
import { useDialog } from '../../contexts/dialogContext.ts'
import { DIALOG_IDS } from '../../dialogs/dialogRegistry.ts'
import type { DialogId } from '../../dialogs/dialogRegistry.ts'
import { getBillingState } from './billing.ts'
import { trialPhase } from './trialStatus.ts'
import type { TrialPhase } from './trialStatus.ts'

// Inside the grace window the user still HAS the trial features, so the prompt
// warns; once the modules have fallen back to the free plan it reports.
const DIALOG_FOR_PHASE: Record<Exclude<TrialPhase, null>, DialogId> = {
  grace: DIALOG_IDS.TRIAL_GRACE,
  ended: DIALOG_IDS.TRIAL_ENDED,
}

/**
 * Raises the trial dialog matching the user's trial phase, once per session.
 * Mounted by AppDialogs at the composition root.
 *
 * Suppression is checked before the request, so a user who ticked "don't show
 * again" on both prompts costs nothing at all.
 */
export function useTrialDialogs() {
  const { user } = useAuth()
  const { openDialog, isDialogSuppressed } = useDialog()
  const asked = useRef(false)
  const userId = user?.id

  useEffect(() => {
    if (!userId || asked.current) return
    const phases = Object.entries(DIALOG_FOR_PHASE)
      .filter(([, dialogId]) => !isDialogSuppressed(dialogId))
    if (phases.length === 0) return
    asked.current = true
    getBillingState()
      .then((state) => {
        const phase = trialPhase(state)
        if (phase) void openDialog(DIALOG_FOR_PHASE[phase])
      })
      .catch(() => {
        // Billing being unreachable is never a reason to interrupt the user.
      })
  }, [userId, openDialog, isDialogSuppressed])
}
