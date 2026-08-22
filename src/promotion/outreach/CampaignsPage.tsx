import { useEffect, useState } from 'react'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useTranslation } from 'react-i18next'
import { usePermissions } from '../../hooks/usePermissions.ts'
import {
  addOutreachSuppression, getOutreachCampaign, listOutreachCampaigns, listOutreachSuppressions,
  removeOutreachSuppression, type OutreachCampaign, type OutreachRecipient, type OutreachSuppression,
} from './outreachCampaigns.ts'

export default function CampaignsPage() {
  const { t } = useTranslation('outreach')
  const { canWritePlanning } = usePermissions()
  const [tab, setTab] = useState<'history' | 'suppressions'>('history')
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([])
  const [selected, setSelected] = useState<OutreachCampaign | null>(null)
  const [suppressions, setSuppressions] = useState<OutreachSuppression[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void Promise.all([listOutreachCampaigns(), listOutreachSuppressions()]).then(([history, blocked]) => {
      setCampaigns(history.items); setSuppressions(blocked.items)
    }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [])
  const campaignColumns: GridColDef<OutreachCampaign>[] = [
    { field: 'id', headerName: t($ => $.campaigns.id), width: 90 },
    { field: 'status', headerName: t($ => $.campaigns.status), width: 140 },
    { field: 'created_at', headerName: t($ => $.campaigns.created), flex: 1, valueFormatter: (value) => new Date(String(value)).toLocaleString() },
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
  async function addSuppression() {
    try { const created = await addOutreachSuppression(email); setSuppressions((rows) => [created, ...rows]); setEmail('') }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }
  async function removeSuppression(row: OutreachSuppression) {
    await removeOutreachSuppression(row.id)
    setSuppressions((rows) => rows.filter((entry) => entry.id !== row.id))
  }
  return <Stack spacing={2}>
    <Typography variant="h5" sx={{ fontWeight: 600 }}>{t($ => $.campaigns.title)}</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    <Tabs value={tab} onChange={(_event, value: 'history' | 'suppressions') => setTab(value)}>
      <Tab value="history" label={t($ => $.campaigns.history)} /><Tab value="suppressions" label={t($ => $.campaigns.suppressions)} />
    </Tabs>
    {tab === 'history' && <>
      <DataGrid rows={campaigns} columns={campaignColumns} onRowClick={({ row }) => { void inspect(row) }} disableRowSelectionOnClick sx={{ minHeight: 300 }} />
      {selected && <Paper variant="outlined" sx={{ p: 2 }}><Typography variant="h6" sx={{ mb: 1 }}>{t($ => $.campaigns.review)}</Typography>
        <DataGrid rows={selected.recipients ?? []} columns={recipientColumns} hideFooter sx={{ minHeight: 240 }} />
      </Paper>}
    </>}
    {tab === 'suppressions' && <Paper variant="outlined" sx={{ p: 2 }}>
      {canWritePlanning && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
        <TextField type="email" size="small" label={t($ => $.campaigns.email)} value={email} onChange={(event) => setEmail(event.target.value)} />
        <Button startIcon={<AddIcon />} disabled={!email} onClick={() => { void addSuppression() }}>{t($ => $.campaigns.addSuppression)}</Button>
      </Stack>}
      <Stack>{suppressions.map((row) => <Box key={row.id} sx={{ display: 'flex', alignItems: 'center', borderTop: '1px solid', borderColor: 'divider', py: 1 }}>
        <Typography sx={{ flexGrow: 1 }}>{row.email} · {row.reason}</Typography>
        {canWritePlanning && <IconButton aria-label={t($ => $.campaigns.removeSuppression)} onClick={() => { void removeSuppression(row) }}><DeleteOutlineIcon /></IconButton>}
      </Box>)}</Stack>
    </Paper>}
  </Stack>
}
