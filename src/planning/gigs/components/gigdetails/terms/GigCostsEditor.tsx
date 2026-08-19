import { useState, type KeyboardEvent } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import { useTranslation } from 'react-i18next'
import { NO_NUMBER_SPINNER_SX } from './termsFieldSx.ts'
import { lineCellSx, lineFieldSx, lineHeadCellSx, lineTableSx } from '../lineTableSx.ts'
import { useDialog } from '../../../../../contexts/dialogContext.ts'
import { formatEur } from '../../../../../finance/invoices/invoiceTotals.ts'
import { sumCostsCents } from '../../../dealTerms.ts'
import { feeToCents, feeToDisplay } from '../gigFormFields.ts'
import type { GigCost, Id } from '../../../../../types/entities.ts'

// A reader gets no delete button, so that column falls away with it.
function gridColumns(editable: boolean): string {
  return editable ? 'minmax(0, 1fr) 132px 44px' : 'minmax(0, 1fr) 132px'
}

function rowSx(editable: boolean) {
  return {
    display: 'grid',
    gridTemplateColumns: gridColumns(editable),
    borderTop: 1,
    borderColor: 'divider',
    bgcolor: 'background.paper',
  } as const
}

// Money reads right-aligned: under its caption and above the total.
const amountCellSx = { ...lineCellSx, justifyContent: 'flex-end' } as const
const amountFieldSx = {
  ...lineFieldSx,
  ...NO_NUMBER_SPINNER_SX,
  '& input': { p: 0, textAlign: 'right' },
} as const

const euroAdornment = <InputAdornment position="start">€</InputAdornment>

interface Props {
  editable: boolean
  costs: GigCost[]
  onAdd: (label: string, amountCents: number) => Promise<void>
  onUpdate: (costId: Id, label: string, amountCents: number) => Promise<void>
  onDelete: (costId: Id) => Promise<void>
}

