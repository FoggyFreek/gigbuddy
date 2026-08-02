import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import {
  DataGrid, GridCellModes, renderEditSingleSelectCell, useGridApiRef,
  type GridColDef, type GridRenderCellParams, type GridRenderEditCellParams,
  type GridValueOptionsParams,
} from '@mui/x-data-grid'
import { enUS, nlNL } from '@mui/x-data-grid/locales'
import { formatEur } from '../../../utils/invoiceTotals.ts'
import { formatShortDate } from '../../../utils/dateFormat.ts'
import type { Account, AccountingSettings, BankStatementLine, Id } from '../../../types/entities.ts'
import {
  defaultDecision, idFrom, journalDecision, keyOf, payoutMappingIncomplete,
  type Decision, type JournalDecision, type VatDefaults,
} from './decisions.ts'
import { buildVatOptions, vatOptionValue, type VatDirection, type VatOption } from './vatOptions.ts'
import { useStatusLabel } from './statusLabel.ts'
import PayoutMappingDialog from './PayoutMappingDialog.tsx'
import SupplierNameDialog from './SupplierNameDialog.tsx'

// jsdom gives every element a zero-size box, so the virtualizer would render no
// rows at all. Only the test environment pays for rendering every row.
const DISABLE_VIRTUALIZATION = import.meta.env.MODE === 'test'

// value encodes how the line is booked: inv:<id> | pur:<id> | shopify:<id> | paypal | journal
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
  const { supplier } = decision
  if (supplier.kind === 'link') return `link:${supplier.id}`
  return supplier.kind
}

function isJournal(decision: Decision | undefined): decision is JournalDecision {
  return decision?.kind === 'journal_paid' || decision?.kind === 'journal_received'
}

function isPayout(decision: Decision | undefined) {
  return decision?.kind === 'reconcile_shopify_payout' || decision?.kind === 'reconcile_paypal_payout'
}

interface GridRow {
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

interface Props {
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

export default function BankImportLinesGrid({
  lines, decisions, setDecision, setContraAccount, setVatTreatment, expenseAccounts, incomeAccounts,
  settings, vat, shopifyConfigured,
}: Readonly<Props>) {
  const { t, i18n } = useTranslation('ledger')
  const { t: tCommon } = useTranslation('common')
  const statusLabel = useStatusLabel()
  const apiRef = useGridApiRef()
  const [namingLine, setNamingLine] = useState<BankStatementLine | null>(null)
  const [mappingLineId, setMappingLineId] = useState<Id | null>(null)

  const pnlAccounts = useMemo(
    () => [...expenseAccounts, ...incomeAccounts], [expenseAccounts, incomeAccounts],
  )

  // Rate wording follows the rest of the app: NL spells its three headline rates
  // out, every other country shows the bare percentage.
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

  const rows = useMemo<GridRow[]>(() => lines.map((line) => {
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
      account: isJournal(decision) ? decision.contraAccountCode : '',
      vat: isJournal(decision) ? vatOptionValue(decision.vatRate, decision.taxCategoryCode) : '',
    }
  }), [lines, decisions])

  const mappingRow = mappingLineId == null
    ? null : rows.find((row) => row.line.id === mappingLineId) ?? null

  function toggleSkip(row: GridRow) {
    setDecision(row.line, row.skip
      ? defaultDecision(row.line, settings, vat, { shopifyConfigured })
      : { kind: 'skip' })
  }

  function applyMethod(row: GridRow, value: string) {
    const { line } = row
    if (value.startsWith('inv:')) return setDecision(line, { kind: 'reconcile_invoice', invoiceId: idFrom(value) })
    if (value.startsWith('pur:')) return setDecision(line, { kind: 'reconcile_purchase', purchaseId: idFrom(value) })
    if (value.startsWith('shopify:')) {
      return setDecision(line, {
        kind: 'reconcile_shopify_payout', payoutId: idFrom(value), adjustmentMappings: {},
      })
    }
    if (value === 'paypal') {
      return setDecision(line, {
        kind: 'reconcile_paypal_payout',
        orderFinancialIds: [],
        differenceAccountCode: expenseAccounts.find((account) => account.code === '64100')?.code
          ?? expenseAccounts[0]?.code ?? '',
      })
    }
    setDecision(line, journalDecision(line, expenseAccounts, incomeAccounts, vat))
  }

  function applySupplier(row: GridRow, value: string) {
    const { line, decision } = row
    if (decision?.kind !== 'journal_paid') return
    if (value === 'create_named') { setNamingLine(line); return }
    if (value.startsWith('link:')) {
      setDecision(line, { ...decision, supplier: { kind: 'link', id: idFrom(value) } })
      return
    }
    if (value === 'create') {
      setDecision(line, {
        ...decision,
        supplier: { kind: 'create', name: line.counterparty_name ?? '', iban: line.counterparty_iban },
      })
      return
    }
    setDecision(line, { ...decision, supplier: { kind: 'none' } })
  }

