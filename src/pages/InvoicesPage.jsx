import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Checkbox from '@mui/material/Checkbox'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import FilterListIcon from '@mui/icons-material/FilterList'
import NewInvoiceDialog from '../components/NewInvoiceDialog.jsx'
import InvoiceDetails from '../components/InvoiceDetails.jsx'
import InvoicePdfAction from '../components/InvoicePdfAction.jsx'
import SplitView from '../components/SplitView.jsx'
import { useCompactLayout } from '../hooks/useCompactLayout.js'
import { listInvoices, renderInvoice } from '../api/invoices.js'
import { formatEur } from '../utils/invoiceTotals.js'
import { formatShortDate } from '../utils/dateFormat.js'
import { invoiceStatusColor } from '../utils/invoiceStatus.js'

const STATUS_OPTIONS = ['draft', 'sent', 'paid', 'void']
const DEFAULT_STATUS_FILTER = ['draft', 'sent']

export default function InvoicesPage() {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newDialog, setNewDialog] = useState(false)
  const [draftPayload, setDraftPayload] = useState(null)
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS_FILTER)
  const [filterAnchor, setFilterAnchor] = useState(null)

  function toggleStatus(status) {
    setStatusFilter((prev) => (
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    ))
  }

  const visibleInvoices = useMemo(
    () => (statusFilter.length === 0
      ? invoices
      : invoices.filter((inv) => statusFilter.includes(inv.status))),
    [invoices, statusFilter],
  )

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listInvoices()
      setInvoices(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleRetryRender(invoice) {
    try {
      await renderInvoice(invoice.id)
      load()
    } catch (e) {
      window.alert(e.message)
    }
  }

  function handleDraftReady(payload) {
    setNewDialog(false)
    setDraftPayload(payload)
  }

  function handleCreateClose(reload) {
    setDraftPayload(null)
    if (reload) load()
  }

  const handleInvoiceUpdate = useCallback((id, patch) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === id ? { ...inv, ...patch } : inv)))
  }, [])

  return (
    <SplitView basePath="/invoices" outletContext={{ onReload: load, onInvoiceUpdate: handleInvoiceUpdate }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
          Invoices
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setNewDialog(true)}
        >
          Add invoice
        </Button>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>
      )}

      {!loading && (
        <>
          <Box sx={{ mb: 2 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<FilterListIcon />}
              onClick={(e) => setFilterAnchor(e.currentTarget)}
            >
              Status{statusFilter.length ? ` (${statusFilter.length})` : ''}
            </Button>
            <Menu
              anchorEl={filterAnchor}
              open={Boolean(filterAnchor)}
              onClose={() => setFilterAnchor(null)}
            >
              {STATUS_OPTIONS.map((status) => (
                <MenuItem key={status} onClick={() => toggleStatus(status)} dense>
                  <ListItemIcon>
                    <Checkbox
                      edge="start"
                      size="small"
                      checked={statusFilter.includes(status)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={status}
                    primaryTypographyProps={{ sx: { textTransform: 'capitalize' } }}
                  />
                </MenuItem>
              ))}
            </Menu>
          </Box>
          <InvoicesList
            invoices={visibleInvoices}
            selectedId={selectedId}
            onRowClick={(inv) => navigate(`/invoices/${inv.id}`)}
            onRetryRender={handleRetryRender}
          />
        </>
      )}

      {newDialog && (
        <NewInvoiceDialog
          onClose={() => setNewDialog(false)}
          onDraftReady={handleDraftReady}
        />
      )}

      {draftPayload && (
        <InvoiceDetails
          mode="create"
          draft={draftPayload}
          onClose={(reload) => handleCreateClose(reload)}
        />
      )}
    </SplitView>
  )
}

function InvoicesList({ invoices, selectedId, onRowClick, onRetryRender }) {
  const isCompact = useCompactLayout()

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {!invoices.length && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No invoices yet. Tap <strong>Add invoice</strong> to create one.
          </Typography>
        )}
        {invoices.map((inv) => (
          <Box
            key={inv.id}
            onClick={() => onRowClick(inv)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1.5,
              cursor: 'pointer',
              borderBottom: '1px solid',
              borderColor: 'divider',
              '&:last-of-type': { borderBottom: 'none' },
              '&:hover': { bgcolor: 'action.hover' },
              boxShadow: inv.id === selectedId
                ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}`
                : 'none',
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="body2" fontWeight={600}>
                  #{inv.invoice_number}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatShortDate(inv.issue_date)}
                </Typography>
                <Typography variant="body2" fontWeight={500} sx={{ ml: 'auto' }}>
                  {formatEur(inv.total_cents)}
                </Typography>
              </Box>
              <Typography
                variant="body2"
                color="text.secondary"
                noWrap
                sx={{ mt: 0.25 }}
              >
                {inv.customer_name || '-'}
              </Typography>
            </Box>
            <Box
              onClick={(e) => e.stopPropagation()}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                justifyContent: 'center',
                gap: 0.5,
              }}
            >
              <Chip size="small" label={inv.status} color={invoiceStatusColor(inv.status)} />
              <Stack direction="row" spacing={0.5}>
                <InvoicePdfAction invoice={inv} onRetryRender={onRetryRender} />
              </Stack>
            </Box>
          </Box>
        ))}
      </Paper>
    )
  }

  return (
    <Paper variant="outlined">
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Invoice #</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Customer</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!invoices.length && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    No invoices yet. Click <strong>New invoice</strong> to create one.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {invoices.map((inv) => (
              <TableRow
                key={inv.id}
                hover
                selected={inv.id === selectedId}
                sx={{ cursor: 'pointer' }}
                onClick={() => onRowClick(inv)}
              >
                <TableCell>#{inv.invoice_number}</TableCell>
                <TableCell>{formatShortDate(inv.issue_date)}</TableCell>
                <TableCell>{inv.customer_name}</TableCell>
                <TableCell align="right">{formatEur(inv.total_cents)}</TableCell>
                <TableCell>
                  <Chip size="small" label={inv.status} color={invoiceStatusColor(inv.status)} />
                </TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                    <InvoicePdfAction invoice={inv} onRetryRender={onRetryRender} />
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}
