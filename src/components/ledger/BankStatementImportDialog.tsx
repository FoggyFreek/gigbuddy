import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
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
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { parseBankStatement, commitBankImport, cancelBankImport, setOpeningBalanceFromImport } from '../../api/bankImport.ts'
import { listAccounts, getAccountingSettings } from '../../api/accounts.ts'
import { getProfile } from '../../api/profile.ts'
import { getAccountingProfile } from '../../api/accountingProfile.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { formatShortDate } from '../../utils/dateFormat.ts'
import {
  DEFAULT_VAT_COUNTRY, getStandardVatRate, isAllowedVatRate, vatRateOptions,
} from '../../utils/vatRates.ts'
// The same net/VAT split the server posts with — one rounding rule, no drift
// between the preview and the ledger.
import { computePurchaseLineTotals } from '../../utils/purchaseTotals.ts'
import type {
  Account, AccountingProfile, AccountingSettings, BankImportParseResult, BankStatementLine,
  BankImportDecision, BankImportResult, Id, Tenant,
} from '../../types/entities.ts'

type Step = 'upload' | 'review' | 'importing' | 'done'

type SupplierChoice =
  | { kind: 'link'; id: Id }
  | { kind: 'create'; name: string; iban: string | null }
  | { kind: 'none' }

type Decision =
  | { kind: 'skip' }
  | { kind: 'reconcile_invoice'; invoiceId: Id }
  | { kind: 'reconcile_purchase'; purchaseId: Id }
  | { kind: 'journal_paid'; contraAccountCode: string; vatRate: number | null; supplier: SupplierChoice }
  | { kind: 'journal_received'; contraAccountCode: string; vatRate: number | null }

// The VAT a direct booking should carry. `enabled` is false under a
// small-business scheme: such a tenant neither charges output VAT nor deducts
// input VAT, so no row may carry a rate.
interface VatDefaults {
  enabled: boolean
  country: string
  /** Money paid out — the country's standard rate. */
  paid: number
  /** Money received — the band's own configured rate (its invoice default). */
  received: number
}

const NO_VAT_DEFAULTS: VatDefaults = {
  enabled: false, country: DEFAULT_VAT_COUNTRY, paid: 0, received: 0,
}

// `accounting` supplies the scheme in force today; the band profile still
// supplies the band's own configured rate. These are only the reviewer's
// DEFAULTS — the server re-checks each line against the scheme in force at that
// line's booking date, which is the authoritative answer for a statement
// spanning a scheme change.
function resolveVatDefaults(profile: Tenant, accounting: AccountingProfile | null): VatDefaults {
  const treatment = accounting?.current_sales_treatment ?? null
  const country = treatment?.accounting_country || profile.vat_country || DEFAULT_VAT_COUNTRY
  if (treatment?.scheme_exempt) return { ...NO_VAT_DEFAULTS, country }
  const configured = Number(profile.tax_percentage)
  return {
    enabled: true,
    country,
    paid: getStandardVatRate(country),
    // What the band charges on its own turnover — the same value invoices
    // default to — falling back to the standard rate if it is not a real rate
    // for this country (e.g. saved before the VAT country changed).
    received: isAllowedVatRate(country, configured) ? configured : getStandardVatRate(country),
  }
}

const EXPENSE_TYPES = new Set(['expense', 'cost_of_goods_sold'])
const keyOf = (line: BankStatementLine) => String(line.id)

// Fixed widths for the booking row: the how-it-books column and the VAT column
// keep the same width on every line, so the VAT controls form one straight
// column down the review list instead of stepping in and out with the content.
const BOOKING_COLUMN = 300
const VAT_COLUMN = 140

