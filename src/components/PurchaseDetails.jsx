import { useState } from 'react'
import PropTypes from 'prop-types'
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
import { purchaseStatusColor } from '../utils/purchaseStatus.js'
import { usePurchaseFormState } from './purchases/usePurchaseFormState.js'
import PurchaseSupplierFields from './purchases/PurchaseSupplierFields.jsx'
import PurchaseLinesEditor from './purchases/PurchaseLinesEditor.jsx'
import PurchaseTotalsPanel from './purchases/PurchaseTotalsPanel.jsx'
import DateEntryField from './DateEntryField.jsx'

function accountLabel(account) {
  if (!account?.code) return 'Bank account'
  return account.name ? `${account.code} - ${account.name}` : account.code
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
}) {
  const hasBandMembers = bandMembers.length > 0
  const selectedPayee = bandMembers.find((m) => Number(m.id) === Number(paidByBandMemberId)) || null

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Register payment</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'grid', gap: 2 }}>
          <DateEntryField
            label="Paid on"
            size="small"
            fullWidth
            value={paidOn || ''}
            onChange={(e) => onPaidOnChange(e.target.value)}
            disabled={saving}
          />
          <FormControl>
            <FormLabel>Payment method</FormLabel>
            <RadioGroup
              value={method}
              onChange={(e) => onMethodChange(e.target.value)}
            >
              <FormControlLabel value="bank" control={<Radio />} label="Bank" disabled={saving} />
              <FormControlLabel
                value="member"
                control={<Radio />}
                label="Band member"
                disabled={saving || !hasBandMembers}
              />
            </RadioGroup>
          </FormControl>
          {!hasBandMembers && (
            <Alert severity="info">
              Add a band member before registering a member-paid purchase.
            </Alert>
          )}
          {method === 'member' && (
            <Autocomplete
              size="small"
              fullWidth
              options={bandMembers}
              value={selectedPayee}
              disabled={saving}
              onChange={(_e, picked) => onPaidByBandMemberIdChange(picked?.id ?? null)}
              getOptionLabel={(m) => (m ? `${m.name}${m.role ? ` (${m.role})` : ''}` : '')}
              isOptionEqualToValue={(option, value) => Number(option.id) === Number(value.id)}
              renderInput={(params) => <TextField {...params} label="Paid by" />}
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={onSubmit} disabled={saving}>
          Register
        </Button>
      </DialogActions>
    </Dialog>
  )
}

PaymentRegistrationDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  saving: PropTypes.bool,
  error: PropTypes.string,
  method: PropTypes.oneOf(['bank', 'member']).isRequired,
  paidOn: PropTypes.string,
  paidByBandMemberId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  bandMembers: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    user_id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    name: PropTypes.string,
    role: PropTypes.string,
  })).isRequired,
  onClose: PropTypes.func.isRequired,
  onMethodChange: PropTypes.func.isRequired,
  onPaidOnChange: PropTypes.func.isRequired,
  onPaidByBandMemberIdChange: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
}

function PaidPaymentSummary({ purchase, bandMembers, paymentAccount }) {
  const isMemberPayment = purchase.payment_method === 'member'
  const bandMember = isMemberPayment
    ? bandMembers.find((m) => Number(m.id) === Number(purchase.paid_by_band_member_id))
    : null
  const payer = isMemberPayment
    ? (bandMember?.name || (purchase.paid_by_band_member_id ? `Band member #${purchase.paid_by_band_member_id}` : 'Band member'))
    : accountLabel(paymentAccount)
  const label = isMemberPayment ? 'Paid by' : 'Paid from'

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
        <Typography variant="body2" fontWeight={600} noWrap title={payer}>
          {payer}
        </Typography>
      </Box>
    </Box>
  )
}

PaidPaymentSummary.propTypes = {
  purchase: PropTypes.shape({
    payment_method: PropTypes.oneOf(['bank', 'member']),
    paid_by_band_member_id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    paid_at: PropTypes.string,
  }).isRequired,
  bandMembers: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    name: PropTypes.string,
  })).isRequired,
  paymentAccount: PropTypes.shape({
    code: PropTypes.string,
    name: PropTypes.string,
  }),
}

