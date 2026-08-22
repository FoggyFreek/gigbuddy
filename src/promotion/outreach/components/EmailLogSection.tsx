import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useTranslation } from 'react-i18next'
import {
  getOutreachCampaign, listOutreachCampaigns,
  type CampaignType, type OutreachCampaign, type OutreachRecipient,
} from '../outreachCampaigns.ts'

type Filter = 'all' | CampaignType

// Everything listed here was delivered through Resend, so the log lives with the
// Resend credential rather than on the outreach page — invoice mail never
// appears under "campaigns" anywhere else. Rendered inside ResendActivityDialog,
// which owns the heading.
export default function EmailLogSection() {
  const { t } = useTranslation('outreach')
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([])
  const [selected, setSelected] = useState<OutreachCampaign | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listOutreachCampaigns(100, filter === 'all' ? undefined : filter)
      .then((history) => { if (!cancelled) { setCampaigns(history.items); setSelected(null) } })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => { cancelled = true }
  }, [filter])

  const campaignColumns: GridColDef<OutreachCampaign>[] = [
    { field: 'id', headerName: t($ => $.campaigns.id), width: 80 },
    {
      field: 'type',
      headerName: t($ => $.campaigns.type),
      width: 120,
      valueFormatter: (value) => t($ => $.campaigns.types[String(value) as CampaignType]),
    },
    { field: 'status', headerName: t($ => $.campaigns.status), width: 120 },
    {
      field: 'created_at',
      headerName: t($ => $.campaigns.created),
      flex: 1,
      valueFormatter: (value) => new Date(String(value)).toLocaleString(),
    },
  ]
  const recipientColumns: GridColDef<OutreachRecipient>[] = [
    { field: 'to_name', headerName: t($ => $.campaigns.recipient), flex: 1 },
    { field: 'to_email', headerName: t($ => $.campaigns.email), flex: 1 },
    { field: 'merged_subject', headerName: t($ => $.table.subject), flex: 2 },
    { field: 'status', headerName: t($ => $.campaigns.status), width: 120 },
    { field: 'error_message', headerName: t($ => $.campaigns.issue), flex: 1 },
  ]

  async function inspect(campaign: OutreachCampaign) {
    try { setSelected(await getOutreachCampaign(campaign.id)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t($ => $.campaigns.logDescription)}
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Stack spacing={2}>
        <TextField
          select
          size="small"
          label={t($ => $.campaigns.type)}
          value={filter}
          onChange={(event) => setFilter(event.target.value as Filter)}
          sx={{ maxWidth: 240 }}
          slotProps={{ select: { native: true } }}
        >
          <option value="all">{t($ => $.campaigns.types.all)}</option>
          <option value="outreach">{t($ => $.campaigns.types.outreach)}</option>
          <option value="invoice">{t($ => $.campaigns.types.invoice)}</option>
        </TextField>
        <DataGrid
          rows={campaigns}
          columns={campaignColumns}
          onRowClick={({ row }) => { void inspect(row) }}
          disableRowSelectionOnClick
          sx={{ minHeight: 280 }}
        />
        {selected && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t($ => $.campaigns.review)}</Typography>
            <DataGrid rows={selected.recipients ?? []} columns={recipientColumns} hideFooter sx={{ minHeight: 200 }} />
          </Paper>
        )}
      </Stack>
    </Box>
  )
}
