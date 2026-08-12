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
import { formatEur } from '../../../invoices/invoiceTotals.ts'
import { formatShortDate } from '../../../../utils/dateFormat.ts'
import type { Account, BankStatementLine } from '../../../../types/entities.ts'
import {
  isJournalDecision, isPayoutDecision, payoutMappingIncomplete,
} from './decisions.ts'
import {
  supplierDraftName,
  useBankImportLinesGrid,
  type BankImportGridRow,
  type BankImportLinesGridProps,
} from './useBankImportLinesGrid.ts'
import { useStatusLabel } from './statusLabel.ts'
import PayoutMappingDialog from './PayoutMappingDialog.tsx'
import SupplierNameDialog from './SupplierNameDialog.tsx'

// jsdom gives every element a zero-size box, so the virtualizer would render no
// rows at all. Only the test environment pays for rendering every row.
const DISABLE_VIRTUALIZATION = import.meta.env.MODE === 'test'

export default function BankImportLinesGrid({
  expenseAccounts, incomeAccounts, vat, shopifyConfigured, ...controllerProps
}: Readonly<BankImportLinesGridProps>) {
  const { t, i18n } = useTranslation('ledger')
  const statusLabel = useStatusLabel()
  const apiRef = useGridApiRef()
  const controller = useBankImportLinesGrid({
    expenseAccounts,
    incomeAccounts,
    vat,
    shopifyConfigured,
    ...controllerProps,
  })
  const {
    rows,
    pnlAccounts,
    vatOptionsByDirection,
    namingLine,
    namingLineInitialName,
    mappingRow,
    toggleSkip,
    processRowUpdate,
    cancelSupplierName,
    confirmSupplierName,
    openPayoutMapping,
    closePayoutMapping,
    changePayoutMapping,
  } = controller

  // Picking an option is the whole edit — close the cell as soon as the value
  // has landed rather than leaving it open until the reviewer clicks elsewhere.
  // The timeout is the earliest point at which `setEditCellValue` (awaited right
  // after this callback) has written the new value into the edit state.
  const renderSelectEditCell = (params: GridRenderEditCellParams<BankImportGridRow>) => renderEditSingleSelectCell({
    ...params,
    onValueChange: () => {
      setTimeout(() => apiRef.current?.stopCellEditMode({ id: params.id, field: params.field }))
    },
  })

  const columns: GridColDef<BankImportGridRow>[] = [
    {
      field: 'date',
      headerName: t($ => $.bankImport.table.date),
      type: 'date',
      width: 110,
      renderCell: (params: GridRenderCellParams<BankImportGridRow>) => formatShortDate(params.row.line.booking_date),
    },
    {
      field: 'from',
      headerName: t($ => $.bankImport.table.from),
      minWidth: 160,
      flex: 1,
      renderCell: (params: GridRenderCellParams<BankImportGridRow>) => (
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
      renderCell: (params: GridRenderCellParams<BankImportGridRow>) => (
        <Box sx={{ py: 0.75 }}>
          <Typography variant="body2" sx={{ whiteSpace: 'normal' }}>{params.row.description}</Typography>
          {params.row.line.suggestion?.possibleDuplicate && (
            <Typography variant="caption" sx={{ display: 'block', color: 'warning.main' }}>
              {t($ => $.bankImport.duplicate)}
            </Typography>
          )}
          {shopifyConfigured && (
            (params.row.line.suggestion?.recordedShopifyPayoutMatches?.length ?? 0) > 0
            || (params.row.line.suggestion?.recordedPaypalPayoutMatches?.length ?? 0) > 0
          ) && (
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
      renderCell: (params: GridRenderCellParams<BankImportGridRow>) => {
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
      renderCell: (params: GridRenderCellParams<BankImportGridRow>) => {
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
      valueOptions: (params: GridValueOptionsParams<BankImportGridRow>) => (
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
      valueOptions: (params: GridValueOptionsParams<BankImportGridRow>) => (
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
      valueOptions: (params: GridValueOptionsParams<BankImportGridRow>) => {
        if (!params.row) return accountOptions(pnlAccounts)
        if (!isJournalDecision(params.row.decision)) return []
        return accountOptions(params.row.line.direction === 'debit' ? expenseAccounts : incomeAccounts)
      },
      renderCell: (params: GridRenderCellParams<BankImportGridRow>) => {
        const { row } = params
        if (isPayoutDecision(row.decision)) {
          const incomplete = payoutMappingIncomplete(row.line, row.decision)
          return (
            <Button
              size="small"
              variant={incomplete ? 'outlined' : 'text'}
              color={incomplete ? 'warning' : 'primary'}
              startIcon={incomplete ? <WarningAmberIcon fontSize="small" /> : undefined}
              onClick={() => openPayoutMapping(row.line.id)}
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
        if (!isJournalDecision(row.decision)) return null
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
      valueOptions: (params: GridValueOptionsParams<BankImportGridRow>) => {
        if (!params.row || !isJournalDecision(params.row.decision)) return []
        return vatOptionsByDirection[params.row.line.direction === 'debit' ? 'purchase' : 'sale']
      },
    },
  ]

  return (
    <>
      <Box sx={{ width: '100%' }}>
        <DataGrid<BankImportGridRow>
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
            const row = params.row as BankImportGridRow
            if (row.line.status !== 'pending' || row.skip) return false
            if (params.field === 'method') return methodOptions(row.line, t, shopifyConfigured).length > 1
            if (params.field === 'supplier') return row.decision?.kind === 'journal_paid'
            if (params.field === 'account') return isJournalDecision(row.decision)
            if (params.field === 'vat') return isJournalDecision(row.decision) && vat.enabled
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
            (params.row as BankImportGridRow).line.status === 'pending'
              && (params.row as BankImportGridRow).skip
              ? 'MuiDataGrid-row--skipped' : ''
          )}
        />
      </Box>

      {namingLine && (
        <SupplierNameDialog
          initialName={namingLineInitialName}
          onCancel={cancelSupplierName}
          onConfirm={confirmSupplierName}
        />
      )}

      {mappingRow && isPayoutDecision(mappingRow.decision) && (
        <PayoutMappingDialog
          line={mappingRow.line}
          decision={mappingRow.decision}
          accounts={pnlAccounts}
          onChange={changePayoutMapping}
          onClose={closePayoutMapping}
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

function supplierOptions(row: BankImportGridRow, t: Translate) {
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
