import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useReimbursementsState } from '../components/reimbursements/useReimbursementsState.js'
import MemberReimbursementRow from '../components/reimbursements/MemberReimbursementRow.jsx'
import MemberReimbursementCard from '../components/reimbursements/MemberReimbursementCard.jsx'
import RegisterReimbursementDialog from '../components/reimbursements/RegisterReimbursementDialog.jsx'
import { useCompactLayout } from '../hooks/useCompactLayout.js'
import { formatEur } from '../utils/purchaseTotals.js'

export default function ReimbursementsPage() {
  const isCompact = useCompactLayout()
  const {
    outstanding, loading, error, expandedId, purchasesByMember,
    toggleExpand, registerReimbursement, markReimbursed,
  } = useReimbursementsState()
  const [dialogMember, setDialogMember] = useState(null)
  const [actionError, setActionError] = useState(null)

  const totalOwed = useMemo(
    () => outstanding.reduce((sum, m) => sum + (Number(m.outstanding_cents) || 0), 0),
    [outstanding],
  )

  async function handleMarkReimbursed(member) {
    try {
      setActionError(null)
      await markReimbursed(member.band_member_id)
    } catch (e) {
      setActionError(e.message)
    }
  }

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Reimbursements</Typography>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      )}
      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}
      {actionError && <Typography color="error" sx={{ mb: 2 }}>{actionError}</Typography>}

      {!loading && (
        <>
          <Paper variant="outlined" sx={{ p: 1.5, mb: 2, display: 'inline-block', minWidth: 160 }}>
            <Typography variant="body2" color="text.secondary">Total owed to members</Typography>
            <Typography variant="h6" fontWeight={700}>{formatEur(totalOwed)}</Typography>
          </Paper>

          {!outstanding.length && (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              Nothing outstanding
            </Typography>
          )}

          {Boolean(outstanding.length) && isCompact && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {outstanding.map((member) => (
                <MemberReimbursementCard
                  key={member.band_member_id}
                  member={member}
                  expanded={expandedId === member.band_member_id}
                  purchases={purchasesByMember[member.band_member_id]}
                  onToggle={() => toggleExpand(member.band_member_id)}
                  onRegister={() => setDialogMember(member)}
                  onMarkReimbursed={() => handleMarkReimbursed(member)}
                />
              ))}
            </Box>
          )}

          {Boolean(outstanding.length) && !isCompact && (
            <Paper variant="outlined">
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: '1%' }} />
                      <TableCell>Member</TableCell>
                      <TableCell align="center">Purchases</TableCell>
                      <TableCell align="right">Outstanding</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {outstanding.map((member) => (
                      <MemberReimbursementRow
                        key={member.band_member_id}
                        member={member}
                        expanded={expandedId === member.band_member_id}
                        purchases={purchasesByMember[member.band_member_id]}
                        onToggle={() => toggleExpand(member.band_member_id)}
                        onRegister={() => setDialogMember(member)}
                        onMarkReimbursed={() => handleMarkReimbursed(member)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}

      {dialogMember && (
        <RegisterReimbursementDialog
          member={dialogMember}
          onSubmit={registerReimbursement}
          onClose={() => setDialogMember(null)}
        />
      )}
    </Box>
  )
}
