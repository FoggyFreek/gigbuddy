import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useToast } from '../../contexts/toastContext.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { FEATURE_KEYS, LIMIT_KEYS } from '../../auth/entitlements.ts'
import type { Feature, LimitKey } from '../../auth/entitlements.ts'
import { createAdminPlan, updateAdminPlan, deleteAdminPlan } from '../../api/adminSubscriptions.ts'
import type { AdminPlanInput } from '../../api/adminSubscriptions.ts'
import type { SubscriptionPlan } from '../../api/billing.ts'

interface PlanCatalogSectionProps {
  plans: SubscriptionPlan[]
  onChanged: () => void
}

interface PlanFormState {
  name: string
  slug: string
  monthlyEur: string
  yearlyEur: string
  isActive: boolean
  sortOrder: string
  features: Record<string, boolean>
  limits: Record<string, string>
}

function labelFor(key: string): string {
  const text = key.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const LIMIT_LABELS: Record<string, string> = {
  storage_mb: 'Storage (MB)',
  members: 'Members',
  bands: 'Bands',
}

function centsToEurInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2)
}

// '' → null (interval unavailable / unlimited); invalid → undefined.
function parseEurToCents(input: string): number | null | undefined {
  const s = input.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n * 100)
}

function parseLimit(input: string): number | null | undefined {
  const s = input.trim()
  if (s === '') return null
  const n = Number(s)
  if (!Number.isInteger(n) || n < 0) return undefined
  return n
}

function emptyForm(): PlanFormState {
  return {
    name: '', slug: '', monthlyEur: '', yearlyEur: '', isActive: true, sortOrder: '0',
    features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])),
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, ''])),
  }
}

function formFromPlan(plan: SubscriptionPlan): PlanFormState {
  return {
    name: plan.name,
    slug: plan.slug,
    monthlyEur: centsToEurInput(plan.monthly_price_cents),
    yearlyEur: centsToEurInput(plan.yearly_price_cents),
    isActive: plan.is_active,
    sortOrder: String(plan.sort_order),
    features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, plan.entitlements.features[k] ?? false])),
    limits: Object.fromEntries(
      LIMIT_KEYS.map((k) => {
        const value = plan.entitlements.limits[k]
        return [k, value === null || value === undefined ? '' : String(value)]
      }),
    ),
  }
}

function errMessage(e: unknown): string {
  const x = (e ?? {}) as { message?: string; body?: { error?: string } }
  return x.body?.error || x.message || 'Something went wrong.'
}

