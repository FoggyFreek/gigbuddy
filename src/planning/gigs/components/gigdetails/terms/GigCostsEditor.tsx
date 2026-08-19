import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import { useTranslation } from 'react-i18next'
import { NO_NUMBER_SPINNER_SX } from './termsFieldSx.ts'
import { useDialog } from '../../../../../contexts/dialogContext.ts'
import { formatEur } from '../../../../../finance/invoices/invoiceTotals.ts'
import { sumCostsCents } from '../../../dealTerms.ts'
import { feeToCents, feeToDisplay } from '../gigFormFields.ts'
import type { GigCost, Id } from '../../../../../types/entities.ts'

interface Props {
  editable: boolean
  costs: GigCost[]
  onAdd: (label: string, amountCents: number) => Promise<void>
  onUpdate: (costId: Id, label: string, amountCents: number) => Promise<void>
  onDelete: (costId: Id) => Promise<void>
}

// The artist's own costs, itemised. Each row commits on blur — the row is the
// unit of work, so there is no half-typed state to debounce across rows.
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
      <Card variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

          {costs.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
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
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                label={t($ => $.detail.deal.costs.label)}
                size="small"
                fullWidth
                value={draftLabel}
                onChange={(event) => setDraftLabel(event.target.value)}
                placeholder={t($ => $.detail.deal.costs.labelPlaceholder)}
              />
              <TextField
                label={t($ => $.detail.deal.costs.amount)}
                size="small"
                type="number"
                value={draftAmount}
                onChange={(event) => setDraftAmount(event.target.value)}
                placeholder="0.00"
                sx={{ ...NO_NUMBER_SPINNER_SX, minWidth: 140 }}
                slotProps={{
                  htmlInput: { min: 0, step: 0.01 },
                  input: { startAdornment: <InputAdornment position="start">€</InputAdornment> },
                }}
              />
              <Button startIcon={<AddIcon />} disabled={!canAdd} onClick={handleAdd} sx={{ flexShrink: 0, mt: 0.5 }}>
                {t($ => $.detail.deal.costs.add)}
              </Button>
            </Stack>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t($ => $.detail.deal.costs.total)}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {formatEur(sumCostsCents(costs))}
            </Typography>
          </Box>
        </Stack>
      </Card>
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

  if (!editable) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <Typography variant="body2">{cost.label}</Typography>
        <Typography variant="body2">{formatEur(Number(cost.amount_cents ?? 0))}</Typography>
      </Box>
    )
  }

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: 'flex-start' }}>
      <TextField
        label={t($ => $.detail.deal.costs.label)}
        size="small"
        fullWidth
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={commit}
      />
      <TextField
        label={t($ => $.detail.deal.costs.amount)}
        size="small"
        type="number"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        onBlur={commit}
        sx={{ ...NO_NUMBER_SPINNER_SX, minWidth: 140 }}
        slotProps={{
          htmlInput: { min: 0, step: 0.01 },
          input: { startAdornment: <InputAdornment position="start">€</InputAdornment> },
        }}
      />
      <Tooltip title={t($ => $.detail.deal.costs.delete)}>
        <IconButton
          size="small"
          aria-label={t($ => $.detail.deal.costs.deleteLabel, { label: cost.label ?? '' })}
          onClick={onDelete}
          sx={{ mt: 0.5 }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}
