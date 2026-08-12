import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import { useTranslation } from 'react-i18next'
import type { BankStatementImportDialogController } from '../useBankStatementImportDialog.ts'
import { ApplyToRelationDialog } from './ApplyToRelationDialog.tsx'
import { BankImportDoneStep } from './BankImportDoneStep.tsx'
import { BankImportReviewStep } from './BankImportReviewStep.tsx'
import { BankImportUploadStep } from './BankImportUploadStep.tsx'

interface Props {
  dialog: BankStatementImportDialogController
}

export function BankStatementImportDialogView({ dialog }: Readonly<Props>) {
  const { t } = useTranslation('ledger')

  return (
    <Dialog open fullWidth maxWidth="xl">
      <DialogTitle>{t($ => $.bankImport.title)}</DialogTitle>
      <DialogContent dividers>
        {dialog.error && <Alert severity="error" sx={{ mb: 2 }}>{dialog.error}</Alert>}

        {dialog.step === 'upload' && <BankImportUploadStep onFileSelect={dialog.selectFile} />}

        {dialog.step === 'importing' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {dialog.step === 'review' && dialog.parsed && (
          <BankImportReviewStep
            parsed={dialog.parsed}
            decisions={dialog.decisions}
            expenseAccounts={dialog.expenseAccounts}
            incomeAccounts={dialog.incomeAccounts}
            settings={dialog.settings}
            vat={dialog.vat}
            openingBalanceSet={dialog.openingBalanceSet}
            refreshingShopify={dialog.refreshingShopify}
            shopifyConfigured={dialog.shopifyConfigured}
            onDecisionChange={dialog.setDecision}
            onContraAccountChange={dialog.setContraAccount}
            onVatTreatmentChange={dialog.setVatTreatment}
            onOpeningBalanceSet={dialog.setOpeningBalance}
            onRefreshShopify={dialog.refreshShopify}
          />
        )}

        {dialog.step === 'done' && dialog.result && <BankImportDoneStep result={dialog.result} />}
      </DialogContent>

      <DialogActions>
        <Button
          onClick={dialog.close}
          disabled={dialog.step === 'importing' || dialog.cancelling}
        >
          {dialog.result ? t($ => $.bankImport.close) : t($ => $.bankImport.cancel)}
        </Button>
        {dialog.step === 'review' && (
          <Button variant="contained" disabled={dialog.importDisabled} onClick={dialog.runImport}>
            {dialog.toBookCount
              ? t($ => $.bankImport.importButton, { count: dialog.toBookCount })
              : t($ => $.bankImport.finish)}
          </Button>
        )}
      </DialogActions>

      {dialog.applyPrompt && (
        <ApplyToRelationDialog
          prompt={dialog.applyPrompt}
          onApply={dialog.applyToRelation}
          onDismiss={dialog.dismissApplyPrompt}
        />
      )}
    </Dialog>
  )
}
