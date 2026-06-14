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
import { useReimbursementsState } from '../components/reimbursements/useReimbursementsState.ts'
import MemberReimbursementRow from '../components/reimbursements/MemberReimbursementRow.tsx'
import MemberReimbursementCard from '../components/reimbursements/MemberReimbursementCard.tsx'
import RegisterReimbursementDialog from '../components/reimbursements/RegisterReimbursementDialog.tsx'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { formatEur } from '../utils/purchaseTotals.ts'
import { MoneyHeaderCells } from '../components/shared/MoneyCells.tsx'
import type { MemberOutstanding } from '../types/entities.ts'

export default function ReimbursementsPage() {
  const isCompact = useCompactLayout()
  const {
    outstanding, loading, error, expandedId, purchasesByMember,
    toggleExpand, registerReimbursement, markReimbursed,
  } = useReimbursementsState()
  const [dialogMember, setDialogMember] = useState<MemberOutstanding | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const totalOwed = useMemo(
    () => outstanding.reduce((sum, m) => sum + (Number(m.outstanding_cents) || 0), 0),
    [outstanding],
  )

  async function handleMarkReimbursed(member: MemberOutstanding) {
    if (member.band_member_id == null) return
    try {
      setActionError(null)
      await markReimbursed(member.band_member_id)
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 600,  mb: 2  }}>Reimbursements</Typography>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      )}
      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}
      {actionError && <Typography color="error" sx={{ mb: 2 }}>{actionError}</Typography>}

      {!loading && (
        <>
          <Paper variant="outlined" sx={{ p: 1.5, mb: 2, display: 'inline-block', minWidth: 160 }}>
            <Typography variant="body2" color="text.secondary">Total owed to members</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatEur(totalOwed)}</Typography>
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
                  key={String(member.band_member_id)}
                  member={member}
                  expanded={expandedId === member.band_member_id}
                  purchases={purchasesByMember[String(member.band_member_id)]}
                  onToggle={() => member.band_member_id != null && toggleExpand(member.band_member_id)}
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
                      <MoneyHeaderCells label="Outstanding" />
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {outstanding.map((member) => (
                      <MemberReimbursementRow
                        key={String(member.band_member_id)}
                        member={member}
                        expanded={expandedId === member.band_member_id}
                        purchases={purchasesByMember[String(member.band_member_id)]}
                        onToggle={() => member.band_member_id != null && toggleExpand(member.band_member_id)}
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
          onSubmit={registerReimbursement as unknown as Parameters<typeof RegisterReimbursementDialog>[0]['onSubmit']}
          onClose={() => setDialogMember(null)}
        />
      )}
    </Box>
  )
}