// The artist's own costs, itemised as a table: the outlined block with
// hairline-separated lines the timetable uses, closed off by the total. Each row
// commits on blur — the row is the unit of work, so there is no half-typed state
// to debounce across rows. The last line is the new cost; it cannot be stored
// without a label, so it stays a draft until it has one.
export default function GigCostsEditor({ editable, costs, onAdd, onUpdate, onDelete }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const { confirmDelete } = useDialog()
  const [draftLabel, setDraftLabel] = useState('')
  const [draftAmount, setDraftAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canAdd = draftLabel.trim() !== '' && !busy

  async function handleAdd() {
    if (!canAdd) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(draftLabel.trim(), feeToCents(draftAmount) ?? 0)
      setDraftLabel('')
      setDraftAmount('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // The draft line has no form around it, so Enter is wired up explicitly:
  // typing a cost and pressing Enter is the fastest way to list several.
  function handleDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void handleAdd()
  }

  async function handleDelete(cost: GigCost) {
    if (cost.id == null) return
    const confirmed = await confirmDelete({
      title: t($ => $.detail.deal.costs.deleteTitle, { label: cost.label ?? '' }),
    })
    if (!confirmed) return
    try {
      setError(null)
      await onDelete(cost.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Grid size={12}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1, mb: 1 }}>
        {t($ => $.detail.deal.costs.title)}
      </Typography>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ py: 0, mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* The column captions carry the field names, so the cells themselves are
          labelled for assistive technology only. */}
      <Box data-testid="gig-costs-table" sx={lineTableSx}>
        <Box sx={{ display: 'grid', gridTemplateColumns: gridColumns(editable), bgcolor: 'action.hover' }}>
          <Box sx={lineHeadCellSx}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {t($ => $.detail.deal.costs.label)}
            </Typography>
          </Box>
          <Box sx={{ ...lineHeadCellSx, justifyContent: 'flex-end' }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {t($ => $.detail.deal.costs.amount)}
            </Typography>
          </Box>
          {editable && <Box sx={lineHeadCellSx} />}
        </Box>

        {costs.length === 0 && (
          <Typography
            variant="body2"
            sx={{ color: 'text.secondary', px: 1, py: 1.25, borderTop: 1, borderColor: 'divider' }}
          >
            {t($ => $.detail.deal.costs.empty)}
          </Typography>
        )}

        {costs.map((cost) => (
          <CostRow
            key={String(cost.id)}
            cost={cost}
            editable={editable}
            onUpdate={onUpdate}
            onError={setError}
            onDelete={() => handleDelete(cost)}
          />
        ))}

        {editable && (
          <Box sx={rowSx(true)}>
            <Box sx={lineCellSx}>
              <TextField
                variant="standard"
                fullWidth
                value={draftLabel}
                onChange={(event) => setDraftLabel(event.target.value)}
                onKeyDown={handleDraftKeyDown}
                placeholder={t($ => $.detail.deal.costs.labelPlaceholder)}
                sx={lineFieldSx}
                slotProps={{
                  input: { disableUnderline: true },
                  htmlInput: { 'aria-label': t($ => $.detail.deal.costs.label) },
                }}
              />
            </Box>
            <Box sx={amountCellSx}>
              <TextField
                variant="standard"
                type="number"
                fullWidth
                value={draftAmount}
                onChange={(event) => setDraftAmount(event.target.value)}
                onKeyDown={handleDraftKeyDown}
                placeholder="0.00"
                sx={amountFieldSx}
                slotProps={{
                  input: { disableUnderline: true, startAdornment: euroAdornment },
                  htmlInput: { min: 0, step: 0.01, 'aria-label': t($ => $.detail.deal.costs.amount) },
                }}
              />
            </Box>
            <Box sx={{ ...lineCellSx, justifyContent: 'center' }}>
              <Tooltip title={t($ => $.detail.deal.costs.add)}>
                <span>
                  <IconButton
                    size="small"
                    color="primary"
                    disabled={!canAdd}
                    onClick={handleAdd}
                    aria-label={t($ => $.detail.deal.costs.add)}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>
        )}

        <Box data-testid="gig-costs-total" sx={{ ...rowSx(editable), bgcolor: 'action.hover' }}>
          <Box sx={{ ...lineHeadCellSx, py: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t($ => $.detail.deal.costs.total)}
            </Typography>
          </Box>
          <Box sx={{ ...lineHeadCellSx, py: 1, justifyContent: 'flex-end' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {formatEur(sumCostsCents(costs))}
            </Typography>
          </Box>
          {editable && <Box sx={lineHeadCellSx} />}
        </Box>
      </Box>
    </Grid>
  )
}

interface CostRowProps {
  cost: GigCost
  editable: boolean
  onUpdate: (costId: Id, label: string, amountCents: number) => Promise<void>
  onError: (message: string) => void
  onDelete: () => void
}

function CostRow({ cost, editable, onUpdate, onError, onDelete }: Readonly<CostRowProps>) {
  const { t } = useTranslation('gigs')
  // Seeded from the row and edited locally. A blank label or a rejected save
  // rolls back to the row the server still holds, so the list never shows a
  // value that was not stored.
  const [label, setLabel] = useState(cost.label ?? '')
  const [amount, setAmount] = useState(feeToDisplay(Number(cost.amount_cents ?? 0)))

  function reset() {
    setLabel(cost.label ?? '')
    setAmount(feeToDisplay(Number(cost.amount_cents ?? 0)))
  }

  async function commit() {
    if (cost.id == null) return
    const trimmed = label.trim()
    const cents = feeToCents(amount) ?? 0
    if (!trimmed) {
      reset()
      return
    }
    if (trimmed === cost.label && cents === Number(cost.amount_cents ?? 0)) return
    try {
      await onUpdate(cost.id, trimmed, cents)
    } catch (err) {
      reset()
      onError((err as Error).message)
    }
  }

  // A reader gets the stored figures as text — formatted money, not a number
  // input that only looks like a cell.
  if (!editable) {
    return (
      <Box sx={rowSx(false)}>
        <Box sx={{ ...lineCellSx, px: 1, py: 1 }}>
          <Typography variant="body2">{cost.label}</Typography>
        </Box>
        <Box sx={{ ...amountCellSx, px: 1, py: 1 }}>
          <Typography variant="body2">{formatEur(Number(cost.amount_cents ?? 0))}</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={rowSx(true)}>
      <Box sx={lineCellSx}>
        <TextField
          variant="standard"
          fullWidth
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commit}
          sx={lineFieldSx}
          slotProps={{
            input: { disableUnderline: true },
            htmlInput: { 'aria-label': t($ => $.detail.deal.costs.label) },
          }}
        />
      </Box>
      <Box sx={amountCellSx}>
        <TextField
          variant="standard"
          type="number"
          fullWidth
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onBlur={commit}
          sx={amountFieldSx}
          slotProps={{
            input: { disableUnderline: true, startAdornment: euroAdornment },
            htmlInput: { min: 0, step: 0.01, 'aria-label': t($ => $.detail.deal.costs.amount) },
          }}
        />
      </Box>
      <Box sx={{ ...lineCellSx, justifyContent: 'center' }}>
        <Tooltip title={t($ => $.detail.deal.costs.delete)}>
          <IconButton
            size="small"
            aria-label={t($ => $.detail.deal.costs.deleteLabel, { label: cost.label ?? '' })}
            onClick={onDelete}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}