// Pre-selects the most likely booking for a line: an exact single reconcile
// match, else a direct journal (creating a supplier for a new outgoing
// counterparty). Duplicate hints remain warning-only. A reconciled invoice or
// bill carries the document's own VAT, so only the direct journals get a rate.
function defaultDecision(line: BankStatementLine, settings: AccountingSettings | null, vat: VatDefaults): Decision {
  if (line.direction === 'debit') {
    if (line.suggestion.purchaseMatches.length === 1) {
      return { kind: 'reconcile_purchase', purchaseId: line.suggestion.purchaseMatches[0].id }
    }
    return {
      kind: 'journal_paid',
      contraAccountCode: settings?.default_expense_account_code ?? '',
      vatRate: vat.enabled ? vat.paid : null,
      supplier: defaultSupplier(line),
    }
  }
  if (line.suggestion.invoiceMatches.length === 1) {
    return { kind: 'reconcile_invoice', invoiceId: line.suggestion.invoiceMatches[0].id }
  }
  return {
    kind: 'journal_received',
    contraAccountCode: settings?.default_revenue_account_code ?? '',
    vatRate: vat.enabled ? vat.received : null,
  }
}

type PaidDecision = Extract<Decision, { kind: 'journal_paid' }>
type JournalDecision = PaidDecision | Extract<Decision, { kind: 'journal_received' }>

// A pending "book the rest of this relation's lines here too?" question.
// `kind` picks the copy — money paid to a supplier vs. received from a payer —
// and is also what keeps the two sides of one relation apart.
interface ApplyPrompt {
  kind: 'paid' | 'received'
  relationName: string
  accountCode: string
  accountLabel: string
  lineIds: Id[]
  tokens: string[]
}

// Statement identity of the relation on a journal line: the supplier contact the
// user linked (outgoing lines only — incoming lines carry no contact link) plus
// the counterparty IBAN/name the bank reported. Two lines are the same relation
// when they share *any* token — a bank varies the counterparty name between
// lines of one party, and the parse-time matcher may have linked only some of
// them.
// "Only this line" is remembered per direction + relation + account, so editing
// a third line of that relation doesn't ask again.
const dismissKey = (kind: 'paid' | 'received', token: string, code: string) => `${kind}|${token}|${code}`

function relationTokens(line: BankStatementLine, decision: JournalDecision): string[] {
  const tokens: string[] = []
  if (decision.kind === 'journal_paid' && decision.supplier.kind === 'link') {
    tokens.push(`link:${decision.supplier.id}`)
  }
  if (line.counterparty_iban) tokens.push(`iban:${line.counterparty_iban.replace(/\s+/g, '').toUpperCase()}`)
  if (line.counterparty_name?.trim()) tokens.push(`name:${line.counterparty_name.trim().toLowerCase()}`)
  return tokens
}

// How to name the relation in the "apply to all" prompt: the linked supplier
// when there is one, else what the bank called the counterparty.
function relationLabel(line: BankStatementLine, decision: JournalDecision): string {
  if (decision.kind === 'journal_paid') {
    const { supplier } = decision
    if (supplier.kind === 'link') {
      const match = line.suggestion.supplierMatches.find((s) => s.id === supplier.id)
      if (match?.name) return match.name
    }
    if (supplier.kind === 'create' && supplier.name.trim()) return supplier.name.trim()
  }
  return line.counterparty_name?.trim() || line.counterparty_iban || ''
}

function defaultSupplier(line: BankStatementLine): SupplierChoice {
  const matches = line.suggestion.supplierMatches
  // Auto-link only on a single unambiguous match. With the deliberately
  // non-unique IBAN model, several matches require an explicit user choice, so
  // nothing is pre-selected.
  if (matches.length === 1 && matches[0].id != null) return { kind: 'link', id: matches[0].id }
  if (matches.length === 0 && line.counterparty_name) {
    return { kind: 'create', name: line.counterparty_name, iban: line.counterparty_iban }
  }
  return { kind: 'none' }
}

interface BankStatementImportDialogProps {
  onClose: (imported: boolean) => void
}

