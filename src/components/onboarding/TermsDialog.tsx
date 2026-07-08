import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { termsForLanguage } from '../../content/terms/index.ts'

interface TermsDialogProps {
  open: boolean
  onClose: () => void
}

// Read-only Terms & Conditions viewer. The document itself is a standalone
// per-language file (src/content/terms/), deliberately outside i18n.
export default function TermsDialog({ open, onClose }: Readonly<TermsDialogProps>) {
  const { t, i18n } = useTranslation('onboarding')
  const doc = termsForLanguage(i18n.language)

  return (
    <Dialog open={open} onClose={onClose} scroll="paper" fullWidth maxWidth="md">
      <DialogTitle>{doc.title}</DialogTitle>
      <DialogContent dividers>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {doc.draftNotice}
        </Alert>
        {doc.intro.map((paragraph) => (
          <Typography key={paragraph} variant="body2" sx={{ mb: 1.5 }}>
            {paragraph}
          </Typography>
        ))}
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 2, mb: 1 }}>
              {section.heading}
            </Typography>
            {section.paragraphs.map((paragraph) => (
              <Typography key={paragraph} variant="body2" sx={{ mb: 1.5 }}>
                {paragraph}
              </Typography>
            ))}
          </section>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t($ => $.terms.close)}</Button>
      </DialogActions>
    </Dialog>
  )
}
