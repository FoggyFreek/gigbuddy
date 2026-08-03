import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import type {
  Account,
  AccountingSettings,
  BankImportParseResult,
  BankStatementLine,
} from '../../../types/entities.ts'
import { formatShortDate } from '../../../utils/dateFormat.ts'
import { formatEur } from '../../../utils/invoiceTotals.ts'
import BankImportLinesGrid from './BankImportLinesGrid.tsx'
import type { Decision, JournalDecision, VatDefaults } from './decisions.ts'
import type { VatOption } from './vatOptions.ts'

interface Props {
  parsed: BankImportParseResult
  decisions: Record<string, Decision>
  expenseAccounts: Account[]
  incomeAccounts: Account[]
  settings: AccountingSettings | null
  vat: VatDefaults
  openingBalanceSet: boolean
  refreshingShopify: boolean
  shopifyConfigured: boolean
  onDecisionChange: (line: BankStatementLine, decision: Decision) => void
  onContraAccountChange: (
    line: BankStatementLine,
    decision: JournalDecision,
    code: string,
  ) => void
  onVatTreatmentChange: (
    line: BankStatementLine,
    decision: JournalDecision,
    option: VatOption,
  ) => void
  onOpeningBalanceSet: () => void
  onRefreshShopify: () => void
}

export function BankImportReviewStep({
  parsed,
  decisions,
  expenseAccounts,
  incomeAccounts,
  settings,
  vat,
  openingBalanceSet,
  refreshingShopify,
  shopifyConfigured,
  onDecisionChange,
  onContraAccountChange,
  onVatTreatmentChange,
  onOpeningBalanceSet,
  onRefreshShopify,
}: Readonly<Props>) {
  const { t } = useTranslation('ledger')

  return (
    <>
      {parsed.openingBalanceSuggested && (
        openingBalanceSet ? (
          <Alert severity="success" sx={{ mb: 2 }}>
            {t($ => $.bankImport.openingBalance.done)}
          </Alert>
        ) : (
          <Alert
            severity="info"
            sx={{ mb: 2 }}
            action={(
              <Button color="inherit" size="small" onClick={onOpeningBalanceSet}>
                {t($ => $.bankImport.openingBalance.set)}
              </Button>
            )}
          >
            {t($ => $.bankImport.openingBalance.prompt, {
              amount: formatEur(parsed.import.opening_balance_cents ?? 0),
              date: parsed.import.opening_balance_date
                ? formatShortDate(parsed.import.opening_balance_date)
                : '',
            })}
          </Alert>
        )
      )}

      {!parsed.lines.length ? (
        <Typography sx={{ py: 3, textAlign: 'center', color: 'text.secondary' }}>
          {t($ => $.bankImport.empty)}
        </Typography>
      ) : (
        <>
          {parsed.import.account_iban && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t($ => $.bankImport.accountMismatch, { iban: parsed.import.account_iban })}
            </Alert>
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
              {refreshingShopify
                ? t($ => $.bankImport.shopify.refreshing)
                : t($ => $.bankImport.shopify.refresh)}
            </Button>
          )}

          <BankImportLinesGrid
            lines={parsed.lines}
            decisions={decisions}
            setDecision={onDecisionChange}
            setContraAccount={onContraAccountChange}
            setVatTreatment={onVatTreatmentChange}
            expenseAccounts={expenseAccounts}
            incomeAccounts={incomeAccounts}
            settings={settings}
            vat={vat}
            shopifyConfigured={shopifyConfigured}
          />
        </>
      )}
    </>
  )
}