export default function BankStatementImportDialog({ onClose }: Readonly<BankStatementImportDialogProps>) {
  const { t } = useTranslation('ledger')
  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<BankImportParseResult | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [accounts, setAccounts] = useState<Account[]>([])
  const [settings, setSettings] = useState<AccountingSettings | null>(null)
  const [result, setResult] = useState<BankImportResult | null>(null)
  const [cancelling, setCancelling] = useState(false)
  // Local flag so the opening-balance nudge disappears once the user acts on it
  // (the server flag itself flips on the next parse).
  const [openingBalanceSet, setOpeningBalanceSet] = useState(false)
  // Offer to book every other line of the same supplier to the account just
  // picked. `dismissedApply` remembers "only this line" per supplier+account so
  // editing a third line of that supplier doesn't ask again.
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
      getProfile().catch(() => null),
      getAccountingProfile().catch(() => null),
    ])
      .then(([accs, setts, profile, accounting]) => {
        if (!active) return
        setAccounts(accs)
        setSettings(setts)
        if (profile && accounting) setVat(resolveVatDefaults(profile, accounting))
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
        // A line whose bill is already paid starts on Skip: the payment leg is
        // in the ledger already, so booking it again would double the expense
        // (and the VAT deduction). The reviewer can still book it — the toggle
        // hands back the ordinary decision — but not by accident.
        seeded[keyOf(line)] = line.suggestion.paidPurchaseMatches.length
          ? { kind: 'skip' }
          : defaultDecision(line, settings, vat)
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

  // Picking a contra account offers to book the relation's other lines the same
  // way — statements repeat the same party, and booking each occurrence by hand
  // is where mis-classifications creep in. Outgoing and incoming lines of one
  // party are grouped separately: an expense account is no answer for a receipt.
  function setContraAccount(line: BankStatementLine, decision: JournalDecision, code: string) {
    const updated = { ...decision, contraAccountCode: code }
    setDecision(line, updated)

    const kind = updated.kind === 'journal_paid' ? 'paid' : 'received'
    const tokens = relationTokens(line, updated)
    const name = relationLabel(line, updated)
    if (!tokens.length || !name) return
    if (tokens.some((token) => dismissedApply.has(dismissKey(kind, token, code)))) return

    const siblings = pendingLines.filter((other) => {
      if (other.id === line.id) return false
      const d = decisions[keyOf(other)]
      if (d?.kind !== 'journal_paid' && d?.kind !== 'journal_received') return false
      if (d.kind !== updated.kind || d.contraAccountCode === code) return false
      return relationTokens(other, d).some((token) => tokens.includes(token))
    })
    if (!siblings.length) return

    const account = accounts.find((a) => a.code === code)
    setApplyPrompt({
      kind,
      relationName: name,
      accountCode: code,
      accountLabel: account ? `${account.code} — ${account.name}` : code,
      lineIds: siblings.map((s) => s.id),
      tokens,
    })
  }

  function applyAccountToRelation() {
    if (!applyPrompt) return
    const targets = new Set(applyPrompt.lineIds.map(String))
    setDecisions((prev) => {
      const next: Record<string, Decision> = { ...prev }
      for (const [key, decision] of Object.entries(prev)) {
        if (!targets.has(key)) continue
        if (decision.kind === 'journal_paid' || decision.kind === 'journal_received') {
          next[key] = { ...decision, contraAccountCode: applyPrompt.accountCode }
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
        next.add(dismissKey(applyPrompt.kind, token, applyPrompt.accountCode))
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
      else if (d.kind === 'journal_received') {
        out.push({
          line_id: line.id, action: 'journal_received',
          contra_account_code: d.contraAccountCode || defaultIncomeCode,
          vat_rate: d.vatRate,
        })
      } else {
        const base = {
          line_id: line.id,
          action: 'journal_paid' as const,
          contra_account_code: d.contraAccountCode || defaultExpenseCode,
          vat_rate: d.vatRate,
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
    <Dialog open fullWidth maxWidth="lg">
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
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
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
            expenseAccounts={expenseAccounts}
            incomeAccounts={incomeAccounts}
            settings={settings}
            vat={vat}
            statementIban={statementIban}
          />
        )}

        {step === 'done' && result && <DoneStep result={result} />}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={step === 'importing' || cancelling}>
          {result ? t($ => $.bankImport.close) : t($ => $.bankImport.cancel)}
        </Button>
        {step === 'review' && (
          <Button variant="contained" disabled={!pendingLines.length || hasIncompleteSupplier} onClick={runImport}>
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
          onApply={applyAccountToRelation}
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
  // Paid and received get their own sentences rather than one sentence with a
  // direction hole — the words around the name inflect differently per language.
  const copy = prompt.kind
  return (
    <Dialog open onClose={onDismiss} maxWidth="xs" fullWidth>
      <DialogTitle>
        {t($ => $.bankImport.applyToRelation[copy].title, { name: prompt.relationName })}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          {t($ => $.bankImport.applyToRelation[copy].body, {
            count: prompt.lineIds.length,
            name: prompt.relationName,
            account: prompt.accountLabel,
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
  expenseAccounts: Account[]
  incomeAccounts: Account[]
  settings: AccountingSettings | null
  vat: VatDefaults
  statementIban: string | null | undefined
}

function ReviewStep({
  parsed, decisions, setDecision, setContraAccount, expenseAccounts, incomeAccounts, settings, vat, statementIban,
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

      {parsed.lines.map((line) => (
        <LineCard
          key={String(line.id)}
          line={line}
          decision={decisions[String(line.id)]}
          setDecision={setDecision}
          setContraAccount={setContraAccount}
          expenseAccounts={expenseAccounts}
          incomeAccounts={incomeAccounts}
          settings={settings}
          vat={vat}
        />
      ))}
    </>
  )
}

interface LineCardProps {
  line: BankStatementLine
  decision: Decision | undefined
  setDecision: (line: BankStatementLine, decision: Decision) => void
  setContraAccount: (line: BankStatementLine, decision: JournalDecision, code: string) => void
  expenseAccounts: Account[]
  incomeAccounts: Account[]
  settings: AccountingSettings | null
  vat: VatDefaults
}

function LineCard({
  line, decision, setDecision, setContraAccount, expenseAccounts, incomeAccounts, settings, vat,
}: Readonly<LineCardProps>) {
  const { t } = useTranslation('ledger')
  const statusLabel = useStatusLabel()
  const isDebit = line.direction === 'debit'
  const signed = isDebit ? -line.amount_cents : line.amount_cents
  const isPending = line.status === 'pending'
  const skipped = !decision || decision.kind === 'skip'

  function onDecisionMode(mode: 'book' | 'skip' | null) {
    if (mode === null) return
    if (mode === 'skip') return setDecision(line, { kind: 'skip' })
    setDecision(line, defaultDecision(line, settings, vat))
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, opacity: isPending && skipped ? 0.65 : 1 }}>
      {/* Facts grouped on the left; decision on the right */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {formatShortDate(line.booking_date)}
            </Typography>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {line.counterparty_name || '—'}
            </Typography>
            {line.is_reversal && <Chip size="small" variant="outlined" label="↺" />}
            {line.suggestion?.possibleDuplicate && (
              <Chip size="small" color="warning" variant="outlined" label={t($ => $.bankImport.duplicate)} />
            )}
            {line.suggestion?.paidPurchaseMatches?.map((bill) => (
              <Chip
                key={`paid-${bill.id}`}
                size="small"
                color="warning"
                variant="outlined"
                label={t($ => $.bankImport.alreadyPaid, {
                  number: bill.receipt_number,
                  date: formatShortDate(bill.paid_at),
                })}
              />
            ))}
          </Box>
          {line.remittance_info && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: 'text.secondary' }}>
              {line.remittance_info}
            </Typography>
          )}
        </Box>

        <Typography sx={{ fontWeight: 600, whiteSpace: 'nowrap', alignSelf: 'center', color: signed < 0 ? 'error.main' : 'success.main' }}>
          {formatEur(signed)}
        </Typography>

        {isPending ? (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={skipped ? 'skip' : 'book'}
            onChange={(_e, v) => onDecisionMode(v)}
          >
            <ToggleButton value="book">
              {isDebit ? t($ => $.bankImport.decision.expense) : t($ => $.bankImport.decision.income)}
            </ToggleButton>
            <ToggleButton value="skip">{t($ => $.bankImport.decision.skip)}</ToggleButton>
          </ToggleButtonGroup>
        ) : (
          <Chip size="small" variant="outlined" label={statusLabel(line.status)} sx={{ alignSelf: 'center' }} />
        )}
      </Box>

      {/* How the line is booked, on what account, which supplier — supplier on
          its own row above the booking/VAT columns */}
      {isPending && !skipped && decision && (
        <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'flex-start' }}>
          <BookingDetail
            line={line}
            decision={decision}
            setDecision={setDecision}
            setContraAccount={setContraAccount}
            expenseAccounts={expenseAccounts}
            incomeAccounts={incomeAccounts}
            vat={vat}
          />
        </Box>
      )}
    </Paper>
  )
}

// value encodes how the line is booked: inv:<id> | pur:<id> | journal
function methodValue(decision: Decision): string {
  if (decision.kind === 'reconcile_invoice') return `inv:${decision.invoiceId}`
  if (decision.kind === 'reconcile_purchase') return `pur:${decision.purchaseId}`
  return 'journal'
}

interface BookingDetailProps {
  line: BankStatementLine
  decision: Exclude<Decision, { kind: 'skip' }>
  setDecision: (line: BankStatementLine, decision: Decision) => void
  setContraAccount: (line: BankStatementLine, decision: JournalDecision, code: string) => void
  expenseAccounts: Account[]
  incomeAccounts: Account[]
  vat: VatDefaults
}

function BookingDetail({
  line, decision, setDecision, setContraAccount, expenseAccounts, incomeAccounts, vat,
}: Readonly<BookingDetailProps>) {
  const { t } = useTranslation('ledger')
  const isDebit = line.direction === 'debit'
  const accounts = isDebit ? expenseAccounts : incomeAccounts
  const methodId = `bank-import-method-${line.id}`
  const accountId = `bank-import-account-${line.id}`
  const hasMatches = line.suggestion.invoiceMatches.length > 0 || line.suggestion.purchaseMatches.length > 0

  function toJournal(): Decision {
    if (isDebit) {
      return {
        kind: 'journal_paid',
        contraAccountCode: expenseAccounts[0]?.code ?? '',
        vatRate: vat.enabled ? vat.paid : null,
        supplier: defaultSupplier(line),
      }
    }
    return {
      kind: 'journal_received',
      contraAccountCode: incomeAccounts[0]?.code ?? '',
      vatRate: vat.enabled ? vat.received : null,
    }
  }

  function onMethod(value: string) {
    if (value.startsWith('inv:')) return setDecision(line, { kind: 'reconcile_invoice', invoiceId: idFrom(value) })
    if (value.startsWith('pur:')) return setDecision(line, { kind: 'reconcile_purchase', purchaseId: idFrom(value) })
    setDecision(line, toJournal())
  }

  const isJournal = decision.kind === 'journal_paid' || decision.kind === 'journal_received'

  // Headline of the gig linked to the currently reconciled invoice, if any —
  // event name · venue/festival · date — so the reviewer sees what it was for.
  const matchedInvoice = decision.kind === 'reconcile_invoice'
    ? line.suggestion.invoiceMatches.find((inv) => inv.id === decision.invoiceId)
    : undefined
  const gig = matchedInvoice?.gig ?? null
  const gigDetails = gig
    ? [
      gig.event_description,
      gig.venue_name || gig.festival_name,
      gig.event_date ? formatShortDate(gig.event_date) : null,
    ].filter(Boolean).join(' · ')
    : ''

  return (
    <>
      {/* Row 1 — the optional new supplier */}
      {decision.kind === 'journal_paid' && (
        <SupplierControl line={line} decision={decision} setDecision={setDecision} />
      )}

      {/* Row 2 — how the line books (fixed column) then its VAT, so the VAT
          controls line up down the statement instead of drifting with the
          width of each row's other controls. */}
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Box sx={{ width: BOOKING_COLUMN, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* How the line is booked: reconcile a matched doc, or a new journal entry */}
          {hasMatches && (
            <FormControl size="small" fullWidth>
              <InputLabel id={methodId}>{t($ => $.bankImport.bookingMethod)}</InputLabel>
              <Select labelId={methodId} label={t($ => $.bankImport.bookingMethod)} value={methodValue(decision)} onChange={(e) => onMethod(e.target.value)}>
                {line.suggestion.invoiceMatches.map((inv) => (
                  <MenuItem key={`inv-${inv.id}`} value={`inv:${inv.id}`}>
                    {inv.mollie_payment_link_id
                      ? t($ => $.bankImport.actions.matchInvoiceDeactivateMollie, { number: inv.invoice_number })
                      : t($ => $.bankImport.actions.matchInvoice, { number: inv.invoice_number })}
                  </MenuItem>
                ))}
                {line.suggestion.purchaseMatches.map((pur) => (
                  <MenuItem key={`pur-${pur.id}`} value={`pur:${pur.id}`}>
                    {t($ => $.bankImport.actions.matchPurchase, { number: pur.receipt_number })}
                  </MenuItem>
                ))}
                <MenuItem value="journal">
                  {isDebit ? t($ => $.bankImport.actions.bookExpense) : t($ => $.bankImport.actions.bookIncome)}
                </MenuItem>
              </Select>
            </FormControl>
          )}

          {/* On what account (journal only — a reconciled doc carries its own accounts) */}
          {isJournal && (
            <FormControl size="small" fullWidth>
              <InputLabel id={accountId}>{isDebit ? t($ => $.bankImport.expenseAccount) : t($ => $.bankImport.incomeAccount)}</InputLabel>
              <Select
                labelId={accountId}
                label={isDebit ? t($ => $.bankImport.expenseAccount) : t($ => $.bankImport.incomeAccount)}
                value={decision.contraAccountCode}
                onChange={(e) => setContraAccount(line, decision, e.target.value)}
              >
                {accounts.map((a) => (
                  <MenuItem key={String(a.code)} value={a.code}>{a.code} — {a.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>

        {/* Whether the gross amount contains VAT, and at what rate */}
        {isJournal && vat.enabled && (
          <VatControl line={line} decision={decision} setDecision={setDecision} vat={vat} />
        )}

        {/* What the reconciled invoice was for: its linked gig — sits in the
            VAT slot, which a reconciled line never uses. */}
        {gigDetails && (
          <Chip
            size="small"
            variant="outlined"
            color="info"
            label={t($ => $.bankImport.gigLabel, { details: gigDetails })}
          />
        )}
      </Box>
    </>
  )
}

interface VatControlProps {
  line: BankStatementLine
  decision: JournalDecision
  setDecision: (line: BankStatementLine, decision: Decision) => void
  vat: VatDefaults
}

// VAT on a direct booking. A statement carries only the gross amount — neither
// CAMT.053 nor MT940 reports a breakdown — so the rate is the reviewer's call
// and the split is derived from it. "No VAT" is the yes/no half of the control;
// the rates come from the tenant's VAT country, so this follows a band that
// moved jurisdictions rather than hardcoding one country's pair.
function VatControl({ line, decision, setDecision, vat }: Readonly<VatControlProps>) {
  const { t } = useTranslation('ledger')
  const labelId = `bank-import-vat-${line.id}`
  const rate = decision.vatRate
  const { netCents, vatCents } = computePurchaseLineTotals({
    amount_incl_cents: line.amount_cents, tax_rate: rate ?? 0,
  })
  // 0% and "No VAT" post identically (no VAT leg), so offering both would be a
  // distinction without a difference — only real rates are listed.
  const rates = vatRateOptions(vat.country, rate).filter((r) => r > 0)

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
      <FormControl size="small" sx={{ width: VAT_COLUMN, flexShrink: 0 }}>
        <InputLabel id={labelId}>{t($ => $.bankImport.vat.label)}</InputLabel>
        <Select
          labelId={labelId}
          label={t($ => $.bankImport.vat.label)}
          value={rate == null ? 'none' : String(rate)}
          onChange={(e) => setDecision(line, {
            ...decision,
            vatRate: e.target.value === 'none' ? null : Number(e.target.value),
          })}
        >
          <MenuItem value="none">{t($ => $.bankImport.vat.none)}</MenuItem>
          {rates.map((r) => (
            <MenuItem key={r} value={String(r)}>{t($ => $.bankImport.vat.rate, { rate: r })}</MenuItem>
          ))}
        </Select>
      </FormControl>
      {rate != null && rate > 0 && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {t($ => $.bankImport.vat.split, { net: formatEur(netCents), vat: formatEur(vatCents) })}
        </Typography>
      )}
    </Box>
  )
}

function idFrom(value: string): Id {
  return Number(value.slice(value.indexOf(':') + 1))
}

interface SupplierControlProps {
  line: BankStatementLine
  decision: Extract<Decision, { kind: 'journal_paid' }>
  setDecision: (line: BankStatementLine, decision: Decision) => void
}

// value: link:<id> | create | none
function SupplierControl({ line, decision, setDecision }: Readonly<SupplierControlProps>) {
  const { t } = useTranslation('ledger')
  const labelId = `bank-import-supplier-${line.id}`
  const createSupplier = decision.supplier.kind === 'create' ? decision.supplier : null
  const value = decision.supplier.kind === 'link'
    ? `link:${decision.supplier.id}`
    : decision.supplier.kind

  function onChange(v: string) {
    let supplier: SupplierChoice
    if (v.startsWith('link:')) supplier = { kind: 'link', id: idFrom(v) }
    else if (v === 'create') supplier = { kind: 'create', name: line.counterparty_name ?? '', iban: line.counterparty_iban }
    else supplier = { kind: 'none' }
    setDecision(line, { ...decision, supplier })
  }

  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id={labelId}>{t($ => $.bankImport.supplier.label)}</InputLabel>
        <Select labelId={labelId} label={t($ => $.bankImport.supplier.label)} value={value} onChange={(e) => onChange(e.target.value)}>
          {line.suggestion.supplierMatches.map((s) => (
            <MenuItem key={`s-${s.id}`} value={`link:${s.id}`}>{s.name}</MenuItem>
          ))}
          <MenuItem value="create">
            {line.counterparty_name
              ? t($ => $.bankImport.supplier.create, { name: line.counterparty_name })
              : t($ => $.bankImport.supplier.createNew)}
          </MenuItem>
          <MenuItem value="none">{t($ => $.bankImport.supplier.none)}</MenuItem>
        </Select>
      </FormControl>
      {createSupplier && (
        <TextField
          size="small"
          label={t($ => $.bankImport.supplier.name)}
          value={createSupplier.name}
          error={!createSupplier.name.trim()}
          onChange={(e) => setDecision(line, {
            ...decision,
            supplier: {
              kind: 'create',
              name: e.target.value,
              iban: createSupplier.iban,
            },
          })}
        />
      )}
    </Box>
  )
}

const RESULT_STATUS_KEYS = [
  'imported', 'reconciled_invoice', 'reconciled_purchase', 'skipped', 'skipped_currency', 'pending',
  'skipped_already_committed', 'skipped_amount_mismatch', 'skipped_invalid_account',
  'skipped_direction_mismatch', 'skipped_invoice_not_open', 'skipped_invoice_has_link',
  'skipped_bill_not_open', 'skipped_not_found', 'skipped_invalid_supplier', 'skipped_vat_not_allowed',
  'skipped_closed_period', 'skipped_accounting_not_configured',
  'skipped_invoice_paid_via_mollie', 'skipped_mollie_error',
  'skipped_mollie_reconciliation_conflict',
] as const

// Maps a line/commit status code to its localized label, falling back to the
// raw code. Shared by the review table (re-uploaded lines) and the done step.
function useStatusLabel(): (status: string) => string {
  const { t } = useTranslation('ledger')
  return (status) => {
    const key = (RESULT_STATUS_KEYS as readonly string[]).includes(status)
      ? (status as typeof RESULT_STATUS_KEYS[number]) : null
    return key ? t($ => $.bankImport.lineStatus[key]) : status
  }
}

function DoneStep({ result }: Readonly<{ result: BankImportResult }>) {
  const { t } = useTranslation('ledger')
  const statusLabel = useStatusLabel()
  const notes = result.results.filter((r) => r.status !== 'imported'
    && r.status !== 'reconciled_invoice' && r.status !== 'reconciled_purchase')

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