  function applyVat(row: GridRow, value: string) {
    const { line, decision } = row
    if (!isJournal(decision)) return
    const direction: VatDirection = line.direction === 'debit' ? 'purchase' : 'sale'
    const option = vatOptionsByDirection[direction].find((candidate) => candidate.value === value)
    if (!option) return
    setVatTreatment(line, decision, option)
  }

  function processRowUpdate(newRow: GridRow, oldRow: GridRow): GridRow {
    if (newRow.method !== oldRow.method) applyMethod(oldRow, newRow.method)
    else if (newRow.supplier !== oldRow.supplier) applySupplier(oldRow, newRow.supplier)
    else if (newRow.account !== oldRow.account && isJournal(oldRow.decision)) {
      setContraAccount(oldRow.line, oldRow.decision, newRow.account)
    } else if (newRow.vat !== oldRow.vat) applyVat(oldRow, newRow.vat)
    // The decisions state is the source of truth; the next render rebuilds this
    // row from it, so a rejected edit simply snaps back.
    return newRow
  }

  // Picking an option is the whole edit — close the cell as soon as the value
  // has landed rather than leaving it open until the reviewer clicks elsewhere.
  // The timeout is the earliest point at which `setEditCellValue` (awaited right
  // after this callback) has written the new value into the edit state.
  const renderSelectEditCell = (params: GridRenderEditCellParams<GridRow>) => renderEditSingleSelectCell({
    ...params,
    onValueChange: () => {
      setTimeout(() => apiRef.current?.stopCellEditMode({ id: params.id, field: params.field }))
    },
  })

