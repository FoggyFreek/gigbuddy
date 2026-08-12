import { useEffect, useMemo, useState } from 'react'
import {
  cancelBankImport,
  commitBankImport,
  parseBankStatement,
  refreshShopifyPayouts,
  setOpeningBalanceFromImport,
} from '../../bank-import/bankImport.ts'
import { getAccountingProfile } from '../../accounting-profile/accountingProfile.ts'
import { getAccountingSettings, listAccounts } from '../../accounts/accounts.ts'
import { useProfile } from '../../../contexts/profileContext.ts'
import type {
  Account,
  AccountingSettings,
  BankImportDecision,
  BankImportParseResult,
  BankImportResult,
  BankStatementLine,
} from '../../../types/entities.ts'
import {
  applyPatch,
  defaultDecision,
  dismissKey,
  EXPENSE_TYPES,
  keyOf,
  NO_VAT_DEFAULTS,
  patchMatches,
  payoutMappingIncomplete,
  relationLabel,
  relationTokens,
  resolveVatDefaults,
  type ApplyPatch,
  type ApplyPrompt,
  type Decision,
  type JournalDecision,
  type VatDefaults,
} from './bankImport/decisions.ts'
import type { VatOption } from './bankImport/vatOptions.ts'

export type BankStatementImportStep = 'upload' | 'review' | 'importing' | 'done'

interface AccountFallbacks {
  defaultIncomeCode: string
  defaultExpenseCode: string
}

export function createInitialBankImportDecisions(
  lines: BankStatementLine[],
  settings: AccountingSettings | null,
  vat: VatDefaults,
  shopifyConfigured: boolean,
): Record<string, Decision> {
  const decisions: Record<string, Decision> = {}
  for (const line of lines) {
    if (line.status !== 'pending') continue
    const payoutAlreadyRecorded = shopifyConfigured
      && ((line.suggestion.recordedShopifyPayoutMatches?.length ?? 0) > 0
        || (line.suggestion.recordedPaypalPayoutMatches?.length ?? 0) > 0)
    decisions[keyOf(line)] = line.suggestion.paidPurchaseMatches.length || payoutAlreadyRecorded
      ? { kind: 'skip' }
      : defaultDecision(line, settings, vat, { shopifyConfigured })
  }
  return decisions
}

export function buildBankImportRequest(
  lines: BankStatementLine[],
  decisions: Record<string, Decision>,
  fallbacks: AccountFallbacks,
): BankImportDecision[] {
  const request: BankImportDecision[] = []
  for (const line of lines) {
    const decision = decisions[keyOf(line)]
    if (!decision || decision.kind === 'skip') {
      request.push({ line_id: line.id, action: 'skip' })
      continue
    }
    if (decision.kind === 'reconcile_invoice') {
      request.push({ line_id: line.id, action: 'reconcile_invoice', invoice_id: decision.invoiceId })
      continue
    }
    if (decision.kind === 'reconcile_purchase') {
      request.push({ line_id: line.id, action: 'reconcile_purchase', purchase_id: decision.purchaseId })
      continue
    }
    if (decision.kind === 'reconcile_shopify_payout') {
      request.push({
        line_id: line.id,
        action: 'reconcile_shopify_payout',
        payout_id: decision.payoutId,
        adjustment_mappings: Object.entries(decision.adjustmentMappings).map(([id, accountCode]) => ({
          balance_transaction_id: Number(id),
          account_code: accountCode,
        })),
      })
      continue
    }
    if (decision.kind === 'reconcile_paypal_payout') {
      request.push({
        line_id: line.id,
        action: 'reconcile_paypal_payout',
        order_financial_ids: decision.orderFinancialIds,
        difference_account_code: decision.differenceAccountCode || null,
      })
      continue
    }
    if (decision.kind === 'journal_received') {
      request.push({
        line_id: line.id,
        action: 'journal_received',
        contra_account_code: decision.contraAccountCode || fallbacks.defaultIncomeCode,
        vat_rate: decision.vatRate,
        tax_category_code: decision.taxCategoryCode,
        tax_jurisdiction_code: decision.taxJurisdictionCode,
      })
      continue
    }

    const journal = {
      line_id: line.id,
      action: 'journal_paid' as const,
      contra_account_code: decision.contraAccountCode || fallbacks.defaultExpenseCode,
      vat_rate: decision.vatRate,
      tax_category_code: decision.taxCategoryCode,
      tax_jurisdiction_code: decision.taxJurisdictionCode,
    }
    if (decision.supplier.kind === 'link') {
      request.push({ ...journal, supplier_contact_id: decision.supplier.id })
    } else if (decision.supplier.kind === 'create') {
      request.push({
        ...journal,
        create_supplier: { name: decision.supplier.name, iban: decision.supplier.iban },
      })
    } else {
      request.push(journal)
    }
  }
  return request
}

