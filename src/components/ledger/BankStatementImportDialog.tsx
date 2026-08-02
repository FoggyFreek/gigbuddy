import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import {
  parseBankStatement, commitBankImport, cancelBankImport, setOpeningBalanceFromImport,
  refreshShopifyPayouts,
} from '../../api/bankImport.ts'
import { listAccounts, getAccountingSettings } from '../../api/accounts.ts'
import { getAccountingProfile } from '../../api/accountingProfile.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { formatShortDate } from '../../utils/dateFormat.ts'
import type {
  Account, AccountingSettings, BankImportParseResult, BankStatementLine,
  BankImportDecision, BankImportResult,
} from '../../types/entities.ts'
import BankImportLinesGrid from './bankImport/BankImportLinesGrid.tsx'
import { useStatusLabel } from './bankImport/statusLabel.ts'
import {
  applyPatch, defaultDecision, dismissKey, keyOf, patchMatches, payoutMappingIncomplete,
  relationLabel, relationTokens, resolveVatDefaults, EXPENSE_TYPES, NO_VAT_DEFAULTS,
  type ApplyPatch, type ApplyPrompt, type Decision, type JournalDecision, type VatDefaults,
} from './bankImport/decisions.ts'
import type { VatOption } from './bankImport/vatOptions.ts'
import { useProfile } from '../../contexts/profileContext.ts'

type Step = 'upload' | 'review' | 'importing' | 'done'

interface BankStatementImportDialogProps {
  onClose: (imported: boolean) => void
}

