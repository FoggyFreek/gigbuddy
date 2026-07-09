import type { Id, Member, Account, Purchase, PurchasePaymentMethod, PurchaseStatus } from '../types/entities.ts'
import { useTranslation } from 'react-i18next'
import type { UsePurchaseFormStateResult } from './purchases/usePurchaseFormState.ts'
import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import IconButton from '@mui/material/IconButton'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined'
import VolunteerActivismOutlinedIcon from '@mui/icons-material/VolunteerActivismOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DeleteIcon from '@mui/icons-material/Delete'
import CloseIcon from '@mui/icons-material/Close'
import { purchaseStatusColor } from '../utils/purchaseStatus.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { usePurchaseFormState } from './purchases/usePurchaseFormState.ts'
import PurchaseAttachmentsViewer from './purchases/PurchaseAttachmentsViewer.tsx'
import PurchaseSupplierFields from './purchases/PurchaseSupplierFields.tsx'
import PurchaseLinesEditor from './purchases/PurchaseLinesEditor.tsx'
import PurchaseTotalsPanel from './purchases/PurchaseTotalsPanel.tsx'
import DateEntryField from './DateEntryField.tsx'

function accountLabel(account: Account | { code: string } | null, fallback: string): string {
  if (!account) return fallback
  const acc = account as Account
  if (!acc.code) return fallback
  return acc.name ? `${acc.code} - ${acc.name}` : acc.code
}

interface BandMemberOption {
  id?: Id
  name?: string
  role?: string
  user_id?: Id | null
}

interface PaymentRegistrationDialogProps {
  open: boolean
  saving?: boolean
  error?: string | null
  method: PurchasePaymentMethod
  paidOn?: string
  paidByBandMemberId?: Id | null
  bandMembers: Member[]
  onClose: () => void
  onMethodChange: (method: PurchasePaymentMethod) => void
  onPaidOnChange: (date: string) => void
  onPaidByBandMemberIdChange: (id: Id | null) => void
  onSubmit: () => void
}