function errorCode(error: unknown): string | undefined {
  return (error as { body?: { code?: string } }).body?.code
}

function errorMessage(error: unknown): string {
  const body = (error as { body?: { error?: string } }).body
  if (body?.error) return body.error
  return error instanceof Error ? error.message : 'Import failed'
}

export function useBankStatementImportDialog(onClose: (imported: boolean) => void) {
  const { isIntegrationConfigured } = useProfile()
  const shopifyConfigured = isIntegrationConfigured('shopify')
  const [step, setStep] = useState<BankStatementImportStep>('upload')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<BankImportParseResult | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettings] = useState<AccountingSettings | null>(null)
  const [result, setResult] = useState<BankImportResult | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [refreshingShopify, setRefreshingShopify] = useState(false)
  const [openingBalanceSet, setOpeningBalanceSet] = useState(false)
  const [applyPrompt, setApplyPrompt] = useState<ApplyPrompt | null>(null)
  const [dismissedApply, setDismissedApply] = useState<ReadonlySet<string>>(new Set())
  const [vat, setVat] = useState<VatDefaults>(NO_VAT_DEFAULTS)

  useEffect(() => {
    let active = true
    Promise.all([
      listAccounts(),
      getAccountingSettings(),
      getAccountingProfile().catch(() => null),
    ])
      .then(([loadedAccounts, loadedSettings, accounting]) => {
        if (!active) return
        setAccounts(loadedAccounts)
        setSettings(loadedSettings)
        if (accounting) setVat(resolveVatDefaults(accounting))
      })
      .catch(() => { /* Account lists remain optional until review. */ })
    return () => { active = false }
  }, [])

  const expenseAccounts = useMemo(
    () => accounts.filter((account) => (
      account.type && EXPENSE_TYPES.has(account.type) && account.is_active !== false
    )),
    [accounts],
  )
  const incomeAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'revenue' && account.is_active !== false),
    [accounts],
  )
  const pendingLines = useMemo(
    () => parsed?.lines.filter((line) => line.status === 'pending') ?? [],
    [parsed],
  )

  const toBook = pendingLines.filter((line) => {
    const decision = decisions[keyOf(line)]
    return decision?.kind && decision.kind !== 'skip'
  })
  const hasIncompleteSupplier = pendingLines.some((line) => {
    const decision = decisions[keyOf(line)]
    return decision?.kind === 'journal_paid'
      && decision.supplier.kind === 'create'
      && !decision.supplier.name.trim()
  })
  const hasIncompletePayoutMapping = pendingLines.some((line) => {
    const decision = decisions[keyOf(line)]
    return decision ? payoutMappingIncomplete(line, decision) : false
  })

  const defaultIncomeCode = settings?.default_revenue_account_code || incomeAccounts[0]?.code || ''
  const defaultExpenseCode = settings?.default_expense_account_code || expenseAccounts[0]?.code || ''

  async function selectFile(file: File): Promise<void> {
    setError(null)
    setStep('importing')
    try {
      const next = await parseBankStatement(file)
      setParsed(next)
      setDecisions(createInitialBankImportDecisions(
        next.lines,
        settings,
        vat,
        shopifyConfigured,
      ))
      setStep('review')
    } catch (err: unknown) {
      setError(errorMessage(err))
      setStep('upload')
    }
  }

  function setDecision(line: BankStatementLine, decision: Decision): void {
    setDecisions((current) => ({ ...current, [keyOf(line)]: decision }))
  }

  function promptApply(
    line: BankStatementLine,
    updated: JournalDecision,
    patch: ApplyPatch,
    valueLabel: string,
  ): void {
    const kind = updated.kind === 'journal_paid' ? 'paid' : 'received'
    const tokens = relationTokens(line, updated)
    const name = relationLabel(line, updated)
    if (!tokens.length || !name) return
    if (tokens.some((token) => dismissedApply.has(dismissKey(patch, kind, token)))) return

    const siblings = pendingLines.filter((other) => {
      if (other.id === line.id) return false
      const decision = decisions[keyOf(other)]
      if (decision?.kind !== 'journal_paid' && decision?.kind !== 'journal_received') return false
      if (decision.kind !== updated.kind || patchMatches(decision, patch)) return false
      return relationTokens(other, decision).some((token) => tokens.includes(token))
    })
    if (!siblings.length) return

    setApplyPrompt({
      kind,
      patch,
      relationName: name,
      valueLabel,
      lineIds: siblings.map((sibling) => sibling.id),
      tokens,
    })
  }

  function setContraAccount(
    line: BankStatementLine,
    decision: JournalDecision,
    code: string,
  ): void {
    const patch: ApplyPatch = { field: 'account', contraAccountCode: code }
    const updated = applyPatch(decision, patch)
    setDecision(line, updated)
    const account = accounts.find((candidate) => candidate.code === code)
    promptApply(line, updated, patch, account ? `${account.code} — ${account.name}` : code)
  }

  function setVatTreatment(
    line: BankStatementLine,
    decision: JournalDecision,
    option: VatOption,
  ): void {
    const patch: ApplyPatch = {
      field: 'vat',
      vatRate: option.rate,
      taxCategoryCode: option.categoryCode,
      taxJurisdictionCode: vat.country,
    }
    const updated = applyPatch(decision, patch)
    setDecision(line, updated)
    promptApply(line, updated, patch, option.label)
  }

  function applyToRelation(): void {
    if (!applyPrompt) return
    const targets = new Set(applyPrompt.lineIds.map(String))
    setDecisions((current) => Object.fromEntries(
      Object.entries(current).map(([key, decision]) => {
        if (!targets.has(key)) return [key, decision]
        if (decision.kind !== 'journal_paid' && decision.kind !== 'journal_received') {
          return [key, decision]
        }
        return [key, applyPatch(decision, applyPrompt.patch)]
      }),
    ))
    setApplyPrompt(null)
  }

  function dismissApplyPrompt(): void {
    if (!applyPrompt) return
    setDismissedApply((current) => {
      const next = new Set(current)
      for (const token of applyPrompt.tokens) {
        next.add(dismissKey(applyPrompt.patch, applyPrompt.kind, token))
      }
      return next
    })
    setApplyPrompt(null)
  }

  async function runImport(): Promise<void> {
    if (!parsed) return
    setStep('importing')
    setError(null)
    try {
      const request = buildBankImportRequest(pendingLines, decisions, {
        defaultIncomeCode,
        defaultExpenseCode,
      })
      setResult(await commitBankImport(parsed.import.id, request))
      setStep('done')
    } catch (err: unknown) {
      setError(errorMessage(err))
      setStep('review')
    }
  }

  async function setOpeningBalance(): Promise<void> {
    if (!parsed) return
    setError(null)
    try {
      await setOpeningBalanceFromImport(parsed.import.id)
      setOpeningBalanceSet(true)
    } catch (err: unknown) {
      setError(errorMessage(err))
    }
  }

  async function refreshShopify(): Promise<void> {
    if (!parsed) return
    setRefreshingShopify(true)
    setError(null)
    try {
      const refreshed = await refreshShopifyPayouts(parsed.import.id)
      setParsed(refreshed)
      setDecisions((current) => {
        const next = { ...current }
        for (const line of refreshed.lines) {
          const payouts = line.suggestion.shopifyPayoutMatches ?? []
          if (line.status === 'pending' && payouts.length === 1 && payouts[0].ready) {
            next[keyOf(line)] = {
              kind: 'reconcile_shopify_payout',
              payoutId: payouts[0].id,
              adjustmentMappings: {},
            }
          }
        }
        return next
      })
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setRefreshingShopify(false)
    }
  }

  async function close(): Promise<void> {
    if (result) {
      onClose(true)
      return
    }
    if (!parsed) {
      onClose(false)
      return
    }

    setCancelling(true)
    setError(null)
    try {
      await cancelBankImport(parsed.import.id)
      onClose(false)
    } catch (err: unknown) {
      if (errorCode(err) === 'bank_import_has_committed_lines') {
        onClose(false)
        return
      }
      setError(errorMessage(err))
      setCancelling(false)
    }
  }

  return {
    step,
    error,
    parsed,
    decisions,
    result,
    cancelling,
    refreshingShopify,
    openingBalanceSet,
    applyPrompt,
    expenseAccounts,
    incomeAccounts,
    settings,
    vat,
    shopifyConfigured,
    toBookCount: toBook.length,
    importDisabled: !pendingLines.length || hasIncompleteSupplier || hasIncompletePayoutMapping,
    selectFile,
    setDecision,
    setContraAccount,
    setVatTreatment,
    applyToRelation,
    dismissApplyPrompt,
    runImport,
    setOpeningBalance,
    refreshShopify,
    close,
  }
}

export type BankStatementImportDialogController = ReturnType<typeof useBankStatementImportDialog>