export default function BankStatementImportDialog({ onClose }: Readonly<BankStatementImportDialogProps>) {
  const { t } = useTranslation('ledger')
  const { isIntegrationConfigured } = useProfile()
  const shopifyConfigured = isIntegrationConfigured('shopify')
  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<BankImportParseResult | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettings] = useState<AccountingSettings | null>(null)
  const [result, setResult] = useState<BankImportResult | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [refreshingShopify, setRefreshingShopify] = useState(false)
  // Local flag so the opening-balance nudge disappears once the user acts on it
  // (the server flag itself flips on the next parse).
  const [openingBalanceSet, setOpeningBalanceSet] = useState(false)
  // Offer to book every other line of the same supplier the way the reviewer
  // just booked this one. `dismissedApply` remembers "only this line" per
  // field+supplier+value so editing a third line of that supplier doesn't ask
  // again.
  const [applyPrompt, setApplyPrompt] = useState<ApplyPrompt | null>(null)
  const [dismissedApply, setDismissedApply] = useState<ReadonlySet<string>>(new Set())

  const [vat, setVat] = useState<VatDefaults>(NO_VAT_DEFAULTS)

  useEffect(() => {
    let active = true
    // Both profiles are read fresh rather than from context: the VAT scheme
    // decides whether VAT may be booked at all, so it must be the current value
    // and not one cached since the session started.
    // A failed read must not cost the reviewer the account lists, and it fails
    // closed: without a resolved scheme no VAT is offered.
    Promise.all([
      listAccounts(),
      getAccountingSettings(),
      getAccountingProfile().catch(() => null),
    ])
      .then(([accs, setts, accounting]) => {
        if (!active) return
        setAccounts(accs)
        setSettings(setts)
        if (accounting) setVat(resolveVatDefaults(accounting))
      })
      .catch(() => { /* accounts optional until review */ })
    return () => { active = false }
  }, [])

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.type && EXPENSE_TYPES.has(a.type) && a.is_active !== false),
    [accounts],
  )
  const incomeAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'revenue' && a.is_active !== false),
    [accounts],
  )

  async function handleFile(file: File) {
    setError(null)
    setStep('importing')
    try {
      const data = await parseBankStatement(file)
      setParsed(data)
      const seeded: Record<string, Decision> = {}
      for (const line of data.lines) {
        if (line.status !== 'pending') continue
        // A line whose bill or payout is already paid starts on Skip: the payment leg is
        // in the ledger already, so booking it again would double the expense
        // (and the VAT deduction). The reviewer can still book it — clearing the
        // Skip box hands back the ordinary decision — but not by accident.
        const payoutAlreadyRecorded = shopifyConfigured && (
          line.suggestion.recordedShopifyPayoutMatches?.length ?? 0
        ) > 0
        seeded[keyOf(line)] = line.suggestion.paidPurchaseMatches.length
          || payoutAlreadyRecorded
          ? { kind: 'skip' }
          : defaultDecision(line, settings, vat, { shopifyConfigured })
      }
      setDecisions(seeded)
      setStep('review')
    } catch (err) {
      setError(errorMessage(err))
      setStep('upload')
    }
  }

  const setDecision = (line: BankStatementLine, decision: Decision) =>
    setDecisions((prev) => ({ ...prev, [keyOf(line)]: decision }))

  const pendingLines = parsed?.lines.filter((l) => l.status === 'pending') ?? []

  // Classifying one line offers to classify the relation's other lines the same
  // way — statements repeat the same party, and booking each occurrence by hand
  // is where mis-classifications creep in. Outgoing and incoming lines of one
  // party are grouped separately: an expense account is no answer for a receipt.
  function promptApply(
    line: BankStatementLine, updated: JournalDecision, patch: ApplyPatch, valueLabel: string,
  ) {
    const kind = updated.kind === 'journal_paid' ? 'paid' : 'received'
    const tokens = relationTokens(line, updated)
    const name = relationLabel(line, updated)
    if (!tokens.length || !name) return
    if (tokens.some((token) => dismissedApply.has(dismissKey(patch, kind, token)))) return

    const siblings = pendingLines.filter((other) => {
      if (other.id === line.id) return false
      const d = decisions[keyOf(other)]
      if (d?.kind !== 'journal_paid' && d?.kind !== 'journal_received') return false
      if (d.kind !== updated.kind || patchMatches(d, patch)) return false
      return relationTokens(other, d).some((token) => tokens.includes(token))
    })
    if (!siblings.length) return

    setApplyPrompt({ kind, patch, relationName: name, valueLabel, lineIds: siblings.map((s) => s.id), tokens })
  }

  function setContraAccount(line: BankStatementLine, decision: JournalDecision, code: string) {
    const patch: ApplyPatch = { field: 'account', contraAccountCode: code }
    const updated = applyPatch(decision, patch)
    setDecision(line, updated)
    const account = accounts.find((a) => a.code === code)
    promptApply(line, updated, patch, account ? `${account.code} — ${account.name}` : code)
  }

  function setVatTreatment(line: BankStatementLine, decision: JournalDecision, option: VatOption) {
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

  function applyToRelation() {
    if (!applyPrompt) return
    const targets = new Set(applyPrompt.lineIds.map(String))
    setDecisions((prev) => {
      const next: Record<string, Decision> = { ...prev }
      for (const [key, decision] of Object.entries(prev)) {
        if (!targets.has(key)) continue
        if (decision.kind === 'journal_paid' || decision.kind === 'journal_received') {
          next[key] = applyPatch(decision, applyPrompt.patch)
        }
      }
      return next
    })
    setApplyPrompt(null)
  }

  function dismissApplyPrompt() {
    if (!applyPrompt) return
    setDismissedApply((prev) => {
      const next = new Set(prev)
      for (const token of applyPrompt.tokens) {
        next.add(dismissKey(applyPrompt.patch, applyPrompt.kind, token))
      }
      return next
    })
    setApplyPrompt(null)
  }

  const toBook = pendingLines.filter((l) => decisions[keyOf(l)]?.kind && decisions[keyOf(l)].kind !== 'skip')
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

  // Fallbacks keep a journal line's contra account valid even if the accounts
  // load resolved after the default decisions were seeded.
  const defaultIncomeCode = settings?.default_revenue_account_code || incomeAccounts[0]?.code || ''
  const defaultExpenseCode = settings?.default_expense_account_code || expenseAccounts[0]?.code || ''

  function buildRequest(): BankImportDecision[] {
    const out: BankImportDecision[] = []
    for (const line of pendingLines) {
      const d = decisions[keyOf(line)]
      // Send an explicit skip so the line reaches a terminal status and the
      // import can finalize (an all-skipped import is still committable).
      if (!d || d.kind === 'skip') { out.push({ line_id: line.id, action: 'skip' }); continue }
      if (d.kind === 'reconcile_invoice') out.push({ line_id: line.id, action: 'reconcile_invoice', invoice_id: d.invoiceId })
      else if (d.kind === 'reconcile_purchase') out.push({ line_id: line.id, action: 'reconcile_purchase', purchase_id: d.purchaseId })
      else if (d.kind === 'reconcile_shopify_payout') {
        out.push({
          line_id: line.id, action: 'reconcile_shopify_payout', payout_id: d.payoutId,
          adjustment_mappings: Object.entries(d.adjustmentMappings).map(([id, accountCode]) => ({
            balance_transaction_id: Number(id), account_code: accountCode,
          })),
        })
      }
      else if (d.kind === 'reconcile_paypal_payout') {
        out.push({
          line_id: line.id,
          action: 'reconcile_paypal_payout',
          order_financial_ids: d.orderFinancialIds,
          difference_account_code: d.differenceAccountCode || null,
        })
      }
      else if (d.kind === 'journal_received') {
        out.push({
          line_id: line.id, action: 'journal_received',
          contra_account_code: d.contraAccountCode || defaultIncomeCode,
          vat_rate: d.vatRate,
          tax_category_code: d.taxCategoryCode,
          tax_jurisdiction_code: d.taxJurisdictionCode,
        })
      } else {
        const base = {
          line_id: line.id,
          action: 'journal_paid' as const,
          contra_account_code: d.contraAccountCode || defaultExpenseCode,
          vat_rate: d.vatRate,
          tax_category_code: d.taxCategoryCode,
          tax_jurisdiction_code: d.taxJurisdictionCode,
        }
        if (d.supplier.kind === 'link') out.push({ ...base, supplier_contact_id: d.supplier.id })
        else if (d.supplier.kind === 'create') out.push({ ...base, create_supplier: { name: d.supplier.name, iban: d.supplier.iban } })
        else out.push(base)
      }
    }
    return out
  }

  async function runImport() {
    if (!parsed) return
    setStep('importing')
    setError(null)
    try {
      setResult(await commitBankImport(parsed.import.id, buildRequest()))
      setStep('done')
    } catch (err) {
      setError(errorMessage(err))
      setStep('review')
    }
  }

  async function handleSetOpeningBalance() {
    if (!parsed) return
    setError(null)
    try {
      await setOpeningBalanceFromImport(parsed.import.id)
      setOpeningBalanceSet(true)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function handleRefreshShopify() {
    if (!parsed) return
    setRefreshingShopify(true)
    setError(null)
    try {
      const refreshed = await refreshShopifyPayouts(parsed.import.id)
      setParsed(refreshed)
      setDecisions((previous) => {
        const next = { ...previous }
        for (const line of refreshed.lines) {
          const payouts = line.suggestion.shopifyPayoutMatches ?? []
          if (line.status === 'pending' && payouts.length === 1 && payouts[0].ready) {
            next[keyOf(line)] = {
              kind: 'reconcile_shopify_payout', payoutId: payouts[0].id, adjustmentMappings: {},
            }
          }
        }
        return next
      })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRefreshingShopify(false)
    }
  }

  async function handleClose() {
    if (result) { onClose(true); return }
    if (!parsed) { onClose(false); return }

    setCancelling(true)
    setError(null)
    try {
      await cancelBankImport(parsed.import.id)
      onClose(false)
    } catch (err) {
      // Re-uploading a file resolves to the import it was staged as the first
      // time; once any of its lines are booked the server refuses to delete it.
      // There is nothing to discard then, so close instead of trapping the user
      // in a dialog whose only exit is this button.
      if (errorCode(err) === 'bank_import_has_committed_lines') { onClose(false); return }
      setError(errorMessage(err))
      setCancelling(false)
    }
  }

  const statementIban = parsed?.import.account_iban

  return (
    <Dialog open fullWidth maxWidth="xl">
      <DialogTitle>{t($ => $.bankImport.title)}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {step === 'upload' && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Button component="label" variant="contained" startIcon={<UploadFileIcon />}>
              {t($ => $.bankImport.chooseFile)}
              <input
                type="file"
                accept=".xml,.sta,.940,.txt"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </Button>
            <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>
              {t($ => $.bankImport.fileHint)}
            </Typography>
          </Box>
        )}

        {step === 'importing' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}

        {step === 'review' && parsed && parsed.openingBalanceSuggested && (
          openingBalanceSet ? (
            <Alert severity="success" sx={{ mb: 2 }}>{t($ => $.bankImport.openingBalance.done)}</Alert>
          ) : (
            <Alert
              severity="info"
              sx={{ mb: 2 }}
              action={(
                <Button color="inherit" size="small" onClick={handleSetOpeningBalance}>
                  {t($ => $.bankImport.openingBalance.set)}
                </Button>
              )}
            >
              {t($ => $.bankImport.openingBalance.prompt, {
                amount: formatEur(parsed.import.opening_balance_cents ?? 0),
                date: parsed.import.opening_balance_date ? formatShortDate(parsed.import.opening_balance_date) : '',
              })}
            </Alert>
          )
        )}

        {step === 'review' && parsed && (
          <ReviewStep
            parsed={parsed}
            decisions={decisions}
            setDecision={setDecision}
            setContraAccount={setContraAccount}
            setVatTreatment={setVatTreatment}
            expenseAccounts={expenseAccounts}
            incomeAccounts={incomeAccounts}
            settings={settings}
            vat={vat}
            statementIban={statementIban}
            onRefreshShopify={handleRefreshShopify}
            refreshingShopify={refreshingShopify}
            shopifyConfigured={shopifyConfigured}
          />
        )}

        {step === 'done' && result && <DoneStep result={result} />}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={step === 'importing' || cancelling}>
          {result ? t($ => $.bankImport.close) : t($ => $.bankImport.cancel)}
        </Button>
        {step === 'review' && (
          <Button
            variant="contained"
            disabled={!pendingLines.length || hasIncompleteSupplier || hasIncompletePayoutMapping}
            onClick={runImport}
          >
            {toBook.length
              ? t($ => $.bankImport.importButton, { count: toBook.length })
              : t($ => $.bankImport.finish)}
          </Button>
        )}
      </DialogActions>

      {/* Portals to the body, so nesting it here only nests the JSX. */}
      {applyPrompt && (
        <ApplyToRelationDialog
          prompt={applyPrompt}
          onApply={applyToRelation}
          onDismiss={dismissApplyPrompt}
        />
      )}
    </Dialog>
  )
}

interface ApplyToRelationDialogProps {
  prompt: ApplyPrompt
  onApply: () => void
  onDismiss: () => void
}

function ApplyToRelationDialog({ prompt, onApply, onDismiss }: Readonly<ApplyToRelationDialogProps>) {
  const { t } = useTranslation('ledger')
  // Each field and each direction gets its own sentence rather than one sentence
  // with holes — the words around the name inflect differently per language.
  const field = prompt.patch.field
  const copy = prompt.kind
  return (
    <Dialog open onClose={onDismiss} maxWidth="xs" fullWidth>
      <DialogTitle>
        {t($ => $.bankImport.applyToRelation[field][copy].title, { name: prompt.relationName })}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          {t($ => $.bankImport.applyToRelation[field][copy].body, {
            count: prompt.lineIds.length,
            name: prompt.relationName,
            value: prompt.valueLabel,
          })}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDismiss}>{t($ => $.bankImport.applyToRelation.keepSingle)}</Button>
        <Button variant="contained" onClick={onApply}>{t($ => $.bankImport.applyToRelation.applyAll)}</Button>
      </DialogActions>
    </Dialog>
  )
}