  const columns: GridColDef<GridRow>[] = [
    {
      field: 'date',
      headerName: t($ => $.bankImport.table.date),
      type: 'date',
      width: 110,
      renderCell: (params: GridRenderCellParams<GridRow>) => formatShortDate(params.row.line.booking_date),
    },
    {
      field: 'from',
      headerName: t($ => $.bankImport.table.from),
      minWidth: 160,
      flex: 1,
      renderCell: (params: GridRenderCellParams<GridRow>) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, height: '100%' }}>
          <span>{params.row.from || '—'}</span>
          {params.row.line.is_reversal && <Chip size="small" variant="outlined" label="↺" />}
        </Box>
      ),
    },
    {
      field: 'description',
      headerName: t($ => $.bankImport.table.description),
      minWidth: 180,
      flex: 1.4,
      renderCell: (params: GridRenderCellParams<GridRow>) => (
        <Box sx={{ py: 0.75 }}>
          <Typography variant="body2" sx={{ whiteSpace: 'normal' }}>{params.row.description}</Typography>
          {params.row.line.suggestion?.possibleDuplicate && (
            <Typography variant="caption" sx={{ display: 'block', color: 'warning.main' }}>
              {t($ => $.bankImport.duplicate)}
            </Typography>
          )}
          {shopifyConfigured && (params.row.line.suggestion?.recordedShopifyPayoutMatches?.length ?? 0) > 0 && (
            <Typography variant="caption" sx={{ display: 'block', color: 'warning.main' }}>
              {t($ => $.bankImport.payoutAlreadyRecorded)}
            </Typography>
          )}
          {params.row.line.suggestion?.paidPurchaseMatches?.map((bill) => (
            <Typography
              key={`paid-${bill.id}`}
              variant="caption"
              sx={{ display: 'block', color: 'warning.main' }}
            >
              {t($ => $.bankImport.alreadyPaid, {
                number: bill.receipt_number,
                date: formatShortDate(bill.paid_at),
              })}
            </Typography>
          ))}
        </Box>
      ),
    },
    {
      field: 'amount',
      headerName: t($ => $.bankImport.table.amount),
      type: 'number',
      width: 120,
      renderCell: (params: GridRenderCellParams<GridRow>) => {
        const { line } = params.row
        const signed = line.direction === 'debit' ? -line.amount_cents : line.amount_cents
        return (
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: signed < 0 ? 'error.main' : 'success.main' }}
          >
            {formatEur(signed)}
          </Typography>
        )
      },
    },
    {
      field: 'skip',
      headerName: t($ => $.bankImport.table.skip),
      width: 90,
      sortable: false,
      filterable: false,
      renderCell: (params: GridRenderCellParams<GridRow>) => {
        if (params.row.line.status !== 'pending') {
          return <Chip size="small" variant="outlined" label={statusLabel(params.row.line.status)} />
        }
        return (
          <Checkbox
            size="small"
            checked={params.row.skip}
            onChange={() => toggleSkip(params.row)}
            slotProps={{ input: { 'aria-label': t($ => $.bankImport.table.skip) } }}
          />
        )
      },
    },
    {
      field: 'method',
      headerName: t($ => $.bankImport.bookingMethod),
      type: 'singleSelect',
      renderEditCell: renderSelectEditCell,
      width: 230,
      editable: true,
      sortable: false,
      filterable: false,
      valueOptions: (params: GridValueOptionsParams<GridRow>) => (
        params.row ? methodOptions(params.row.line, t, shopifyConfigured) : []
      ),
    },
    {
      field: 'supplier',
      headerName: t($ => $.bankImport.supplier.label),
      type: 'singleSelect',
      renderEditCell: renderSelectEditCell,
      width: 190,
      editable: true,
      sortable: false,
      filterable: false,
      valueOptions: (params: GridValueOptionsParams<GridRow>) => (
        params.row ? supplierOptions(params.row, t) : []
      ),
    },
    {
      field: 'account',
      headerName: t($ => $.bankImport.table.account),
      type: 'singleSelect',
      renderEditCell: renderSelectEditCell,
      width: 220,
      editable: true,
      sortable: false,
      valueOptions: (params: GridValueOptionsParams<GridRow>) => {
        if (!params.row) return accountOptions(pnlAccounts)
        if (!isJournal(params.row.decision)) return []
        return accountOptions(params.row.line.direction === 'debit' ? expenseAccounts : incomeAccounts)
      },
      renderCell: (params: GridRenderCellParams<GridRow>) => {
        const { row } = params
        if (isPayout(row.decision) && row.decision) {
          const incomplete = payoutMappingIncomplete(row.line, row.decision)
          return (
            <Button
              size="small"
              variant={incomplete ? 'outlined' : 'text'}
              color={incomplete ? 'warning' : 'primary'}
              startIcon={incomplete ? <WarningAmberIcon fontSize="small" /> : undefined}
              onClick={() => setMappingLineId(row.line.id)}
            >
              {t($ => $.bankImport.mapping.configure)}
            </Button>
          )
        }
        if (row.decision?.kind === 'reconcile_invoice') {
          const { invoiceId } = row.decision
          const gig = row.line.suggestion.invoiceMatches
            .find((invoice) => invoice.id === invoiceId)?.gig ?? null
          const details = gig ? [
            gig.event_description,
            gig.venue_name || gig.festival_name,
            gig.event_date ? formatShortDate(gig.event_date) : null,
          ].filter(Boolean).join(' · ') : ''
          return details
            ? <Tooltip title={details}><Chip size="small" variant="outlined" color="info" label={details} /></Tooltip>
            : null
        }
        if (!isJournal(row.decision)) return null
        const account = (row.line.direction === 'debit' ? expenseAccounts : incomeAccounts)
          .find((candidate) => candidate.code === row.account)
        return account ? `${account.code} — ${account.name}` : row.account
      },
    },
    {
      field: 'vat',
      headerName: t($ => $.bankImport.vat.label),
      type: 'singleSelect',
      renderEditCell: renderSelectEditCell,
      width: 210,
      editable: true,
      sortable: false,
      filterable: false,
      valueOptions: (params: GridValueOptionsParams<GridRow>) => {
        if (!params.row || !isJournal(params.row.decision)) return []
        return vatOptionsByDirection[params.row.line.direction === 'debit' ? 'purchase' : 'sale']
      },
    },
  ]

  return (
    <>
      <Box sx={{ width: '100%' }}>
        <DataGrid<GridRow>
          rows={rows}
          columns={columns}
          autoHeight
          density="compact"
          showToolbar
          disableRowSelectionOnClick
          disableVirtualization={DISABLE_VIRTUALIZATION}
          getRowHeight={() => 'auto'}
          localeText={(i18n.language.startsWith('nl') ? nlNL : enUS).components.MuiDataGrid.defaultProps.localeText}
          columnVisibilityModel={{ vat: vat.enabled }}
          initialState={{
            sorting: { sortModel: [{ field: 'date', sort: 'asc' }] },
            pagination: { paginationModel: { pageSize: 50 } },
          }}
          pageSizeOptions={[25, 50, 100]}
          isCellEditable={(params) => {
            const row = params.row as GridRow
            if (row.line.status !== 'pending' || row.skip) return false
            if (params.field === 'method') return methodOptions(row.line, t, shopifyConfigured).length > 1
            if (params.field === 'supplier') return row.decision?.kind === 'journal_paid'
            if (params.field === 'account') return isJournal(row.decision)
            if (params.field === 'vat') return isJournal(row.decision) && vat.enabled
            return false
          }}
          apiRef={apiRef}
          // Single click opens the dropdown: every editable cell here is a
          // select, and a review pass sets four of them per line. Edit mode is
          // left uncontrolled on purpose — that is what lets a click on the
          // backdrop (and Escape) close the menu again.
          onCellClick={(params) => {
            if (!params.isEditable || params.cellMode !== GridCellModes.View) return
            apiRef.current?.startCellEditMode({ id: params.id, field: params.field })
          }}
          processRowUpdate={processRowUpdate}
          onProcessRowUpdateError={() => { /* decisions state is authoritative */ }}
          sx={{
            '& .MuiDataGrid-cell': { alignItems: 'center', display: 'flex' },
            '& .MuiDataGrid-row--skipped': { opacity: 0.6 },
          }}
          getRowClassName={(params) => (
            (params.row as GridRow).line.status === 'pending' && (params.row as GridRow).skip
              ? 'MuiDataGrid-row--skipped' : ''
          )}
        />
      </Box>

      {namingLine && (
        <SupplierNameDialog
          initialName={supplierDraftName(namingLine, decisions[keyOf(namingLine)])}
          onCancel={() => setNamingLine(null)}
          onConfirm={(name) => {
            const decision = decisions[keyOf(namingLine)]
            if (decision?.kind === 'journal_paid') {
              setDecision(namingLine, {
                ...decision,
                supplier: { kind: 'create', name, iban: namingLine.counterparty_iban },
              })
            }
            setNamingLine(null)
          }}
        />
      )}

      {mappingRow?.decision && isPayout(mappingRow.decision) && (
        <PayoutMappingDialog
          line={mappingRow.line}
          decision={mappingRow.decision as Extract<Decision, { kind: 'reconcile_shopify_payout' | 'reconcile_paypal_payout' }>}
          accounts={pnlAccounts}
          onChange={(decision) => setDecision(mappingRow.line, decision)}
          onClose={() => setMappingLineId(null)}
        />
      )}
    </>
  )
}

