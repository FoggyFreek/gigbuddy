import { useState } from 'react'
import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
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
import IconButton from '@mui/material/IconButton'
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
          readOnly={s.readOnly}
          patchLine={s.patchLine}
          addLine={s.addLine}
          removeLine={s.removeLine}
        />
        <Button
          fullWidth
          startIcon={<VolunteerActivismOutlinedIcon />}
          onClick={s.handleRegisterPayment}
          disabled={!canRegister || s.saving}
          sx={{ mt: 2, py: 1.25, bgcolor: 'action.hover', borderRadius: 99, color: 'text.primary' }}
        >
          {s.isPaid ? 'Payment registered' : 'Register Payment'}
        </Button>
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
