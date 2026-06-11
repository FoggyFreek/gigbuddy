import PropTypes from 'prop-types'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined'
import { journalShape } from '../../propTypes/shared.js'

// Friendly explanation per backend error code; falls back to the server message.
const CODE_MESSAGES = {
  unbalanced_journal: 'Debits and credits do not balance.',
  invalid_account_code: 'A line is missing a valid account.',
  missing_side: 'A line needs a debit or credit amount.',
  invalid_amount: 'A line amount must be greater than zero.',
  invalid_balancing_account: 'A balancing account is inactive.',
  accounting_not_configured: 'Required accounting accounts are not configured (check Settings).',
  no_lines: 'The entry has no lines.',
  already_approved: 'The entry was already approved.',
}

function reasonFor(err) {
  const base = CODE_MESSAGES[err.code] || err.error || 'Could not be approved.'
  return err.line ? `Line ${err.line}: ${base}` : base
}

export default function JournalApproveErrorDialog({ errors, journals, onClose }) {
  const labelFor = (id) => {
    const j = journals.find((x) => x.id === id)
    return j ? `Entry J${j.entry_number}` : `Entry #${id}`
  }

  return (
    <Dialog open={errors.length > 0} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Some entries could not be approved</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>
          {errors.length} {errors.length === 1 ? 'entry was' : 'entries were'} left as a draft. Fix the issues below and try again.
        </DialogContentText>
        <List dense disablePadding>
          {errors.map((err) => (
            <ListItem key={err.id} disableGutters alignItems="flex-start">
              <ListItemIcon sx={{ minWidth: 32, mt: 0.5 }}>
                <ErrorOutlineIcon color="error" fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={labelFor(err.id)} secondary={reasonFor(err)} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">OK</Button>
      </DialogActions>
    </Dialog>
  )
}

JournalApproveErrorDialog.propTypes = {
  errors: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    error: PropTypes.string,
    code: PropTypes.string,
    line: PropTypes.number,
  })).isRequired,
  journals: PropTypes.arrayOf(journalShape).isRequired,
  onClose: PropTypes.func.isRequired,
}
