import { useEffect, useState } from 'react'
import AddIcon from '@mui/icons-material/Add'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { DataGrid, type GridColDef } from '@mui/x-data-grid'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useDialog } from '../../contexts/dialogContext.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import CreateTemplateDialog from './components/CreateTemplateDialog.tsx'
import {
  copyOutreachTemplate,
  deleteOutreachTemplate,
  listOutreachTemplates,
  type OutreachTemplate,
} from './outreachTemplates.ts'

export default function TemplatesPage() {
  const { t } = useTranslation('outreach')
  const navigate = useNavigate()
  const { confirm, confirmDelete } = useDialog()
  const { canWritePlanning } = usePermissions()
  const [rows, setRows] = useState<OutreachTemplate[] | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    let cancelled = false
    void listOutreachTemplates().then((result) => {
      if (!cancelled) setRows(result.items)
    })
    return () => { cancelled = true }
  }, [])
  const loading = rows === null

  const handleCopy = async (template: OutreachTemplate) => {
    const approved = await confirm({
      id: `copy-outreach-template:${template.id}`,
      title: t($ => $.actions.copyTitle, { name: template.name }),
      body: t($ => $.actions.copyBody),
      confirmLabel: t($ => $.actions.copyConfirm),
    })
    if (!approved) return
    const copied = await copyOutreachTemplate(template.id)
    setRows((current) => current ? [copied, ...current] : current)
  }

  const handleDelete = async (template: OutreachTemplate) => {
    const approved = await confirmDelete({
      title: t($ => $.actions.deleteTitle, { name: template.name }),
    })
    if (!approved) return
    await deleteOutreachTemplate(template.id)
    setRows((current) => current?.filter(({ id }) => id !== template.id) ?? current)
  }

  const localeLabels = {
    en: t($ => $.locales.en),
    nl: t($ => $.locales.nl),
  }
  const contextLabels = {
    venue: t($ => $.contexts.venue),
    invoice: t($ => $.contexts.invoice),
  }
  const columns: GridColDef<OutreachTemplate>[] = [
    { field: 'name', headerName: t($ => $.table.name), flex: 1, minWidth: 180 },
    {
      // Two kinds of template share this list, and they offer different merge
      // fields, so the kind has to be visible.
      field: 'context',
      headerName: t($ => $.table.context),
      width: 140,
      renderCell: ({ row }) => contextLabels[row.context],
    },
    {
      field: 'locale',
      headerName: t($ => $.table.locale),
      width: 120,
      renderCell: ({ row }) => localeLabels[row.locale],
    },
    ...(canWritePlanning ? [{
      field: 'actions',
      headerName: '',
      width: 104,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Tooltip title={t($ => $.actions.copy)}>
            <IconButton
              aria-label={t($ => $.actions.copy)}
              size="small"
              onClick={(event) => {
                event.stopPropagation()
                void handleCopy(row)
              }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t($ => $.actions.delete)}>
            <IconButton
              aria-label={t($ => $.actions.delete)}
              size="small"
              onClick={(event) => {
                event.stopPropagation()
                void handleDelete(row)
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    } satisfies GridColDef<OutreachTemplate>] : []),
  ]
  return <>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}><Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>{t($ => $.title)}</Typography>
      {canWritePlanning && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>{t($ => $.create.button)}</Button>}
    </Box>
    {loading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box> : <DataGrid rows={rows} columns={columns} disableRowSelectionOnClick onRowClick={({ row }) => navigate(`/outreach/templates/${row.id}`)} sx={{ minHeight: 420 }} />}
    {creating && <CreateTemplateDialog onClose={() => setCreating(false)} onCreated={(template) => navigate(`/outreach/templates/${template.id}`)} />}
  </>
}
