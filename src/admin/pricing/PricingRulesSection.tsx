import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
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
import { formatEur } from '../../finance/invoices/invoiceTotals.ts'
import { PLAN_AUDIENCE_KEYS } from '../../auth/planAudiences.ts'
import type { PlanAudience } from '../../auth/planAudiences.ts'
import type { BillingInterval } from '../../commerce/billing/billing.ts'
import type { DiscountType, PricingRule } from '../../commerce/billing/pricing.ts'
import {
  listPricingRules,
  createPricingRule,
  createPricingRuleVersion,
  renamePricingRule,
  retirePricingRule,
} from './adminPricingRules.ts'
import type { AdminPricingRuleInput } from './adminPricingRules.ts'

const INTERVALS: BillingInterval[] = ['month', 'year']

interface RuleFormState {
  code: string
  name: string
  discountType: DiscountType
  percent: string
  amountEur: string
  combinable: boolean
  effectiveFrom: string
  effectiveTo: string
  requiredAudiences: PlanAudience[]
  minModuleCount: string
  billingIntervals: BillingInterval[]
  priority: string
}

function emptyForm(): RuleFormState {
  return {
    code: '', name: '', discountType: 'percentage', percent: '', amountEur: '',
    combinable: false, effectiveFrom: '', effectiveTo: '',
    requiredAudiences: [], minModuleCount: '1', billingIntervals: [...INTERVALS], priority: '0',
  }
}

// A new version starts from the live terms — an admin bumping a percentage
// should not have to retype every condition, and a silently reset condition
// would quietly change who the discount applies to.
function formFromRule(rule: PricingRule): RuleFormState {
  return {
    code: rule.code,
    name: rule.name,
    discountType: rule.discount_type,
    percent: rule.percent === null ? '' : String(Number(rule.percent)),
    amountEur: rule.amount_cents === null ? '' : (rule.amount_cents / 100).toFixed(2),
    combinable: rule.combinable,
    effectiveFrom: rule.effective_from?.slice(0, 10) ?? '',
    effectiveTo: rule.effective_to?.slice(0, 10) ?? '',
    requiredAudiences: rule.required_audiences,
    minModuleCount: String(rule.min_module_count),
    billingIntervals: rule.billing_intervals,
    priority: String(rule.priority),
  }
}

function toIsoOrNull(day: string): string | null {
  return day.trim() === '' ? null : new Date(`${day}T00:00:00Z`).toISOString()
}

function errMessage(e: unknown): string {
  const x = (e ?? {}) as { message?: string; body?: { error?: string } }
  return x.body?.error || x.message || 'Something went wrong.'
}

function describeValue(rule: PricingRule): string {
  return rule.discount_type === 'percentage'
    ? `${Number(rule.percent)}%`
    : formatEur(rule.amount_cents ?? 0)
}

function describeConditions(rule: PricingRule): string {
  const parts = [`${rule.min_module_count}+ modules`]
  if (rule.required_audiences.length > 0) parts.push(`needs ${rule.required_audiences.join(' + ')}`)
  if (rule.billing_intervals.length < INTERVALS.length) parts.push(`${rule.billing_intervals.join('/')} only`)
  if (rule.combinable) parts.push('combinable')
  return parts.join(' · ')
}

function describeWindow(rule: PricingRule): string {
  const from = rule.effective_from?.slice(0, 10)
  const to = rule.effective_to?.slice(0, 10)
  if (!from && !to) return 'Always'
  return `${from ?? '…'} → ${to ?? '…'}`
}