function PaymentRegistrationDialog({
  open,
  saving,
  error,
  method,
  paidOn,
  paidByBandMemberId,
  bandMembers,
  onClose,
  onMethodChange,
  onPaidOnChange,
  onPaidByBandMemberIdChange,
  onSubmit,
}: Readonly<PaymentRegistrationDialogProps>) {
  const { t } = useTranslation(['purchases', 'common'])
  const hasBandMembers = bandMembers.length > 0
  const selectedPayee = bandMembers.find((m) => Number(m.id) === Number(paidByBandMemberId)) || null

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t($ => $.payment.dialogTitle)}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'grid', gap: 2 }}>
          <DateEntryField
            label={t($ => $.payment.paidOn)}
            openPickerLabel={t($ => $.payment.openPaidOnPicker)}
            size="small"
            fullWidth
            value={paidOn || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPaidOnChange(e.target.value)}
            disabled={saving}
          />
          <FormControl>
            <FormLabel>{t($ => $.payment.method)}</FormLabel>
            <RadioGroup
              value={method}
              onChange={(e) => onMethodChange(e.target.value as PurchasePaymentMethod)}
            >
              <FormControlLabel value="bank" control={<Radio />} label={t($ => $.payment.bank)} disabled={saving} />
              <FormControlLabel
                value="member"
                control={<Radio />}
                label={t($ => $.payment.bandMember)}
                disabled={saving || !hasBandMembers}
              />
            </RadioGroup>
          </FormControl>
          {!hasBandMembers && (
            <Alert severity="info">
              {t($ => $.payment.noBandMembers)}
            </Alert>
          )}
          {method === 'member' && (
            <Autocomplete<BandMemberOption>
              size="small"
              fullWidth
              options={bandMembers}
              value={selectedPayee}
              disabled={saving}
              onChange={(_e, picked) => onPaidByBandMemberIdChange(picked?.id ?? null)}
              getOptionLabel={(m) => {
                if (!m) return ''
                const role = m.role ? ` (${m.role})` : ''
                return `${m.name}${role}`
              }}
              isOptionEqualToValue={(option, value) => Number(option.id) === Number(value.id)}
              renderInput={(params) => <TextField {...params} label={t($ => $.payment.paidBy)} />}
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" onClick={onSubmit} disabled={saving}>
          {t($ => $.payment.register)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

interface PaidPaymentSummaryProps {
  purchase: Purchase
  bandMembers: Member[]
  paymentAccount: Account | { code: string } | null
}

function PaidPaymentSummary({ purchase, bandMembers, paymentAccount }: Readonly<PaidPaymentSummaryProps>) {
  const { t } = useTranslation('purchases')
  const isMemberPayment = purchase.payment_method === 'member'
  const bandMember = isMemberPayment
    ? bandMembers.find((m) => Number(m.id) === Number(purchase.paid_by_band_member_id))
    : null
  let payer: string
  if (!isMemberPayment) payer = accountLabel(paymentAccount, t($ => $.payment.bankAccount))
  else if (bandMember?.name) payer = bandMember.name
  else if (purchase.paid_by_band_member_id) payer = t($ => $.payment.bandMemberNumber, { number: purchase.paid_by_band_member_id })
  else payer = t($ => $.payment.bandMember)
  const label = isMemberPayment ? t($ => $.payment.paidBy) : t($ => $.payment.paidFrom)

  return (
    <Box
      sx={{
        mt: 2,
        p: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        bgcolor: 'action.hover',
        borderRadius: 2,
      }}
    >
      <VolunteerActivismOutlinedIcon color="success" fontSize="small" />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" noWrap title={payer} sx={{ fontWeight: 600 }}>
          {payer}
        </Typography>
      </Box>
    </Box>
  )
}

interface PurchaseDetailsLoadingProps {
  embedded: boolean
  onClose: (updated?: boolean) => void
}

function PurchaseDetailsLoading({ embedded, onClose }: Readonly<PurchaseDetailsLoadingProps>) {
  const spinner = (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress />
    </Box>
  )
  if (embedded) return spinner
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={() => onClose(false)}>
      <DialogContent>{spinner}</DialogContent>
    </Dialog>
  )
}

interface PurchaseCardTitleProps {
  purchase: Purchase | null
  receiptNumber: number | null | undefined
  canEditNumber: boolean
  onReceiptNumberChange: (value: number | null) => void
}

function PurchaseCardTitle({ purchase, receiptNumber, canEditNumber, onReceiptNumberChange }: Readonly<PurchaseCardTitleProps>) {
  const { t } = useTranslation(['purchases', 'common'])
  const [editingNumber, setEditingNumber] = useState(false)

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
      {editingNumber ? (
        <TextField
          size="small"
          type="number"
          autoFocus
          value={receiptNumber ?? ''}
          onChange={(e) => onReceiptNumberChange(Number(e.target.value) || null)}
          onBlur={() => setEditingNumber(false)}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
          sx={{ width: 120 }}
        />
      ) : (
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {t($ => $.detail.heading, { number: purchase?.receipt_number ?? '' })}
        </Typography>
      )}
      {canEditNumber && !editingNumber && (
        <IconButton size="small" onClick={() => setEditingNumber(true)} aria-label={t($ => $.detail.editReceiptNumber)}>
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
      )}
      {purchase && (
        <Chip size="small" color={purchaseStatusColor(purchase.status) as 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'} label={purchase.status ? t($ => $.rawStatus[purchase.status as PurchaseStatus]) : ''} />
      )}
    </Box>
  )
}

// Receipt preview left of the form on desktop, stacked full-width in compact layout.
function embeddedRowSx(isCompact: boolean) {
  return {
    display: 'flex',
    flexDirection: isCompact ? 'column' : 'row',
    gap: 3,
    alignItems: isCompact ? 'flex-start' : 'stretch',
  } as const
}

function embeddedColumnSx(isCompact: boolean, desktopFlex: string) {
  return {
    flex: isCompact ? '0 0 auto' : desktopFlex,
    minWidth: 0,
    width: isCompact ? '100%' : 'auto',
  } as const
}

interface PurchaseDetailsProps {
  mode: 'create' | 'edit'
  purchaseId?: Id
  onClose: (updated?: boolean) => void
  onPurchaseUpdate?: (id: Id, patch: Partial<Purchase>) => void
  embedded?: boolean
}

export default function PurchaseDetails({ mode, purchaseId, onClose, onPurchaseUpdate, embedded = false }: Readonly<PurchaseDetailsProps>) {
  const { t } = useTranslation(['purchases', 'common'])
  // usePurchaseFormState always expects a purchaseId; in practice mode='create'
  // always pairs with a real id from NewPurchaseDialog.
  const s: UsePurchaseFormStateResult = usePurchaseFormState({ purchaseId: purchaseId!, onClose, onPurchaseUpdate })
  const isCompact = useCompactLayout()

  if (s.loading) return <PurchaseDetailsLoading embedded={embedded} onClose={onClose} />

  const canRegister = s.purchase?.status === 'approved'

  const cardTitle = (
    <PurchaseCardTitle
      purchase={s.purchase}
      receiptNumber={s.form?.receipt_number}
      canEditNumber={!s.readOnly}
      onReceiptNumberChange={(value) => s.patchForm({ receipt_number: value })}
    />
  )

  const registerPaymentButton = !s.isPaid && canRegister && (
    <Button
      variant="outlined"
      startIcon={<VolunteerActivismOutlinedIcon />}
      onClick={s.openPaymentDialog}
      disabled={s.saving}
    >
      {t($ => $.detail.registerPayment)}
    </Button>
  )

  const saveActions = !s.readOnly && (
    <>
      <Button
        variant="outlined"
        startIcon={<CloudUploadOutlinedIcon />}
        onClick={() => s.handleSave('draft')}
        disabled={s.saving}
      >
        {t($ => $.detail.saveAsDraft)}
      </Button>
      <Button
        variant="contained"
        startIcon={<CheckCircleOutlineIcon />}
        onClick={() => s.handleSave('approved')}
        disabled={s.saving}
      >
        {t($ => $.detail.approve)}
      </Button>
    </>
  )

  const bodyCards = (
    <>
      {s.error && <Alert severity="error" sx={{ mb: 2 }}>{s.error}</Alert>}

      <Box sx={{ mb: 2 }}>
        {embedded && cardTitle}
        {s.form && (
          <PurchaseSupplierFields form={s.form} patchForm={s.patchForm} readOnly={s.readOnly} />
        )}
        <Divider sx={{ my: 2 }} />
        {s.form && (
          <PurchaseLinesEditor
            form={s.form}
            totals={s.totals}
            accounts={s.lineAccounts}
            products={s.products}
            lineErrors={s.lineErrors}
            readOnly={s.readOnly}
            patchLine={s.patchLine}
            addLine={s.addLine}
            removeLine={s.removeLine}
          />
        )}
        {s.isPaid && s.purchase && (
          <PaidPaymentSummary
            purchase={s.purchase}
            bandMembers={s.bandMembers}
            paymentAccount={s.paymentAccount}
          />
        )}
      </Box>

      <Box>
        {s.form && <PurchaseTotalsPanel totals={s.totals} currency={s.form.currency} />}
      </Box>
    </>
  )

  const deleteDialog = (
    <Dialog open={s.deleteDialogOpen} onClose={() => s.setDeleteDialogOpen(false)}>
      <DialogTitle>{t($ => $.deleteDialog.title)}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t($ => $.deleteDialog.body)}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => s.setDeleteDialogOpen(false)}>{t($ => $.common.actions.cancel)}</Button>
        <Button color="error" onClick={s.confirmDelete}>{t($ => $.common.actions.delete)}</Button>
      </DialogActions>
    </Dialog>
  )

  const paymentDialog = (
    <PaymentRegistrationDialog
      open={s.paymentDialogOpen}
      saving={s.saving}
      error={s.paymentError}
      method={s.paymentMethod}
      paidOn={s.paidOn}
      paidByBandMemberId={s.paidByBandMemberId}
      bandMembers={s.bandMembers}
      onClose={s.closePaymentDialog}
      onMethodChange={s.setPaymentMethod}
      onPaidOnChange={s.setPaidOn}
      onPaidByBandMemberIdChange={s.setPaidByBandMemberId}
      onSubmit={s.handleRegisterPayment}
    />
  )

  // Receipt preview: left of the form on desktop, on top in compact layout.
  const attachmentsPanel = mode === 'edit' && (
    <PurchaseAttachmentsViewer
      attachments={s.attachments}
      busy={s.attachmentsBusy}
      error={s.attachmentError ?? undefined}
      onUpload={s.handleUploadAttachments}
      onDelete={s.handleDeleteAttachment}
    />
  )

  if (embedded) {
    return (
      <>
        <Box sx={embeddedRowSx(isCompact)}>
          <Box sx={embeddedColumnSx(isCompact, '1 1 45%')}>
            {attachmentsPanel}
          </Box>
          <Box sx={embeddedColumnSx(isCompact, '1 1 55%')}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, mb: 2 }}>
              {registerPaymentButton}
              {saveActions}
            </Box>
            {bodyCards}
            {!s.readOnly && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 2 }}>
                <Button color="error" startIcon={<DeleteIcon />} onClick={s.handleDelete}>
                  {t($ => $.common.actions.delete)}
                </Button>
              </Box>
            )}
          </Box>
        </Box>
        {deleteDialog}
        {paymentDialog}
      </>
    )
  }

  return (
    <>
      <Dialog open fullWidth maxWidth="sm" onClose={() => onClose(false)}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ flexGrow: 1 }}>{t($ => $.newDialog.title)}</Box>
          <IconButton size="small" onClick={() => onClose(false)} aria-label={t($ => $.common.actions.close)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>{bodyCards}</DialogContent>
        <DialogActions>
          <Button onClick={() => onClose(false)}>{t($ => $.common.actions.cancel)}</Button>
          {saveActions}
        </DialogActions>
      </Dialog>
      {deleteDialog}
      {paymentDialog}
    </>
  )
}