export default function PurchaseDetails({ mode, draft, purchaseId, onClose, onPurchaseUpdate, embedded = false }) {
  const s = usePurchaseFormState({ mode, draft, purchaseId, onClose, onPurchaseUpdate })
  const [editingNumber, setEditingNumber] = useState(false)

  if (s.loading) {
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

  const canRegister = s.purchase?.status === 'approved'
  const canEditNumber = !s.readOnly

  const cardTitle = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
      {editingNumber ? (
        <TextField
          size="small"
          type="number"
          autoFocus
          value={s.form.receipt_number ?? ''}
          onChange={(e) => s.patchForm({ receipt_number: Number(e.target.value) || '' })}
          onBlur={() => setEditingNumber(false)}
          slotProps={{ htmlInput: { min: 1, step: 1 } }}
          sx={{ width: 120 }}
        />
      ) : (
        <Typography variant="h6" fontWeight={700}>
          Purchase {s.purchase?.receipt_number ?? ''}
        </Typography>
      )}
      {canEditNumber && !editingNumber && (
        <IconButton size="small" onClick={() => setEditingNumber(true)} aria-label="edit receipt number">
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
      )}
      {s.purchase && (
        <Chip size="small" color={purchaseStatusColor(s.purchase.status)} label={s.purchase.status} />
      )}
    </Box>
  )

  const saveActions = !s.readOnly && (
    <>
      <Button
        variant="outlined"
        startIcon={<CloudUploadOutlinedIcon />}
        onClick={() => s.handleSave('draft')}
        disabled={s.saving}
      >
        Save as draft
      </Button>
      <Button
        variant="contained"
        startIcon={<CheckCircleOutlineIcon />}
        onClick={() => s.handleSave('approved')}
        disabled={s.saving}
      >
        Approve
      </Button>
    </>
  )

  const bodyCards = (
    <>
      {s.error && <Alert severity="error" sx={{ mb: 2 }}>{s.error}</Alert>}

      <Box sx={{ mb: 2 }}>
        {embedded && cardTitle}
        <PurchaseSupplierFields form={s.form} patchForm={s.patchForm} readOnly={s.readOnly} />
        <Divider sx={{ my: 2 }} />
        <PurchaseLinesEditor
          form={s.form}
          totals={s.totals}
          accounts={s.expenseAccounts}
          lineErrors={s.lineErrors}
          readOnly={s.readOnly}
          patchLine={s.patchLine}
          addLine={s.addLine}
          removeLine={s.removeLine}
        />
        {s.isPaid ? (
          <PaidPaymentSummary
            purchase={s.purchase}
            bandMembers={s.bandMembers}
            paymentAccount={s.paymentAccount}
          />
        ) : (
          <Button
            fullWidth
            startIcon={<VolunteerActivismOutlinedIcon />}
            onClick={s.openPaymentDialog}
            disabled={!canRegister || s.saving}
            sx={{ mt: 2, py: 1.25, bgcolor: 'action.hover', borderRadius: 99, color: 'text.primary' }}
          >
            Register Payment
          </Button>
        )}
      </Box>

      <Box>
        <PurchaseTotalsPanel totals={s.totals} currency={s.form.currency} />
      </Box>
    </>
  )

  const deleteDialog = (
    <Dialog open={s.deleteDialogOpen} onClose={() => s.setDeleteDialogOpen(false)}>
      <DialogTitle>Delete purchase?</DialogTitle>
      <DialogContent>
        <DialogContentText>This permanently deletes the draft purchase. This cannot be undone.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => s.setDeleteDialogOpen(false)}>Cancel</Button>
        <Button color="error" onClick={s.confirmDelete}>Delete</Button>
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

  if (embedded) {
    return (
      <>
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, mb: 2 }}>
            {!s.readOnly && (
              <Button color="error" startIcon={<DeleteIcon />} onClick={s.handleDelete} sx={{ mr: 'auto' }}>
                Delete
              </Button>
            )}
            {saveActions}
          </Box>
          {bodyCards}
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
          <Box sx={{ flexGrow: 1 }}>New purchase</Box>
          <IconButton size="small" onClick={() => onClose(false)} aria-label="close">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>{bodyCards}</DialogContent>
        <DialogActions>
          <Button onClick={() => onClose(false)}>Cancel</Button>
          {saveActions}
        </DialogActions>
      </Dialog>
      {deleteDialog}
      {paymentDialog}
    </>
  )
}

PurchaseDetails.propTypes = {
  mode: PropTypes.oneOf(['create', 'edit']).isRequired,
  draft: PropTypes.shape({ draft: PropTypes.object }),
  purchaseId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onClose: PropTypes.func.isRequired,
  onPurchaseUpdate: PropTypes.func,
  embedded: PropTypes.bool,
}