export default function PricingRulesSection() {
  const showToast = useToast()
  const [rules, setRules] = useState<PricingRule[]>([])
  // editing: null = closed; 'new' = a new code; a rule = supersede it.
  const [editing, setEditing] = useState<PricingRule | 'new' | null>(null)
  const [form, setForm] = useState<RuleFormState>(emptyForm)
  const [retiring, setRetiring] = useState<PricingRule | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    listPricingRules()
      .then(setRules)
      .catch((e: unknown) => showToast?.(errMessage(e), 'error'))
  }, [showToast])

  useEffect(refresh, [refresh])

  const setField = <K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const buildPayload = (): AdminPricingRuleInput | null => {
    const percent = Number(form.percent.trim().replace(',', '.'))
    const amount = Number(form.amountEur.trim().replace(',', '.'))
    const isPercentage = form.discountType === 'percentage'
    if (isPercentage && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) {
      showToast?.('Percentage must be greater than 0 and at most 100.', 'warning')
      return null
    }
    if (!isPercentage && (!Number.isFinite(amount) || amount <= 0)) {
      showToast?.('Fixed discount must be a positive amount in euros.', 'warning')
      return null
    }
    const minModuleCount = Number(form.minModuleCount.trim())
    const priority = Number(form.priority.trim() || '0')
    if (!Number.isInteger(minModuleCount) || minModuleCount < 1 || !Number.isInteger(priority)) {
      showToast?.('Minimum modules must be 1 or more and priority must be an integer.', 'warning')
      return null
    }
    if (form.billingIntervals.length === 0) {
      showToast?.('Select at least one billing interval.', 'warning')
      return null
    }
    return {
      code: form.code.trim(),
      name: form.name.trim(),
      discount_type: form.discountType,
      percent: isPercentage ? percent : null,
      amount_cents: isPercentage ? null : Math.round(amount * 100),
      combinable: form.combinable,
      effective_from: toIsoOrNull(form.effectiveFrom),
      effective_to: toIsoOrNull(form.effectiveTo),
      required_audiences: form.requiredAudiences,
      min_module_count: minModuleCount,
      billing_intervals: form.billingIntervals,
      priority,
    }
  }

  const onSave = async () => {
    const payload = buildPayload()
    if (!payload) return
    setBusy(true)
    try {
      if (editing === 'new') {
        await createPricingRule(payload)
        showToast?.('Pricing rule created.', 'success')
      } else if (editing) {
        const { code: _code, ...terms } = payload
        await createPricingRuleVersion(editing.id, terms)
        showToast?.(`${editing.code} superseded by version ${editing.version + 1}.`, 'success')
      }
      setEditing(null)
      refresh()
    } catch (e) {
      showToast?.(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onRename = async (rule: PricingRule) => {
    const name = window.prompt('New display name', rule.name)?.trim()
    if (!name || name === rule.name) return
    setBusy(true)
    try {
      await renamePricingRule(rule.id, name)
      refresh()
    } catch (e) {
      showToast?.(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onRetire = async () => {
    if (!retiring) return
    setBusy(true)
    try {
      await retirePricingRule(retiring.id)
      showToast?.('Pricing rule retired.', 'success')
      setRetiring(null)
      refresh()
    } catch (e) {
      showToast?.(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const isPercentage = form.discountType === 'percentage'

  return (
    <Paper elevation={0} sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Pricing rules</Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={() => { setForm(emptyForm()); setEditing('new') }}
        >
          New rule
        </Button>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Discounts apply themselves when their conditions match. Terms are never edited in place —
        superseding a rule retires it and creates the next version, so the price snapshots that
        quoted it stay reproducible.
      </Typography>

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Code</TableCell>
              <TableCell align="right">Version</TableCell>
              <TableCell>Name</TableCell>
              <TableCell align="right">Discount</TableCell>
              <TableCell>Conditions</TableCell>
              <TableCell>Window</TableCell>
              <TableCell align="right">Priority</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id} sx={{ opacity: rule.is_active ? 1 : 0.55 }}>
                <TableCell>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{rule.code}</Typography>
                    {!rule.is_active && <Chip size="small" label="retired" />}
                  </Stack>
                </TableCell>
                <TableCell align="right">{rule.version}</TableCell>
                <TableCell>{rule.name}</TableCell>
                <TableCell align="right">{describeValue(rule)}</TableCell>
                <TableCell>{describeConditions(rule)}</TableCell>
                <TableCell>{describeWindow(rule)}</TableCell>
                <TableCell align="right">{rule.priority}</TableCell>
                <TableCell align="right">
                  {rule.is_active && (
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      <Button size="small" onClick={() => { void onRename(rule) }}>Rename</Button>
                      <Button
                        size="small"
                        onClick={() => { setForm(formFromRule(rule)); setEditing(rule) }}
                      >
                        New version
                      </Button>
                      <Button size="small" color="error" onClick={() => setRetiring(rule)}>Retire</Button>
                    </Stack>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    No pricing rules yet — subscriptions are charged at the module subtotal.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {editing === 'new' ? 'New pricing rule' : `New version of ${editing !== null ? editing.code : ''}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Code" size="small" value={form.code}
              disabled={editing !== 'new'}
              helperText="Stable identifier recorded in every price snapshot, e.g. dual_module_bundle"
              onChange={(e) => setField('code', e.target.value)}
            />
            <TextField
              label="Name" size="small" value={form.name}
              onChange={(e) => setField('name', e.target.value)}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                select label="Type" size="small" sx={{ minWidth: 160 }} value={form.discountType}
                onChange={(e) => setField('discountType', e.target.value as DiscountType)}
              >
                <MenuItem value="percentage">Percentage</MenuItem>
                <MenuItem value="fixed">Fixed amount</MenuItem>
              </TextField>
              {isPercentage ? (
                <TextField
                  label="Percent" size="small" value={form.percent}
                  onChange={(e) => setField('percent', e.target.value)}
                />
              ) : (
                <TextField
                  label="Amount (EUR)" size="small" value={form.amountEur}
                  onChange={(e) => setField('amountEur', e.target.value)}
                />
              )}
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Minimum modules" size="small" value={form.minModuleCount}
                onChange={(e) => setField('minModuleCount', e.target.value)}
              />
              <TextField
                label="Priority" size="small" value={form.priority}
                helperText="Lower applies first"
                onChange={(e) => setField('priority', e.target.value)}
              />
            </Stack>
            <TextField
              select label="Required modules" size="small" value={form.requiredAudiences}
              slotProps={{ select: { multiple: true } }}
              helperText="All selected must be present. Leave empty for any."
              onChange={(e) => setField('requiredAudiences', e.target.value as unknown as PlanAudience[])}
            >
              {PLAN_AUDIENCE_KEYS.map((audience) => (
                <MenuItem key={audience} value={audience}>{audience}</MenuItem>
              ))}
            </TextField>
            <TextField
              select label="Billing intervals" size="small" value={form.billingIntervals}
              slotProps={{ select: { multiple: true } }}
              onChange={(e) => setField('billingIntervals', e.target.value as unknown as BillingInterval[])}
            >
              {INTERVALS.map((interval) => (
                <MenuItem key={interval} value={interval}>{interval}</MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={2}>
              <TextField
                type="date" label="Effective from" size="small" value={form.effectiveFrom}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(e) => setField('effectiveFrom', e.target.value)}
              />
              <TextField
                type="date" label="Effective to" size="small" value={form.effectiveTo}
                slotProps={{ inputLabel: { shrink: true } }}
                onChange={(e) => setField('effectiveTo', e.target.value)}
              />
            </Stack>
            <FormControlLabel
              control={(
                <Switch
                  checked={form.combinable}
                  onChange={(e) => setField('combinable', e.target.checked)}
                />
              )}
              label="Combinable with other discounts"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={() => { void onSave() }} disabled={busy}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={retiring !== null} onClose={() => setRetiring(null)}>
        <DialogTitle>Retire pricing rule</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {retiring?.code} version {retiring?.version} stops applying to new quotes. The row stays on
            disk so existing price snapshots remain resolvable, and the code becomes free for a new rule.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRetiring(null)} disabled={busy}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => { void onRetire() }} disabled={busy}>
            Retire
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
