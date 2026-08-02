import { useCallback, useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useTranslation } from 'react-i18next'
import {
  createCustomShopifyPayout,
  listManualShopifyPayouts,
  refreshManualShopifyPayouts,
  settleShopifyPayoutManually,
} from '../../api/merch.ts'
import { listAccounts } from '../../api/accounts.ts'
import { formatCurrency } from '../../utils/invoiceTotals.ts'
import { formatShortDate } from '../../utils/dateFormat.ts'
import DateEntryField from '../DateEntryField.tsx'
import MoneyInput from '../invoices/MoneyInput.tsx'
import type {
  Account,
  ShopifyCustomPayoutCandidate,
  ShopifyManualPayout,
  ShopifyManualPayoutsResult,
} from '../../types/entities.ts'

interface Props {
  onClose: (recorded: boolean) => void
}

function dateDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export default function ShopifyPayoutDialog({ onClose }: Readonly<Props>) {
  const { t } = useTranslation('merch')
  const [payouts, setPayouts] = useState<ShopifyManualPayout[]>([])
  const [customCandidates, setCustomCandidates] = useState<ShopifyCustomPayoutCandidate[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entryDates, setEntryDates] = useState<Record<string, string>>({})
  const [mappings, setMappings] = useState<Record<string, Record<string, string>>>({})
  const [fromDate, setFromDate] = useState(() => dateDaysAgo(90))
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [settlingId, setSettlingId] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customReference, setCustomReference] = useState('')
  const [customDate, setCustomDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [customNetCents, setCustomNetCents] = useState(0)
  const [customSelected, setCustomSelected] = useState<Set<string>>(() => new Set())
  const [creatingCustom, setCreatingCustom] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const pnlAccounts = useMemo(() => accounts.filter((account) => (
    account.is_active !== false
    && ['revenue', 'expense', 'cost_of_goods_sold'].includes(account.type ?? '')
  )), [accounts])

  const applyPayouts = useCallback((next: ShopifyManualPayout[]) => {
    setPayouts(next)
    setEntryDates((current) => Object.fromEntries(next.map((payout) => [
      String(payout.id),
      current[String(payout.id)] ?? payout.issued_at.slice(0, 10),
    ])))
  }, [])

  const applyResult = useCallback((result: ShopifyManualPayoutsResult) => {
    applyPayouts(result.items)
    setCustomCandidates(result.custom_candidates)
  }, [applyPayouts])

  useEffect(() => {
    let active = true
    Promise.all([listManualShopifyPayouts(), listAccounts()])
      .then(([result, loadedAccounts]) => {
        if (!active) return
        applyResult(result)
        setAccounts(loadedAccounts)
      })
      .catch((err) => {
        if (active) setError(errorText(err, t($ => $.shopifyPayout.errors.load)))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [t, applyResult])

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      const result = await refreshManualShopifyPayouts(fromDate, toDate)
      applyResult(result)
    } catch (err) {
      setError(errorText(err, t($ => $.shopifyPayout.errors.refresh)))
    } finally {
      setRefreshing(false)
    }
  }

  function payoutMappings(payout: ShopifyManualPayout) {
    const selected = mappings[String(payout.id)] ?? {}
    return payout.adjustments.map((adjustment) => ({
      balance_transaction_id: adjustment.id,
      account_code: selected[String(adjustment.id)] ?? '',
    }))
  }

  async function settle(payout: ShopifyManualPayout) {
    setSettlingId(String(payout.id))
    setError(null)
    try {
      await settleShopifyPayoutManually(payout.id, {
        entry_date: entryDates[String(payout.id)],
        adjustment_mappings: payoutMappings(payout),
      })
      setPayouts((current) => current.filter((item) => item.id !== payout.id))
      setSuccess(true)
    } catch (err) {
      setError(errorText(err, t($ => $.shopifyPayout.errors.settle)))
    } finally {
      setSettlingId(null)
    }
  }

  function complete(payout: ShopifyManualPayout): boolean {
    const selected = mappings[String(payout.id)] ?? {}
    return payout.ready
      && Boolean(entryDates[String(payout.id)])
      && payout.adjustments.every((adjustment) => selected[String(adjustment.id)])
  }

  function customCandidateKey(candidate: ShopifyCustomPayoutCandidate): string {
    return candidate.balance_transaction_ids.map(String).join(',')
  }

  const selectedCustomCandidates = useMemo(() => customCandidates.filter(
    (candidate) => customSelected.has(customCandidateKey(candidate)),
  ), [customCandidates, customSelected])

  const expectedCustomNet = selectedCustomCandidates.reduce(
    (sum, candidate) => sum + candidate.net_cents, 0,
  )

  function toggleCustomCandidate(candidate: ShopifyCustomPayoutCandidate) {
    const key = customCandidateKey(candidate)
    const next = new Set(customSelected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCustomSelected(next)
    setCustomNetCents(customCandidates
      .filter((item) => next.has(customCandidateKey(item)))
      .reduce((sum, item) => sum + item.net_cents, 0))
  }

  async function createCustom() {
    setCreatingCustom(true)
    setError(null)
    try {
      const result = await createCustomShopifyPayout({
        reference: customReference.trim(),
        issued_at: customDate,
        net_cents: customNetCents,
        balance_transaction_ids: selectedCustomCandidates.flatMap(
          (candidate) => candidate.balance_transaction_ids,
        ),
      })
      applyResult(result)
      setCustomOpen(false)
      setCustomReference('')
      setCustomSelected(new Set())
      setCustomNetCents(0)
    } catch (err) {
      setError(errorText(err, t($ => $.shopifyPayout.errors.create)))
    } finally {
      setCreatingCustom(false)
    }
  }

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>{t($ => $.shopifyPayout.title)}</DialogTitle>
      <DialogContent dividers>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t($ => $.shopifyPayout.intro)}
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{t($ => $.shopifyPayout.recorded)}</Alert>}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
          <DateEntryField
            id="shopify-payout-from"
            label={t($ => $.shopifyPayout.fromDate)}
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            size="small"
          />
          <DateEntryField
            id="shopify-payout-to"
            label={t($ => $.shopifyPayout.toDate)}
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            size="small"
          />
          <Button
            variant="outlined"
            startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
            disabled={refreshing || !fromDate || !toDate}
            onClick={refresh}
          >
            {t($ => $.shopifyPayout.refresh)}
          </Button>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            disabled={!customCandidates.length}
            onClick={() => setCustomOpen(true)}
          >
            {t($ => $.shopifyPayout.createCustom)}
          </Button>
        </Stack>

        {customOpen && (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
              {t($ => $.shopifyPayout.createCustom)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t($ => $.shopifyPayout.customIntro)}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
              <TextField
                size="small"
                label={t($ => $.shopifyPayout.customReference)}
                value={customReference}
                onChange={(event) => setCustomReference(event.target.value)}
                fullWidth
              />
              <DateEntryField
                id="shopify-custom-payout-date"
                label={t($ => $.shopifyPayout.customDate)}
                value={customDate}
                onChange={(event) => setCustomDate(event.target.value)}
                size="small"
              />
              <MoneyInput
                cents={customNetCents}
                onChange={setCustomNetCents}
                label={t($ => $.shopifyPayout.customAmount)}
                currency={selectedCustomCandidates[0]?.currency ?? 'EUR'}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {t($ => $.shopifyPayout.customOrders)}
            </Typography>
            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
              {customCandidates.map((candidate) => (
                <Box
                  key={customCandidateKey(candidate)}
                  component="label"
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
                >
                  <Checkbox
                    size="small"
                    checked={customSelected.has(customCandidateKey(candidate))}
                    onChange={() => toggleCustomCandidate(candidate)}
                  />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2">{candidate.order_name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatShortDate(candidate.processed_at)}
                      {candidate.source_payout_id
                        ? ` · ${t($ => $.shopifyPayout.customSourcePayout, { id: candidate.source_payout_id })}`
                        : ''}
                    </Typography>
                  </Box>
                  <Typography variant="body2">
                    {formatCurrency(candidate.net_cents, candidate.currency)}
                  </Typography>
                </Box>
              ))}
            </Stack>
            {customNetCents !== expectedCustomNet && selectedCustomCandidates.length > 0 && (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                {t($ => $.shopifyPayout.customDifference, {
                  amount: formatCurrency(customNetCents - expectedCustomNet, selectedCustomCandidates[0].currency),
                })}
              </Alert>
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button
                variant="contained"
                disabled={creatingCustom || !customReference.trim() || !customDate
                  || customNetCents <= 0 || selectedCustomCandidates.length === 0}
                onClick={createCustom}
              >
                {t($ => $.shopifyPayout.customSubmit)}
              </Button>
              <Button disabled={creatingCustom} onClick={() => setCustomOpen(false)}>
                {t($ => $.shopifyPayout.customCancel)}
              </Button>
            </Stack>
          </Paper>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress /></Box>
        ) : payouts.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            {t($ => $.shopifyPayout.empty)}
          </Typography>
        ) : (
          <Stack spacing={2}>
            {payouts.map((payout) => (
              <Paper key={String(payout.id)} variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 1 }}>
                  <Box>
                    <Typography sx={{ fontWeight: 600 }}>
                      {t($ => $.shopifyPayout.payoutLabel, { id: payout.shopify_payout_id })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatShortDate(payout.issued_at)} · {payout.transaction_type}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontWeight: 600 }}>
                    {formatCurrency(payout.net_cents, payout.currency)}
                  </Typography>
                </Box>

                {payout.orders.map((order) => (
                  <Box key={String(order.id)} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{order.order_name}</Typography>
                    <Typography variant="body2">{formatCurrency(order.net_cents, payout.currency)}</Typography>
                  </Box>
                ))}

                {payout.adjustments.length > 0 && (
                  <Stack spacing={1} sx={{ mt: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t($ => $.shopifyPayout.adjustmentsIntro)}
                    </Typography>
                    {payout.adjustments.map((adjustment) => (
                      <FormControl size="small" key={String(adjustment.id)} fullWidth>
                        <InputLabel>{adjustment.type}</InputLabel>
                        <Select
                          label={adjustment.type}
                          value={mappings[String(payout.id)]?.[String(adjustment.id)] ?? ''}
                          onChange={(event) => setMappings((current) => ({
                            ...current,
                            [String(payout.id)]: {
                              ...current[String(payout.id)],
                              [String(adjustment.id)]: event.target.value,
                            },
                          }))}
                        >
                          {pnlAccounts.map((account) => (
                            <MenuItem key={String(account.code)} value={account.code}>
                              {account.code} — {account.name} ({formatCurrency(adjustment.net_cents, payout.currency)})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    ))}
                  </Stack>
                )}

                {!payout.ready && (
                  <Alert severity="warning" sx={{ mt: 1.5 }}>{t($ => $.shopifyPayout.incomplete)}</Alert>
                )}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2, alignItems: { sm: 'center' } }}>
                  <DateEntryField
                    id={`shopify-payout-date-${payout.id}`}
                    label={t($ => $.shopifyPayout.paymentDate)}
                    value={entryDates[String(payout.id)] ?? ''}
                    onChange={(event) => setEntryDates((current) => ({
                      ...current, [String(payout.id)]: event.target.value,
                    }))}
                    size="small"
                  />
                  <Button
                    variant="contained"
                    disabled={!complete(payout) || settlingId != null}
                    onClick={() => settle(payout)}
                  >
                    {payout.transaction_type === 'DEPOSIT'
                      ? t($ => $.shopifyPayout.recordDeposit)
                      : t($ => $.shopifyPayout.recordWithdrawal)}
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(success)}>{t($ => $.shopifyPayout.close)}</Button>
      </DialogActions>
    </Dialog>
  )
}