interface ReviewStepProps {
  parsed: BankImportParseResult
  decisions: Record<string, Decision>
  setDecision: (line: BankStatementLine, decision: Decision) => void
  setContraAccount: (line: BankStatementLine, decision: JournalDecision, code: string) => void
  setVatTreatment: (line: BankStatementLine, decision: JournalDecision, option: VatOption) => void
  expenseAccounts: Account[]
  incomeAccounts: Account[]
  settings: AccountingSettings | null
  vat: VatDefaults
  statementIban: string | null | undefined
  onRefreshShopify: () => void
  refreshingShopify: boolean
  shopifyConfigured: boolean
}

function ReviewStep({
  parsed, decisions, setDecision, setContraAccount, setVatTreatment, expenseAccounts, incomeAccounts,
  settings, vat, statementIban, onRefreshShopify, refreshingShopify, shopifyConfigured,
}: Readonly<ReviewStepProps>) {
  const { t } = useTranslation('ledger')

  if (!parsed.lines.length) {
    return <Typography sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>{t($ => $.bankImport.empty)}</Typography>
  }

  return (
    <>
      {statementIban && (
        <Alert severity="info" sx={{ mb: 2 }}>{t($ => $.bankImport.accountMismatch, { iban: statementIban })}</Alert>
      )}
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        {t($ => $.bankImport.reviewIntro)}
      </Typography>
      {shopifyConfigured && (
        <Button
          size="small"
          variant="outlined"
          onClick={onRefreshShopify}
          disabled={refreshingShopify}
          sx={{ mb: 2 }}
        >
          {refreshingShopify ? t($ => $.bankImport.shopify.refreshing) : t($ => $.bankImport.shopify.refresh)}
        </Button>
      )}

      <BankImportLinesGrid
        lines={parsed.lines}
        decisions={decisions}
        setDecision={setDecision}
        setContraAccount={setContraAccount}
        setVatTreatment={setVatTreatment}
        expenseAccounts={expenseAccounts}
        incomeAccounts={incomeAccounts}
        settings={settings}
        vat={vat}
        shopifyConfigured={shopifyConfigured}
      />
    </>
  )
}

