import { useCallback, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import { alpha } from '@mui/material/styles'
import SplitView from '../components/SplitView.jsx'
import { listVatReturns } from '../api/vatReturns.js'
import { formatEur } from '../utils/invoiceTotals.js'
import { quarterLabel, statusMeta, outstandingCents } from '../utils/vatReturns.js'
import NewVatReturnDialog from '../components/vatReturns/NewVatReturnDialog.jsx'
import { vatReturnShape } from '../propTypes/shared.js'

const SUMMARY_CARDS = [
  { key: 'all', label: 'All declarations', chipColor: 'primary' },
  { key: 'open', label: 'Ready to pay / receive', chipColor: 'warning' },
  { key: 'overdue', label: 'Overdue', chipColor: 'error' },
  { key: 'settled', label: 'Settled', chipColor: 'success' },
]

// statusMeta already encodes the settlement state as the dot colour; reuse
// that mapping so the cards and the row dots can never disagree.
const STATE_BY_COLOR = {
  'warning.main': 'open',
  'error.main': 'overdue',
  'success.main': 'settled',
}

function getReturnState(ret) {
  return STATE_BY_COLOR[statusMeta(ret).color]
}

function StatusDot({ color }) {
  return (
    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
  )
}

StatusDot.propTypes = {
  color: PropTypes.string.isRequired,
}

// Per-quarter VAT declarations: filed returns with their settlement status.
// Selecting a declaration opens its breakdown in the SplitView detail pane
// (/vat-returns/:id); filing a new one stays a dialog.
export default function VatReturnsPage() {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [returns, setReturns] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState(null) // row menu state: anchorEl plus ret, or null when closed
  const [summaryFilter, setSummaryFilter] = useState('all')

  const summaryStats = useMemo(() => {
    const stats = {
      all: { count: 0, total: 0 },
      open: { count: 0, total: 0 },
      overdue: { count: 0, total: 0 },
      settled: { count: 0, total: 0 },
    }
    for (const ret of returns ?? []) {
      const amount = Math.abs(Number(ret.net_cents) || 0)
      stats[getReturnState(ret)].count++
      stats[getReturnState(ret)].total += amount
      stats.all.count++
      stats.all.total += amount
    }
    return stats
  }, [returns])

  const visibleReturns = useMemo(() => {
    if (!returns || summaryFilter === 'all') return returns
    return returns.filter((ret) => getReturnState(ret) === summaryFilter)
  }, [returns, summaryFilter])

  const load = useCallback(() => {
    listVatReturns()
      .then(setReturns)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => { load() }, [load])

  function openMenu(event, ret) {
    event.stopPropagation()
    setMenu({ anchorEl: event.currentTarget, ret })
  }

  function openDetail(id) {
    setMenu(null)
    navigate(`/vat-returns/${id}`)
  }

  return (
    <SplitView basePath="/vat-returns" outletContext={{ onChanged: load }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" fontWeight={600}>
          VAT declarations
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
          New declaration
        </Button>
      </Box>

      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      {!returns && !error && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {returns && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
            {SUMMARY_CARDS.map((card) => {
              const stats = summaryStats[card.key]
              const isActive = summaryFilter === card.key
              return (
                <Paper
                  key={card.key}
                  variant="outlined"
                  onClick={() => setSummaryFilter(card.key)}
                  sx={{
                    p: 1.5,
                    minWidth: 120,
                    flex: '1 1 120px',
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: isActive
                      ? 'primary.main'
                      : (t) => t.palette.mode === 'dark' ? t.palette.grey[600] : t.palette.grey[300],
                    borderRadius: 1,
                    transition: 'border-color 0.15s',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                    <Box
                      sx={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        bgcolor: (t) => alpha(t.palette[card.chipColor]?.main ?? t.palette.primary.main, 0.18),
                        color: `${card.chipColor}.main`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {stats.count}
                    </Box>
                    <Typography variant="body2" fontWeight={500} sx={{ color: `${card.chipColor}.main` }}>
                      {card.label}
                    </Typography>
                  </Box>
                  <Typography variant="h6" fontWeight={700}>
                    {formatEur(stats.total)}
                  </Typography>
                </Paper>
              )
            })}
          </Box>

          <Paper variant="outlined">
            {!visibleReturns.length && (
              <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                No VAT declarations filed yet
              </Typography>
            )}
            {visibleReturns.map((ret) => (
              <VatReturnRow
                key={ret.id}
                vatReturn={ret}
                selected={ret.id === selectedId}
                onClick={() => openDetail(ret.id)}
                onMenu={openMenu}
              />
            ))}
          </Paper>
        </>
      )}

      <Menu
        anchorEl={menu?.anchorEl ?? null}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
      >
        <MenuItem onClick={() => openDetail(menu.ret.id)}>
          View breakdown
        </MenuItem>
        {menu && menu.ret.direction !== 'nil' && outstandingCents(menu.ret) > 0 && (
          <MenuItem onClick={() => openDetail(menu.ret.id)}>
            {menu.ret.direction === 'receivable' ? 'Record refund' : 'Record payment'}
          </MenuItem>
        )}
      </Menu>

      {creating && (
        <NewVatReturnDialog onFiled={load} onClose={() => setCreating(false)} />
      )}
    </SplitView>
  )
}

function VatReturnRow({ vatReturn, selected, onClick, onMenu }) {
  const meta = statusMeta(vatReturn)
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.75,
        cursor: 'pointer',
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 'none' },
        bgcolor: selected ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
      }}
    >
      <StatusDot color={meta.color} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1">{quarterLabel(vatReturn.year, vatReturn.quarter)}</Typography>
        <Typography variant="caption" color="text.secondary">{meta.label}</Typography>
      </Box>
      {vatReturn.direction !== 'nil' && (
        <Typography variant="body1" fontWeight={500} sx={{ flexShrink: 0 }}>
          {formatEur(Math.abs(vatReturn.net_cents))}
        </Typography>
      )}
      <IconButton
        size="small"
        aria-label={`actions for ${quarterLabel(vatReturn.year, vatReturn.quarter)}`}
        onClick={(e) => onMenu(e, vatReturn)}
      >
        <MoreHorizIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

VatReturnRow.propTypes = {
  vatReturn: vatReturnShape.isRequired,
  selected: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  onMenu: PropTypes.func.isRequired,
}
