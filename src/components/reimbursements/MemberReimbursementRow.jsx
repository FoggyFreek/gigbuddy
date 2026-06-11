import { Fragment } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import { formatEur } from '../../utils/purchaseTotals.js'
import { formatShortDate } from '../../utils/dateFormat.js'
import { memberOutstandingShape } from '../../propTypes/shared.js'

// One band member's outstanding row, expandable to a display-only list of the
// member-paid purchases that make up the balance.
export default function MemberReimbursementRow({ member, expanded, purchases, onToggle, onRegister, onMarkReimbursed }) {
  return (
    <Fragment>
      <TableRow hover>
        <TableCell sx={{ width: '1%', px: 1 }}>
          <IconButton size="small" aria-label={expanded ? 'collapse' : 'expand'} onClick={onToggle}>
            {expanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell>{member.band_member_name}</TableCell>
        <TableCell align="center"><Chip size="small" label={member.outstanding_count} /></TableCell>
        <TableCell align="right">
          <Typography fontWeight={700}>{formatEur(member.outstanding_cents)}</Typography>
        </TableCell>
        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
          <Button size="small" onClick={onRegister} sx={{ mr: 1 }}>Register</Button>
          <Button size="small" variant="contained" onClick={onMarkReimbursed}>Mark reimbursed</Button>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={5} sx={{ py: 0, border: expanded ? undefined : 'none' }}>
          <Collapse in={expanded} unmountOnExit>
            <Box sx={{ py: 1.5, pl: 4 }}>
              {purchases === undefined && (
                <Typography variant="body2" color="text.secondary">Loading…</Typography>
              )}
              {purchases && purchases.length === 0 && (
                <Typography variant="body2" color="text.secondary">No outstanding purchases</Typography>
              )}
              {purchases && purchases.map((p) => (
                <Box key={p.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', py: 0.25 }}>
                  <Typography variant="body2" fontWeight={600}>#{p.receipt_number}</Typography>
                  <Typography variant="caption" color="text.secondary">{formatShortDate(p.receipt_date)}</Typography>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {p.supplier_name}{p.description ? ` · ${p.description}` : ''}
                  </Typography>
                  <Typography variant="body2">{formatEur(p.total_cents)}</Typography>
                </Box>
              ))}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  )
}

MemberReimbursementRow.propTypes = {
  member: memberOutstandingShape.isRequired,
  expanded: PropTypes.bool,
  purchases: PropTypes.arrayOf(PropTypes.object),
  onToggle: PropTypes.func.isRequired,
  onRegister: PropTypes.func.isRequired,
  onMarkReimbursed: PropTypes.func.isRequired,
}
