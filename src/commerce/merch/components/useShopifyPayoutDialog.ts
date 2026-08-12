import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listAccounts } from '../../../finance/accounts/accounts.ts'
import {
  createCustomPaypalPayout,
  createCustomShopifyPayout,
  listPaypalPayoutCandidates,
  listManualShopifyPayouts,
  refreshManualShopifyPayouts,
  settleShopifyPayoutManually,
} from '../merch.ts'
import type {
  Account,
  PaypalOrderMatch,
  ShopifyCustomPayoutCandidate,
  ShopifyManualPayout,
  ShopifyManualPayoutsResult,
} from '../../../types/entities.ts'

export type ShopifyPayoutMappings = Record<string, Record<string, string>>
export type CustomPaymentProvider = '' | 'shopify' | 'paypal'

function dateDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function customCandidateKey(candidate: ShopifyCustomPayoutCandidate): string {
  return candidate.balance_transaction_ids.map(String).join(',')
}

export function selectedCustomCandidates(
  candidates: ShopifyCustomPayoutCandidate[],
  selected: Set<string>,
): ShopifyCustomPayoutCandidate[] {
  return candidates.filter((candidate) => selected.has(customCandidateKey(candidate)))
}

export function totalCandidateNet(candidates: ShopifyCustomPayoutCandidate[]): number {
  return candidates.reduce((sum, candidate) => sum + candidate.net_cents, 0)
}

export function totalPaypalGross(candidates: PaypalOrderMatch[]): number {
  return candidates.reduce((sum, candidate) => sum + candidate.gross_cents, 0)
}

export function buildAdjustmentMappings(
  payout: ShopifyManualPayout,
  mappings: ShopifyPayoutMappings,
) {
  const selected = mappings[String(payout.id)] ?? {}
  return payout.adjustments.map((adjustment) => ({
    balance_transaction_id: adjustment.id,
    account_code: selected[String(adjustment.id)] ?? '',
  }))
}

export function payoutIsComplete(
  payout: ShopifyManualPayout,
  entryDates: Record<string, string>,
  mappings: ShopifyPayoutMappings,
): boolean {
  const selected = mappings[String(payout.id)] ?? {}
  return payout.ready
    && Boolean(entryDates[String(payout.id)])
    && payout.adjustments.every((adjustment) => selected[String(adjustment.id)])
}