function DoneStep({ result }: Readonly<{ result: BankImportResult }>) {
  const { t } = useTranslation('ledger')
  const statusLabel = useStatusLabel()
  const notes = result.results.filter((r) => r.status !== 'imported'
    && r.status !== 'reconciled_invoice' && r.status !== 'reconciled_purchase'
    && r.status !== 'reconciled_shopify_payout' && r.status !== 'reconciled_paypal_payout')

  return (
    <>
      <Alert severity="success" sx={{ mb: 2 }}>
        {t($ => $.bankImport.done.summary, { count: result.imported, skipped: result.skipped })}
      </Alert>
      {notes.length > 0 && (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                <TableCell>{t($ => $.bankImport.done.line)}</TableCell>
                <TableCell>{t($ => $.bankImport.done.status)}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {notes.map((r) => (
                <TableRow key={String(r.line_id)}>
                  <TableCell>{String(r.line_id)}</TableCell>
                  <TableCell>{statusLabel(r.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </>
  )
}

function errorCode(err: unknown): string | undefined {
  return (err as { body?: { code?: string } }).body?.code
}

function errorMessage(err: unknown): string {
  const body = (err as { body?: { error?: string } }).body
  if (body?.error) return body.error
  return err instanceof Error ? err.message : 'Import failed'
}