export default function PlanCatalogSection({ plans, onChanged }: Readonly<PlanCatalogSectionProps>) {
  const showToast = useToast()
  // editing: null = dialog closed; a plan = edit; 'new' = create.
  const [editing, setEditing] = useState<SubscriptionPlan | 'new' | null>(null)
  const [form, setForm] = useState<PlanFormState>(emptyForm)
  const [deleting, setDeleting] = useState<SubscriptionPlan | null>(null)
  const [busy, setBusy] = useState(false)

  const isFallback = editing !== null && editing !== 'new' && editing.is_fallback

  const openCreate = () => {
    setForm(emptyForm())
    setEditing('new')
  }

  const openEdit = (plan: SubscriptionPlan) => {
    setForm(formFromPlan(plan))
    setEditing(plan)
  }

  const setField = <K extends keyof PlanFormState>(key: K, value: PlanFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const buildPayload = (): AdminPlanInput | null => {
    const monthly = parseEurToCents(form.monthlyEur)
    const yearly = parseEurToCents(form.yearlyEur)
    if (monthly === undefined || yearly === undefined) {
      showToast?.('Prices must be a non-negative amount in euros, or empty for unavailable.', 'warning')
      return null
    }
    const sortOrder = Number(form.sortOrder.trim() || '0')
    if (!Number.isInteger(sortOrder)) {
      showToast?.('Sort order must be an integer.', 'warning')
      return null
    }
    const limits: Record<string, number | null> = {}
    for (const key of LIMIT_KEYS) {
      const value = parseLimit(form.limits[key])
      if (value === undefined) {
        showToast?.(`${LIMIT_LABELS[key] ?? labelFor(key)} must be a non-negative integer, or empty for unlimited.`, 'warning')
        return null
      }
      limits[key] = value
    }
    return {
      slug: form.slug.trim(),
      name: form.name.trim(),
      monthly_price_cents: monthly,
      yearly_price_cents: yearly,
      is_active: form.isActive,
      sort_order: sortOrder,
      entitlements: { features: { ...form.features }, limits },
    }
  }

  const onSave = async () => {
    const payload = buildPayload()
    if (!payload) return
    setBusy(true)
    try {
      if (editing === 'new') {
        await createAdminPlan(payload)
        showToast?.('Plan created.', 'success')
      } else if (editing) {
        // The fallback plan's identity, pricing, and active state are immutable
        // (the API 400s on them) — send only what may change.
        const body = editing.is_fallback
          ? { sort_order: payload.sort_order, entitlements: payload.entitlements }
          : payload
        await updateAdminPlan(editing.id, body)
        showToast?.('Plan updated.', 'success')
      }
      setEditing(null)
      onChanged()
    } catch (e) {
      showToast?.(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteAdminPlan(deleting.id)
      showToast?.('Plan deleted.', 'success')
      setDeleting(null)
      onChanged()
    } catch (e) {
      showToast?.(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper elevation={0} sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Plan catalog</Typography>
        <Button variant="outlined" size="small" onClick={openCreate}>New plan</Button>
      </Stack>

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Slug</TableCell>
              <TableCell align="right">Monthly</TableCell>
              <TableCell align="right">Yearly</TableCell>
              <TableCell>Features</TableCell>
              <TableCell>Limits</TableCell>
              <TableCell align="right">Sort</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2">{plan.name}</Typography>
                    {plan.is_fallback && <Chip size="small" label="fallback" />}
                    {!plan.is_active && <Chip size="small" color="default" label="inactive" />}
                  </Stack>
                </TableCell>
                <TableCell>{plan.slug}</TableCell>
                <TableCell align="right">
                  {plan.monthly_price_cents === null ? '—' : formatEur(plan.monthly_price_cents)}
                </TableCell>
                <TableCell align="right">
                  {plan.yearly_price_cents === null ? '—' : formatEur(plan.yearly_price_cents)}
                </TableCell>
                <TableCell>
                  {FEATURE_KEYS.filter((k) => plan.entitlements.features[k]).map(labelFor).join(', ') || '—'}
                </TableCell>
                <TableCell>
                  {LIMIT_KEYS.map((k) => {
                    const value = plan.entitlements.limits[k]
                    return `${LIMIT_LABELS[k] ?? labelFor(k)}: ${value === null || value === undefined ? '∞' : value}`
                  }).join(', ')}
                </TableCell>
                <TableCell align="right">{plan.sort_order}</TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => openEdit(plan)}>Edit</Button>
                  {!plan.is_fallback && (
                    <Button size="small" color="error" onClick={() => setDeleting(plan)}>Delete</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {plans.length === 0 && (
              <TableRow><TableCell colSpan={8}>
                <Typography variant="body2" sx={{ color: 'text.secondary', py: 2, textAlign: 'center' }}>
                  No plans.
                </Typography>
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editing === 'new' ? 'New plan' : `Edit ${form.name}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                size="small" fullWidth label="Name" value={form.name} disabled={isFallback}
                onChange={(e) => setField('name', e.target.value)}
              />
              <TextField
                size="small" fullWidth label="Slug" value={form.slug} disabled={isFallback}
                helperText="Lowercase letters, digits, hyphens"
                onChange={(e) => setField('slug', e.target.value)}
              />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                size="small" fullWidth label="Monthly price (€)" value={form.monthlyEur} disabled={isFallback}
                helperText="Empty = interval unavailable"
                onChange={(e) => setField('monthlyEur', e.target.value)}
              />
              <TextField
                size="small" fullWidth label="Yearly price (€)" value={form.yearlyEur} disabled={isFallback}
                helperText="Empty = interval unavailable"
                onChange={(e) => setField('yearlyEur', e.target.value)}
              />
            </Stack>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.isActive} disabled={isFallback}
                    onChange={(e) => setField('isActive', e.target.checked)}
                    slotProps={{ input: { 'aria-label': 'Active' } }}
                  />
                }
                label="Active"
              />
              <TextField
                size="small" label="Sort order" value={form.sortOrder} sx={{ width: 120 }}
                onChange={(e) => setField('sortOrder', e.target.value)}
              />
            </Stack>

            <Typography variant="subtitle2">Features</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {FEATURE_KEYS.map((key: Feature) => (
                <FormControlLabel
                  key={key}
                  control={
                    <Switch
                      checked={form.features[key]}
                      onChange={(e) => setField('features', { ...form.features, [key]: e.target.checked })}
                      slotProps={{ input: { 'aria-label': labelFor(key) } }}
                    />
                  }
                  label={labelFor(key)}
                />
              ))}
            </Box>

            <Typography variant="subtitle2">Limits</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {LIMIT_KEYS.map((key: LimitKey) => (
                <TextField
                  key={key} size="small" fullWidth
                  label={LIMIT_LABELS[key] ?? labelFor(key)}
                  value={form.limits[key]}
                  helperText="Empty = unlimited"
                  onChange={(e) => setField('limits', { ...form.limits, [key]: e.target.value })}
                />
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={() => { void onSave() }}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete plan</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete the plan “{deleting?.name}”? This only works while no subscription uses it.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => { void onDelete() }}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
