import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import DownloadIcon from '@mui/icons-material/Download'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import { Link as RouterLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import EmailPreviewFrame from '../../../promotion/outreach/components/EmailPreviewFrame.tsx'
import type { PeppolWarning } from '../peppolReadiness.ts'
import type { UseInvoiceEmailActionsResult } from './useInvoiceEmailActions.ts'

interface Props extends UseInvoiceEmailActionsResult {
  isDraft: boolean
  peppolBlockers: PeppolWarning[]
}

const ATTACHMENT_MODES = ['pdf', 'pdf_xml', 'pdf_xml_embedded'] as const

export default function InvoiceEmailDialog({
  emailDialogOpen, closeEmailDialog,
  emailTemplates, emailTemplateId, setEmailTemplateId,
  emailMessage, setEmailMessage,
  emailAttachments, setEmailAttachments,
  emailMarkSent, setEmailMarkSent,
  emailPreviewHtml, emailPreviewSubject, emailPreviewLoading,
  emailLoading, emailBusy, emailError, senderConfigured,
  handleEmailDownload, handleEmailSend,
  isDraft, peppolBlockers,
}: Readonly<Props>) {
  const { t } = useTranslation(['invoices', 'common'])
  const hasTemplate = emailTemplates.length > 0
  const wantsXml = emailAttachments !== 'pdf'
  const actionsDisabled = emailLoading || emailBusy || !hasTemplate

  return (
    <Dialog open={emailDialogOpen} onClose={() => !emailBusy && closeEmailDialog()} fullWidth maxWidth="md">
      <DialogTitle>{t($ => $.emailDialog.title)}</DialogTitle>
      <DialogContent>
        {emailError && <Alert severity="error" sx={{ mb: 2 }}>{emailError}</Alert>}
        {emailLoading
          ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          : (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {!hasTemplate && (
                <Alert severity="info">
                  {t($ => $.emailDialog.noTemplate)}{' '}
                  <RouterLink to="/outreach/templates">{t($ => $.emailDialog.noTemplateLink)}</RouterLink>
                </Alert>
              )}

              {/* One template needs no choosing; several do. */}
              {emailTemplates.length > 1 && (
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={t($ => $.emailDialog.template)}
                  value={emailTemplateId ?? ''}
                  onChange={(event) => setEmailTemplateId(Number(event.target.value))}
                  disabled={emailBusy}
                  slotProps={{ select: { native: true } }}
                >
                  {emailTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </TextField>
              )}

              <TextField
                multiline
                fullWidth
                minRows={4}
                maxRows={10}
                label={t($ => $.emailDialog.message)}
                value={emailMessage}
                onChange={(event) => setEmailMessage(event.target.value)}
                disabled={emailBusy || !hasTemplate}
                helperText={t($ => $.emailDialog.helperText)}
              />

              <FormControl disabled={emailBusy || !hasTemplate}>
                <FormLabel id="invoice-email-attachments">{t($ => $.emailDialog.attachments.label)}</FormLabel>
                <RadioGroup
                  aria-labelledby="invoice-email-attachments"
                  value={emailAttachments}
                  onChange={(event) => setEmailAttachments(event.target.value as typeof ATTACHMENT_MODES[number])}
                >
                  {ATTACHMENT_MODES.map((mode) => (
                    <FormControlLabel
                      key={mode}
                      value={mode}
                      control={<Radio size="small" />}
                      label={t($ => $.emailDialog.attachments[mode])}
                    />
                  ))}
                </RadioGroup>
              </FormControl>

              {/* Advisory only — the XML is produced regardless, same as the download. */}
              {wantsXml && peppolBlockers.length > 0 && (
                <Alert severity="warning">
                  {t($ => $.ubl.notReadyIntro)}
                  <Box component="ul" sx={{ pl: 2, m: 0 }}>
                    {peppolBlockers.map((warning) => (
                      <li key={warning.code}>{t($ => $.ubl.warnings[warning.code])}</li>
                    ))}
                  </Box>
                </Alert>
              )}

              {isDraft && (
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={emailMarkSent}
                      onChange={(event) => setEmailMarkSent(event.target.checked)}
                      disabled={emailBusy || !hasTemplate}
                    />
                  )}
                  label={t($ => $.emailDialog.markSent)}
                />
              )}

              {hasTemplate && (
                <EmailPreviewFrame
                  title={t($ => $.emailDialog.preview)}
                  subject={emailPreviewSubject}
                  html={emailPreviewHtml}
                  loading={emailPreviewLoading}
                />
              )}
            </Stack>
          )}
      </DialogContent>
      <DialogActions>
        <Button onClick={closeEmailDialog} disabled={emailBusy}>{t($ => $.common.actions.cancel)}</Button>
        <Button
          startIcon={<DownloadIcon />}
          onClick={() => { void handleEmailDownload() }}
          disabled={actionsDisabled}
        >
          {t($ => $.emailDialog.download)}
        </Button>
        {senderConfigured && (
          <Button
            variant="contained"
            startIcon={emailBusy ? <CircularProgress size={16} color="inherit" /> : <SendOutlinedIcon />}
            onClick={() => { void handleEmailSend() }}
            disabled={actionsDisabled}
          >
            {t($ => $.emailDialog.send)}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
