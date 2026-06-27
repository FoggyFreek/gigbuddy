import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
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
import { formatEurParts } from '../../utils/invoiceTotals.ts'
import { formatShortDate } from '../../utils/dateFormat.ts'
import type { MemberOutstanding, Purchase } from '../../types/entities.ts'
import MoneyCells from '../shared/MoneyCells.tsx'

interface MemberReimbursementRowProps {
  member: MemberOutstanding
  expanded?: boolean
  purchases?: Purchase[]
  onToggle: () => void
  onRegister: () => void
  onMarkReimbursed: () => void
}

// One band member's outstanding row, expandable to a display-only list of the
// member-paid purchases that make up the balance.
export default function MemberReimbursementRow({ member, expanded, purchases, onToggle, onRegister, onMarkReimbursed }: MemberReimbursementRowProps) {
  const { t } = useTranslation(['reimbursements', 'common'])
  return (
    <Fragment>
      <TableRow hover>
        <TableCell sx={{ width: '1%', px: 1 }}>
          <IconButton size="small" aria-label={expanded ? t($ => $.aria.collapse) : t($ => $.aria.expand)} onClick={onToggle}>
            {expanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell>{member.band_member_name}</TableCell>
        <TableCell align="center"><Chip size="small" label={member.outstanding_count} /></TableCell>
        <MoneyCells cents={member.outstanding_cents} bold />
        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
          <Button size="small" onClick={onRegister} sx={{ mr: 1 }}>{t($ => $.actions.register)}</Button>
          <Button size="small" variant="contained" onClick={onMarkReimbursed}>{t($ => $.actions.markReimbursed)}</Button>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={6} sx={{ py: 0, border: expanded ? undefined : 'none' }}>
          <Collapse in={expanded} unmountOnExit>
            <Box sx={{ py: 1.5, pl: 4 }}>
              {purchases === undefined && (
                <Typography variant="body2" color="text.secondary">{t($ => $.common.state.loading)}</Typography>
              )}
              {purchases?.length === 0 && (
                <Typography variant="body2" color="text.secondary">{t($ => $.noOutstandingPurchases)}</Typography>
              )}
              {purchases && purchases.length > 0 && (
                <Box
                  sx={{
                    display: 'grid',
                    // Receipt · date · supplier (flexes) · € symbol · digits. The
                    // symbol gets its own column so it lines up vertically across
                    // rows while the digits stay right-aligned.
                    gridTemplateColumns: 'auto auto minmax(0, 1fr) auto auto',
                    columnGap: 1.5,
                    rowGap: 0.25,
                    alignItems: 'baseline',
                  }}
                >
                  {purchases.map((p) => {
                    const { symbol, value } = formatEurParts(p.total_cents)
                    return (
                      <Fragment key={p.id}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>#{p.receipt_number}</Typography>
                        <Typography variant="caption" color="text.secondary">{formatShortDate(p.receipt_date)}</Typography>
                        <Typography variant="body2" noWrap>
                          {p.supplier_name}{p.description ? ` · ${p.description}` : ''}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>{symbol}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right' }}>{value}</Typography>
                      </Fragment>
                    )
                  })}
                </Box>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </Fragment>
  )
}
