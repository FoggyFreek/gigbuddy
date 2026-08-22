import { useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import { useTranslation } from 'react-i18next'
import EmailLogSection from './EmailLogSection.tsx'
import SuppressionsSection from './SuppressionsSection.tsx'

interface Props {
  open: boolean
  onClose: () => void
}

type View = 'log' | 'suppressions'

// What was sent through Resend, and what must never be sent again — the two
// read-and-tidy views that belong to the credential rather than to a page. A
// dedicated component rather than the dialog registry: both views own real
// content (grids, a form), not a confirm/cancel question.
export default function ResendActivityDialog({ open, onClose }: Readonly<Props>) {
  const { t } = useTranslation(['outreach', 'common'])
  const [view, setView] = useState<View>('log')

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{t($ => $.campaigns.activityTitle)}</DialogTitle>
      <DialogContent>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={view}
          onChange={(_event, next: View | null) => { if (next) setView(next) }}
          aria-label={t($ => $.campaigns.activityTitle)}
          sx={{ mb: 2 }}
        >
          <ToggleButton value="log">{t($ => $.campaigns.logTitle)}</ToggleButton>
          <ToggleButton value="suppressions">{t($ => $.campaigns.suppressions)}</ToggleButton>
        </ToggleButtonGroup>
        {view === 'log' ? <EmailLogSection /> : <SuppressionsSection />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t($ => $.common.actions.close)}</Button>
      </DialogActions>
    </Dialog>
  )
}