type Translate = ReturnType<typeof useTranslation<'ledger'>>['t']

function methodOptions(line: BankStatementLine, t: Translate, shopifyConfigured: boolean) {
  const options: { value: string; label: string }[] = []
  for (const invoice of line.suggestion.invoiceMatches) {
    options.push({
      value: `inv:${invoice.id}`,
      label: invoice.mollie_payment_link_id
        ? t($ => $.bankImport.actions.matchInvoiceDeactivateMollie, { number: invoice.invoice_number })
        : t($ => $.bankImport.actions.matchInvoice, { number: invoice.invoice_number }),
    })
  }
  for (const purchase of line.suggestion.purchaseMatches) {
    options.push({
      value: `pur:${purchase.id}`,
      label: t($ => $.bankImport.actions.matchPurchase, { number: purchase.receipt_number }),
    })
  }
  // A payout that Shopify has not fully synced yet cannot be reconciled at all;
  // "Refresh Shopify payouts" is what brings it into the list.
  for (const payout of shopifyConfigured ? line.suggestion.shopifyPayoutMatches ?? [] : []) {
    if (!payout.ready) continue
    options.push({
      value: `shopify:${payout.id}`,
      label: t($ => $.bankImport.shopify.match, {
        id: payout.shopify_payout_id,
        date: formatShortDate(payout.issued_at),
      }),
    })
  }
  if ((line.suggestion.paypalOrderMatches?.length ?? 0) > 0) {
    options.push({ value: 'paypal', label: t($ => $.bankImport.paypal.match) })
  }
  options.push({
    value: 'journal',
    label: line.direction === 'debit'
      ? t($ => $.bankImport.actions.bookExpense)
      : t($ => $.bankImport.actions.bookIncome),
  })
  return options
}

function supplierDraftName(line: BankStatementLine, decision: Decision | undefined): string {
  if (decision?.kind === 'journal_paid' && decision.supplier.kind === 'create') return decision.supplier.name
  return line.counterparty_name ?? ''
}

function supplierOptions(row: GridRow, t: Translate) {
  const options: { value: string; label: string }[] = row.line.suggestion.supplierMatches
    .map((match) => ({ value: `link:${match.id}`, label: match.name ?? '' }))
  const draft = supplierDraftName(row.line, row.decision)
  if (draft) options.push({ value: 'create', label: t($ => $.bankImport.supplier.create, { name: draft }) })
  options.push({ value: 'create_named', label: t($ => $.bankImport.supplier.createNew) })
  options.push({ value: 'none', label: t($ => $.bankImport.supplier.none) })
  return options
}

function accountOptions(accounts: Account[]) {
  return accounts.map((account) => ({ value: account.code, label: `${account.code} — ${account.name}` }))
}
