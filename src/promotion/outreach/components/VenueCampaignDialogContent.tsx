import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useTranslation } from 'react-i18next'
import type { Id, Venue } from '../../../types/entities.ts'
import {
  createOutreachCampaign,
  sendOutreachCampaign,
  type CampaignRecipientInput,
  type OutreachCampaign,
  type OutreachRecipient,
} from '../outreachCampaigns.ts'
import { listOutreachTemplates, type OutreachTemplate } from '../outreachTemplates.ts'

type AddressSource = 'primary_contact' | 'venue'

interface Props {
  venues: Venue[]
  onClose: () => void
}

export default function VenueCampaignDialogContent({ venues, onClose }: Readonly<Props>) {
  const { t } = useTranslation(['outreach', 'common'])
  const [templates, setTemplates] = useState<OutreachTemplate[] | null>(null)
  const [templateId, setTemplateId] = useState<Id | ''>('')
  const [addressSource, setAddressSource] = useState<AddressSource>('primary_contact')
  const [campaign, setCampaign] = useState<OutreachCampaign | null>(null)
  const [busy, setBusy] = useState(false)
  const [deliveryStatus, setDeliveryStatus] = useState<'sent' | 'partial' | 'failed' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listOutreachTemplates().then(({ items }) => {
      if (cancelled) return
      setTemplates(items)
      setTemplateId(items[0]?.id ?? '')
    }).catch((caught) => {
      if (!cancelled) {
        setTemplates([])
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    })
    return () => { cancelled = true }
  }, [])

  const recipientInputs: CampaignRecipientInput[] = venues.flatMap((venue) => {
    if (venue.id === undefined) return []
    return [{
      venueId: venue.id,
      ...(venue.primary_contact_id ? { contactId: venue.primary_contact_id } : {}),
      addressSource,
    }]
  })

  async function review() {
    if (!templateId || !recipientInputs.length) return
    setBusy(true)
    setError(null)
    try {
      setCampaign(await createOutreachCampaign({ templateId, recipients: recipientInputs }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    if (!campaign) return
    setBusy(true)
    setError(null)
    try {
      const result = await sendOutreachCampaign(campaign.id)
      setCampaign(result)
      setDeliveryStatus(result.status === 'sent' || result.status === 'partial' ? result.status : 'failed')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const columns: GridColDef<OutreachRecipient>[] = [
    { field: 'to_name', headerName: t($ => $.campaigns.recipient), flex: 1, minWidth: 140 },
    { field: 'to_email', headerName: t($ => $.campaigns.email), flex: 1, minWidth: 190 },
    { field: 'merged_subject', headerName: t($ => $.table.subject), flex: 1.5, minWidth: 180 },
    { field: 'status', headerName: t($ => $.campaigns.status), width: 100 },
    { field: 'error_message', headerName: t($ => $.campaigns.issue), flex: 1, minWidth: 150 },
  ]

  return (
    <Stack spacing={2}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t($ => $.venueDialog.selection, { count: venues.length })}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {deliveryStatus === 'sent' && <Alert severity="success">{t($ => $.venueDialog.sent)}</Alert>}
      {deliveryStatus === 'partial' && <Alert severity="warning">{t($ => $.venueDialog.partial)}</Alert>}
      {deliveryStatus === 'failed' && <Alert severity="error">{t($ => $.venueDialog.failed)}</Alert>}
      {!campaign && (
        <>
          {templates === null ? <CircularProgress size={24} /> : (
            <TextField
              select
              fullWidth
              size="small"
              label={t($ => $.composer.template)}
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              disabled={!templates.length}
            >
              {templates.map((template) => <MenuItem key={template.id} value={template.id}>{template.name}</MenuItem>)}
            </TextField>
          )}
          {templates?.length === 0 && <Alert severity="warning">{t($ => $.venueDialog.noTemplates)}</Alert>}
          <FormControl>
            <FormLabel>{t($ => $.venueDialog.addressSource)}</FormLabel>
            <RadioGroup
              row
              value={addressSource}
              onChange={(event) => setAddressSource(event.target.value as AddressSource)}
            >
              <FormControlLabel value="primary_contact" control={<Radio />} label={t($ => $.venueDialog.primaryContact)} />
              <FormControlLabel value="venue" control={<Radio />} label={t($ => $.venueDialog.venueAddress)} />
            </RadioGroup>
          </FormControl>
        </>
      )}
      {campaign && (
        <>
          {!deliveryStatus && <Alert severity="info">{t($ => $.composer.reviewNotice)}</Alert>}
          <DataGrid
            rows={campaign.recipients ?? []}
            columns={columns}
            disableRowSelectionOnClick
            hideFooter={(campaign.recipients ?? []).length <= 100}
            sx={{ minHeight: 280 }}
          />
        </>
      )}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{t($ => $.actions.close, { ns: 'common' })}</Button>
        {!campaign && (
          <Button variant="contained" disabled={busy || !templateId || !recipientInputs.length} onClick={() => { void review() }}>
            {t($ => $.composer.review)}
          </Button>
        )}
        {campaign && !deliveryStatus && (
          <Button
            variant="contained"
            disabled={busy || !(campaign.recipients ?? []).some((recipient) => recipient.status === 'pending')}
            onClick={() => { void send() }}
          >
            {t($ => $.composer.send)}
          </Button>
        )}
      </Stack>
    </Stack>
  )
}
