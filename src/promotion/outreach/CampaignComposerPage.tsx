import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { Id } from '../../types/entities.ts'
import {
  createOutreachCampaign, sendOutreachCampaign, type CampaignRecipientInput,
  type OutreachCampaign, type OutreachRecipient,
} from './outreachCampaigns.ts'
import { listOutreachTemplates, type OutreachTemplate } from './outreachTemplates.ts'

interface ComposerState { recipients?: CampaignRecipientInput[]; contractId?: Id }

export default function CampaignComposerPage() {
  const { t } = useTranslation('outreach')
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as ComposerState
  const recipients = state.recipients ?? []
  const [templates, setTemplates] = useState<OutreachTemplate[]>([])
  const [templateId, setTemplateId] = useState<number | ''>('')
  const [campaign, setCampaign] = useState<OutreachCampaign | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void listOutreachTemplates().then(({ items }) => {
      setTemplates(items); setTemplateId(Number(items[0]?.id) || '')
    }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [])
  async function review() {
    if (!templateId || !recipients.length) return
    setBusy(true); setError(null)
    try { setCampaign(await createOutreachCampaign({ templateId, recipients, ...(state.contractId ? { contractId: state.contractId } : {}) })) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }
  async function send() {
    if (!campaign) return
    setBusy(true); setError(null)
    try { await sendOutreachCampaign(campaign.id); navigate('/outreach/campaigns') }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setBusy(false) }
  }
  const columns: GridColDef<OutreachRecipient>[] = [
    { field: 'to_name', headerName: t($ => $.campaigns.recipient), flex: 1 },
    { field: 'to_email', headerName: t($ => $.campaigns.email), flex: 1 },
    { field: 'merged_subject', headerName: t($ => $.table.subject), flex: 2 },
    { field: 'status', headerName: t($ => $.campaigns.status), width: 120 },
    { field: 'error_message', headerName: t($ => $.campaigns.issue), flex: 1 },
  ]
  return <Stack spacing={2}>
    <Typography variant="h5" sx={{ fontWeight: 600 }}>{t($ => $.composer.title)}</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {!recipients.length && <Alert severity="warning">{t($ => $.composer.noRecipients)}</Alert>}
    {!campaign && <>
      <TextField select label={t($ => $.composer.template)} value={templateId} onChange={(event) => setTemplateId(Number(event.target.value))} sx={{ maxWidth: 480 }}>
        {templates.map((template) => <MenuItem key={template.id} value={template.id}>{template.name}</MenuItem>)}
      </TextField>
      <Button variant="contained" disabled={busy || !templateId || !recipients.length} onClick={() => { void review() }} sx={{ alignSelf: 'flex-start' }}>{t($ => $.composer.review)}</Button>
    </>}
    {campaign && <>
      <Alert severity="info">{t($ => $.composer.reviewNotice)}</Alert>
      <DataGrid rows={campaign.recipients ?? []} columns={columns} disableRowSelectionOnClick sx={{ minHeight: 320 }} />
      <Button variant="contained" disabled={busy || !(campaign.recipients ?? []).some((row) => row.status === 'pending')} onClick={() => { void send() }} sx={{ alignSelf: 'flex-start' }}>{t($ => $.composer.send)}</Button>
    </>}
  </Stack>
}
