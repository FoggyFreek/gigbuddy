import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import { formatEur } from '../../utils/purchaseTotals.ts'
import { formatShortDate } from '../../utils/dateFormat.ts'
import type { MemberOutstanding, Purchase } from '../../types/entities.ts'

interface MemberReimbursementCardProps {
  member: MemberOutstanding
  expanded?: boolean
  purchases?: Purchase[]
  onToggle: () => void
  onRegister: () => void
  onMarkReimbursed: () => void
}

// Mobile-friendly card equivalent of MemberReimbursementRow: stacks the member,
// balance, and actions vertically, with the same expand-to-see-purchases panel.
export default function MemberReimbursementCard({ member, expanded, purchases, onToggle, onRegister, onMarkReimbursed }: Readonly<MemberReimbursementCardProps>) {
  const { t } = useTranslation(['reimbursements', 'common'])
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton size="small" aria-label={expanded ? t($ => $.aria.collapse) : t($ => $.aria.expand)} onClick={onToggle}>
          {expanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap>{member.band_member_name}</Typography>
          <Chip size="small" label={t($ => $.purchaseCount, { count: member.outstanding_count ?? 0 })} sx={{ mt: 0.25 }} />
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatEur(member.outstanding_cents)}</Typography>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ pl: 4, py: 1 }}>
          {purchases === undefined && (
            <Typography variant="body2" color="text.secondary">{t($ => $.common.state.loading)}</Typography>
          )}
          {purchases?.length === 0 && (
            <Typography variant="body2" color="text.secondary">{t($ => $.noOutstandingPurchases)}</Typography>
          )}
          {purchases?.map((p) => (
            <Box key={p.id} sx={{ display: 'flex', gap: 1, alignItems: 'baseline', py: 0.25 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>#{p.receipt_number}</Typography>
              <Typography variant="caption" color="text.secondary">{formatShortDate(p.receipt_date)}</Typography>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{p.supplier_name}</Typography>
              <Typography variant="body2">{formatEur(p.total_cents)}</Typography>
            </Box>
          ))}
        </Box>
      </Collapse>

      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
        <Button size="small" fullWidth onClick={onRegister}>{t($ => $.actions.register)}</Button>
        <Button size="small" fullWidth variant="contained" onClick={onMarkReimbursed}>{t($ => $.actions.markReimbursed)}</Button>
      </Box>
    </Paper>
  )
}
