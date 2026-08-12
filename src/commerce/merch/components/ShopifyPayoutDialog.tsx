import AddIcon from '@mui/icons-material/Add'
import RefreshIcon from '@mui/icons-material/Refresh'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import DateEntryField from '../../../components/DateEntryField.tsx'
import { ShopifyCustomPayoutForm } from './shopifyPayoutDialog/ShopifyCustomPayoutForm.tsx'
import { ShopifyPayoutCard } from './shopifyPayoutDialog/ShopifyPayoutCard.tsx'
import { useShopifyPayoutDialog } from './useShopifyPayoutDialog.ts'

interface Props {
  onClose: (recorded: boolean) => void
}

export default function ShopifyPayoutDialog({ onClose }: Readonly<Props>) {
  const { t } = useTranslation('merch')
  const dialog = useShopifyPayoutDialog()

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>{t($ => $.shopifyPayout.title)}</DialogTitle>
      <DialogContent dividers>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t($ => $.shopifyPayout.intro)}
        </Typography>
        {dialog.error && <Alert severity="error" sx={{ mb: 2 }}>{dialog.error}</Alert>}
        {dialog.success && (
          <Alert severity="success" sx={{ mb: 2 }}>{t($ => $.shopifyPayout.recorded)}</Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
          <DateEntryField
            id="shopify-payout-from"
            label={t($ => $.shopifyPayout.fromDate)}
            value={dialog.fromDate}
            onChange={(event) => dialog.setFromDate(event.target.value)}
            size="small"
          />
          <DateEntryField
            id="shopify-payout-to"
            label={t($ => $.shopifyPayout.toDate)}
            value={dialog.toDate}
            onChange={(event) => dialog.setToDate(event.target.value)}
            size="small"
          />
          <Button
            variant="outlined"
            startIcon={dialog.refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
            disabled={dialog.refreshing || !dialog.fromDate || !dialog.toDate}
            onClick={dialog.refresh}
          >
            {t($ => $.shopifyPayout.refresh)}
          </Button>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            disabled={!dialog.customCandidates.length}
            onClick={dialog.openCustom}
          >
            {t($ => $.shopifyPayout.createCustom)}
          </Button>
        </Stack>

        {dialog.customOpen && (
          <ShopifyCustomPayoutForm
            candidates={dialog.customCandidates}
            selectedCandidates={dialog.selectedCandidates}
            selected={dialog.customSelected}
            reference={dialog.customReference}
            date={dialog.customDate}
            netCents={dialog.customNetCents}
            expectedNetCents={dialog.expectedCustomNet}
            creating={dialog.creatingCustom}
            onReferenceChange={dialog.setCustomReference}
            onDateChange={dialog.setCustomDate}
            onNetCentsChange={dialog.setCustomNetCents}
            onCandidateToggle={dialog.toggleCustomCandidate}
            onCreate={dialog.createCustom}
            onCancel={dialog.closeCustom}
          />
        )}

        {dialog.loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress /></Box>
        ) : dialog.payouts.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            {t($ => $.shopifyPayout.empty)}
          </Typography>
        ) : (
          <Stack spacing={2}>
            {dialog.payouts.map((payout) => (
              <ShopifyPayoutCard
                key={String(payout.id)}
                payout={payout}
                accounts={dialog.pnlAccounts}
                entryDate={dialog.entryDates[String(payout.id)] ?? ''}
                mappings={dialog.mappings}
                complete={dialog.isPayoutComplete(payout)}
                settling={dialog.settlingId != null}
                onEntryDateChange={(date) => dialog.setEntryDate(payout.id, date)}
                onAdjustmentAccountChange={(adjustmentId, accountCode) => (
                  dialog.setAdjustmentAccount(payout.id, adjustmentId, accountCode)
                )}
                onSettle={() => dialog.settle(payout)}
              />
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(dialog.success)}>{t($ => $.shopifyPayout.close)}</Button>
      </DialogActions>
    </Dialog>
  )
}
