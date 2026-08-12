import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, AccountingSettings, BankStatementLine, Id } from '../../../../types/entities.ts'
import {
  defaultDecision,
  idFrom,
  isJournalDecision,
  isPayoutDecision,
  journalDecision,
  keyOf,
  type Decision,
  type JournalDecision,
  type VatDefaults,
} from './decisions.ts'
import { buildVatOptions, vatOptionValue, type VatDirection, type VatOption } from './vatOptions.ts'

export interface BankImportGridRow {
  id: string
  line: BankStatementLine
  decision: Decision | undefined
  date: Date
  from: string
  description: string
  amount: number
  skip: boolean
  method: string
  supplier: string
  account: string
  vat: string
}

export interface BankImportLinesGridProps {
  lines: BankStatementLine[]
  decisions: Record<string, Decision>
  setDecision: (line: BankStatementLine, decision: Decision) => void
  setContraAccount: (line: BankStatementLine, decision: JournalDecision, code: string) => void
  setVatTreatment: (line: BankStatementLine, decision: JournalDecision, option: VatOption) => void
  expenseAccounts: Account[]
  incomeAccounts: Account[]
  settings: AccountingSettings | null
  vat: VatDefaults
  shopifyConfigured: boolean
}

function methodValue(decision: Decision | undefined): string {
  if (!decision) return ''
  if (decision.kind === 'reconcile_invoice') return `inv:${decision.invoiceId}`
  if (decision.kind === 'reconcile_purchase') return `pur:${decision.purchaseId}`
  if (decision.kind === 'reconcile_shopify_payout') return `shopify:${decision.payoutId}`
  if (decision.kind === 'reconcile_paypal_payout') return 'paypal'
  if (decision.kind === 'skip') return ''
  return 'journal'
}

function supplierValue(decision: Decision | undefined): string {
  if (decision?.kind !== 'journal_paid') return ''
  if (decision.supplier.kind === 'link') return `link:${decision.supplier.id}`
  return decision.supplier.kind
}

export function buildBankImportGridRows(
  lines: BankStatementLine[],
  decisions: Record<string, Decision>,
): BankImportGridRow[] {
  return lines.map((line) => {
    const decision = decisions[keyOf(line)]
    return {
      id: keyOf(line),
      line,
      decision,
      date: new Date(line.booking_date),
      from: line.counterparty_name ?? '',
      description: line.remittance_info ?? '',
      amount: (line.direction === 'debit' ? -line.amount_cents : line.amount_cents) / 100,
      skip: !decision || decision.kind === 'skip',
      method: methodValue(decision),
      supplier: supplierValue(decision),
      account: isJournalDecision(decision) ? decision.contraAccountCode : '',
      vat: isJournalDecision(decision) ? vatOptionValue(decision.vatRate, decision.taxCategoryCode) : '',
    }
  })
}

export function supplierDraftName(
  line: BankStatementLine,
  decision: Decision | undefined,
): string {
  if (decision?.kind === 'journal_paid' && decision.supplier.kind === 'create') {
    return decision.supplier.name
  }
  return line.counterparty_name ?? ''
}