export function useShopifyPayoutDialog() {
  const { t } = useTranslation('merch')
  const [payouts, setPayouts] = useState<ShopifyManualPayout[]>([])
  const [customCandidates, setCustomCandidates] = useState<ShopifyCustomPayoutCandidate[]>([])
  const [paypalCandidates, setPaypalCandidates] = useState<PaypalOrderMatch[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entryDates, setEntryDates] = useState<Record<string, string>>({})
  const [mappings, setMappings] = useState<ShopifyPayoutMappings>({})
  const [fromDate, setFromDate] = useState(() => dateDaysAgo(90))
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [settlingId, setSettlingId] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customProvider, setCustomProvider] = useState<CustomPaymentProvider>('')
  const [customReference, setCustomReference] = useState('')
  const [customDate, setCustomDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [customNetCents, setCustomNetCents] = useState(0)
  const [customSelected, setCustomSelected] = useState<Set<string>>(() => new Set())
  const [paypalSelected, setPaypalSelected] = useState<Set<string>>(() => new Set())
  const [paypalDepositCents, setPaypalDepositCents] = useState(0)
  const [paypalDifferenceAccountCode, setPaypalDifferenceAccountCode] = useState('')
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
    Promise.all([listManualShopifyPayouts(), listPaypalPayoutCandidates(), listAccounts()])
      .then(([result, paypalResult, loadedAccounts]) => {
        if (!active) return
        applyResult(result)
        setPaypalCandidates(paypalResult.items)
        setAccounts(loadedAccounts)
        const defaultDifferenceAccount = loadedAccounts.find((account) => (
          account.code === '64100' && account.is_active !== false
        )) ?? loadedAccounts.find((account) => (
          account.type === 'expense' && account.is_active !== false
        ))
        setPaypalDifferenceAccountCode(defaultDifferenceAccount?.code ?? '')
      })
      .catch((err: unknown) => {
        if (active) setError(errorText(err, t($ => $.shopifyPayout.errors.load)))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [t, applyResult])

  const selectedCandidates = useMemo(
    () => selectedCustomCandidates(customCandidates, customSelected),
    [customCandidates, customSelected],
  )
  const expectedCustomNet = totalCandidateNet(selectedCandidates)
  const selectedPaypalCandidates = useMemo(
    () => paypalCandidates.filter((candidate) => paypalSelected.has(String(candidate.id))),
    [paypalCandidates, paypalSelected],
  )
  const expectedPaypalGross = totalPaypalGross(selectedPaypalCandidates)

  async function refresh(): Promise<void> {
    setRefreshing(true)
    setError(null)
    try {
      applyResult(await refreshManualShopifyPayouts(fromDate, toDate))
    } catch (err: unknown) {
      setError(errorText(err, t($ => $.shopifyPayout.errors.refresh)))
    } finally {
      setRefreshing(false)
    }
  }

  function setEntryDate(payoutId: ShopifyManualPayout['id'], date: string): void {
    setEntryDates((current) => ({ ...current, [String(payoutId)]: date }))
  }

  function setAdjustmentAccount(
    payoutId: ShopifyManualPayout['id'],
    adjustmentId: ShopifyManualPayout['adjustments'][number]['id'],
    accountCode: string,
  ): void {
    setMappings((current) => ({
      ...current,
      [String(payoutId)]: {
        ...current[String(payoutId)],
        [String(adjustmentId)]: accountCode,
      },
    }))
  }

  async function settle(payout: ShopifyManualPayout): Promise<void> {
    setSettlingId(String(payout.id))
    setError(null)
    try {
      await settleShopifyPayoutManually(payout.id, {
        entry_date: entryDates[String(payout.id)],
        adjustment_mappings: buildAdjustmentMappings(payout, mappings),
      })
      setPayouts((current) => current.filter((item) => item.id !== payout.id))
      setSuccess(true)
    } catch (err: unknown) {
      setError(errorText(err, t($ => $.shopifyPayout.errors.settle)))
    } finally {
      setSettlingId(null)
    }
  }

  function toggleCustomCandidate(candidate: ShopifyCustomPayoutCandidate): void {
    const key = customCandidateKey(candidate)
    const next = new Set(customSelected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCustomSelected(next)
    setCustomNetCents(totalCandidateNet(selectedCustomCandidates(customCandidates, next)))
  }

  function togglePaypalCandidate(candidate: PaypalOrderMatch): void {
    const key = String(candidate.id)
    const next = new Set(paypalSelected)
    if (next.has(key)) next.delete(key)
    else {
      const selectedCurrency = selectedPaypalCandidates[0]?.currency
      if (selectedCurrency && selectedCurrency !== candidate.currency) return
      next.add(key)
    }
    setPaypalSelected(next)
    setPaypalDepositCents(totalPaypalGross(
      paypalCandidates.filter((item) => next.has(String(item.id))),
    ))
  }

  async function createCustom(): Promise<void> {
    setCreatingCustom(true)
    setError(null)
    try {
      const result = await createCustomShopifyPayout({
        reference: customReference.trim(),
        issued_at: customDate,
        net_cents: customNetCents,
        balance_transaction_ids: selectedCandidates.flatMap(
          (candidate) => candidate.balance_transaction_ids,
        ),
      })
      applyResult(result)
      setCustomOpen(false)
      setCustomReference('')
      setCustomSelected(new Set())
      setCustomNetCents(0)
    } catch (err: unknown) {
      setError(errorText(err, t($ => $.shopifyPayout.errors.create)))
    } finally {
      setCreatingCustom(false)
    }
  }


  async function recordCustomPaypal(): Promise<void> {
    setCreatingCustom(true)
    setError(null)
    try {
      await createCustomPaypalPayout({
        reference: customReference.trim(),
        entry_date: customDate,
        deposit_cents: paypalDepositCents,
        order_financial_ids: selectedPaypalCandidates.map((candidate) => candidate.id),
        difference_account_code: expectedPaypalGross === paypalDepositCents
          ? null
          : paypalDifferenceAccountCode || null,
      })
      const settledIds = new Set(selectedPaypalCandidates.map((candidate) => String(candidate.id)))
      setPaypalCandidates((current) => current.filter((candidate) => !settledIds.has(String(candidate.id))))
      setCustomOpen(false)
      setCustomProvider('')
      setCustomReference('')
      setPaypalSelected(new Set())
      setPaypalDepositCents(0)
      setSuccess(true)
    } catch (err: unknown) {
      setError(errorText(err, t($ => $.shopifyPayout.errors.createPaypal)))
    } finally {
      setCreatingCustom(false)
    }
  }

  return {
    payouts,
    customCandidates,
    paypalCandidates,
    entryDates,
    mappings,
    fromDate,
    toDate,
    loading,
    refreshing,
    settlingId,
    customOpen,
    customProvider,
    customReference,
    customDate,
    customNetCents,
    customSelected,
    paypalSelected,
    paypalDepositCents,
    paypalDifferenceAccountCode,
    creatingCustom,
    error,
    success,
    pnlAccounts,
    selectedCandidates,
    expectedCustomNet,
    selectedPaypalCandidates,
    expectedPaypalGross,
    hasCustomCandidates: customCandidates.length > 0 || paypalCandidates.length > 0,
    setFromDate,
    setToDate,
    refresh,
    openCustom: () => { setCustomProvider(''); setCustomOpen(true) },
    closeCustom: () => { setCustomProvider(''); setCustomOpen(false) },
    setCustomProvider,
    setCustomReference,
    setCustomDate,
    setCustomNetCents,
    toggleCustomCandidate,
    togglePaypalCandidate,
    setPaypalDepositCents,
    setPaypalDifferenceAccountCode,
    createCustom,
    recordCustomPaypal,
    setEntryDate,
    setAdjustmentAccount,
    settle,
    isPayoutComplete: (payout: ShopifyManualPayout) => payoutIsComplete(payout, entryDates, mappings),
  }
}