export function useBankImportLinesGrid({
  lines,
  decisions,
  setDecision,
  setContraAccount,
  setVatTreatment,
  expenseAccounts,
  incomeAccounts,
  settings,
  vat,
  shopifyConfigured,
}: Readonly<BankImportLinesGridProps>) {
  const { t } = useTranslation('ledger')
  const { t: tCommon } = useTranslation('common')
  const [namingLine, setNamingLine] = useState<BankStatementLine | null>(null)
  const [mappingLineId, setMappingLineId] = useState<Id | null>(null)

  const pnlAccounts = useMemo(
    () => [...expenseAccounts, ...incomeAccounts],
    [expenseAccounts, incomeAccounts],
  )
  const rows = useMemo(
    () => buildBankImportGridRows(lines, decisions),
    [lines, decisions],
  )

  const vatLabels = useMemo(() => ({
    none: t($ => $.bankImport.vat.none),
    rate: (rate: number) => {
      if (vat.country !== 'nl') return `${rate}%`
      if (rate === 21) return tCommon($ => $.vat.rates.standard)
      if (rate === 9) return tCommon($ => $.vat.rates.reduced)
      if (rate === 0) return tCommon($ => $.vat.rates.zero)
      return `${rate}%`
    },
    category: (code: string) => tCommon($ => $.vat.categories[code as keyof typeof $.vat.categories]),
  }), [t, tCommon, vat.country])

  const vatOptionsByDirection = useMemo(() => ({
    purchase: buildVatOptions(vat.country, 'purchase', vatLabels),
    sale: buildVatOptions(vat.country, 'sale', vatLabels),
  }), [vat.country, vatLabels])

  const mappingRow = mappingLineId == null
    ? null
    : rows.find((row) => row.line.id === mappingLineId) ?? null

  function toggleSkip(row: BankImportGridRow): void {
    setDecision(row.line, row.skip
      ? defaultDecision(row.line, settings, vat, { shopifyConfigured })
      : { kind: 'skip' })
  }

  function selectMethod(row: BankImportGridRow, value: string): void {
    const { line } = row
    if (value.startsWith('inv:')) {
      setDecision(line, { kind: 'reconcile_invoice', invoiceId: idFrom(value) })
      return
    }
    if (value.startsWith('pur:')) {
      setDecision(line, { kind: 'reconcile_purchase', purchaseId: idFrom(value) })
      return
    }
    if (value.startsWith('shopify:')) {
      setDecision(line, {
        kind: 'reconcile_shopify_payout',
        payoutId: idFrom(value),
        adjustmentMappings: {},
      })
      return
    }
    if (value === 'paypal') {
      setDecision(line, {
        kind: 'reconcile_paypal_payout',
        orderFinancialIds: [],
        differenceAccountCode: expenseAccounts.find((account) => account.code === '64100')?.code
          ?? expenseAccounts[0]?.code
          ?? '',
      })
      return
    }
    setDecision(line, journalDecision(line, expenseAccounts, incomeAccounts, vat))
  }

  function selectSupplier(row: BankImportGridRow, value: string): void {
    const { line, decision } = row
    if (decision?.kind !== 'journal_paid') return
    if (value === 'create_named') {
      setNamingLine(line)
      return
    }
    if (value.startsWith('link:')) {
      setDecision(line, { ...decision, supplier: { kind: 'link', id: idFrom(value) } })
      return
    }
    if (value === 'create') {
      setDecision(line, {
        ...decision,
        supplier: {
          kind: 'create',
          name: line.counterparty_name ?? '',
          iban: line.counterparty_iban,
        },
      })
      return
    }
    setDecision(line, { ...decision, supplier: { kind: 'none' } })
  }

  function selectVat(row: BankImportGridRow, value: string): void {
    if (!isJournalDecision(row.decision)) return
    const direction: VatDirection = row.line.direction === 'debit' ? 'purchase' : 'sale'
    const option = vatOptionsByDirection[direction].find((candidate) => candidate.value === value)
    if (option) setVatTreatment(row.line, row.decision, option)
  }

  function processRowUpdate(
    newRow: BankImportGridRow,
    oldRow: BankImportGridRow,
  ): BankImportGridRow {
    if (newRow.method !== oldRow.method) selectMethod(oldRow, newRow.method)
    else if (newRow.supplier !== oldRow.supplier) selectSupplier(oldRow, newRow.supplier)
    else if (newRow.account !== oldRow.account && isJournalDecision(oldRow.decision)) {
      setContraAccount(oldRow.line, oldRow.decision, newRow.account)
    } else if (newRow.vat !== oldRow.vat) selectVat(oldRow, newRow.vat)
    return newRow
  }

  function confirmSupplierName(name: string): void {
    if (!namingLine) return
    const decision = decisions[keyOf(namingLine)]
    if (decision?.kind === 'journal_paid') {
      setDecision(namingLine, {
        ...decision,
        supplier: { kind: 'create', name, iban: namingLine.counterparty_iban },
      })
    }
    setNamingLine(null)
  }

  function changePayoutMapping(decision: Decision): void {
    if (mappingRow && isPayoutDecision(decision)) setDecision(mappingRow.line, decision)
  }

  return {
    rows,
    pnlAccounts,
    vatOptionsByDirection,
    namingLine,
    namingLineInitialName: namingLine
      ? supplierDraftName(namingLine, decisions[keyOf(namingLine)])
      : '',
    mappingRow,
    toggleSkip,
    processRowUpdate,
    cancelSupplierName: () => setNamingLine(null),
    confirmSupplierName,
    openPayoutMapping: (lineId: Id) => setMappingLineId(lineId),
    closePayoutMapping: () => setMappingLineId(null),
    changePayoutMapping,
  }
}
