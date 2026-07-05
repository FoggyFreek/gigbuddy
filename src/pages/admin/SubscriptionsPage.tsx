import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useToast } from '../../contexts/toastContext.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import {
  listSubscriptions,
  grantComplimentary,
  revokeComplimentary,
  listAdminPlans,
} from '../../api/adminSubscriptions.ts'
import type { AdminSubscription } from '../../api/adminSubscriptions.ts'
import { listAllUsers } from '../../api/adminUsers.ts'
import type { AdminUser } from '../../api/adminUsers.ts'
import type { SubscriptionPlan } from '../../api/billing.ts'
import PlanCatalogSection from '../../components/admin/PlanCatalogSection.tsx'
import DateEntryField from '../../components/DateEntryField.tsx'

function periodEnd(r: AdminSubscription): string {
  const end = r.isComplimentary ? r.complimentaryExpiresAt : r.currentPeriodEnd
  return end ? new Date(end).toLocaleDateString() : '—'
}

function errMessage(e: unknown): string {
  const x = (e ?? {}) as { message?: string; body?: { error?: string } }
  return x.body?.error || x.message || 'Something went wrong.'
}

export default function SubscriptionsPage() {
  const showToast = useToast()
  const [rows, setRows] = useState<AdminSubscription[]>([])
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [repairOnly, setRepairOnly] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [grantUser, setGrantUser] = useState<AdminUser | null>(null)
  const [grantPlanId, setGrantPlanId] = useState('')
  const [grantExpiresAt, setGrantExpiresAt] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listSubscriptions(repairOnly)
      .then((data) => setRows(data.subscriptions))
      .catch((e) => showToast?.(errMessage(e), 'error'))
      .finally(() => setLoading(false))
  }, [repairOnly, showToast])

  const loadPlans = useCallback(() => {
    listAdminPlans().then(setPlans).catch((e: unknown) => showToast?.(errMessage(e), 'error'))
  }, [showToast])

  const loadUsers = useCallback(() => {
    listAllUsers().then(setUsers).catch((e: unknown) => showToast?.(errMessage(e), 'error'))
  }, [showToast])

  useEffect(load, [load])
  useEffect(loadPlans, [loadPlans])
  useEffect(loadUsers, [loadUsers])

  const attention = rows.filter((r) => r.scheduleStale || r.repairNeeded)

  const onGrant = async () => {
    const userId = Number(grantUser?.id)
    const planId = Number(grantPlanId)
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(planId) || planId <= 0) {
      showToast?.('Select a user and a plan.', 'warning')
      return
    }
    setBusy(true)
    try {
      await grantComplimentary(userId, planId, grantExpiresAt || null)
      showToast?.('Complimentary subscription granted.', 'success')
      setGrantUser(null)
      setGrantPlanId('')
      setGrantExpiresAt('')
      load()
    } catch (e) {
      showToast?.(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onRevoke = async (userId: number) => {
    setBusy(true)
    try {
      await revokeComplimentary(userId)
      showToast?.('Complimentary subscription revoked.', 'success')
      load()
    } catch (e) {
      showToast?.(errMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>Subscriptions</Typography>

      {attention.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {attention.length} subscription{attention.length > 1 ? 's need' : ' needs'} attention
          (schedule repair or billing repair in progress).
        </Alert>
      )}

      <PlanCatalogSection plans={plans} onChanged={loadPlans} />

      <Paper elevation={0} sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Grant complimentary access</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <Autocomplete
            size="small" sx={{ minWidth: 280 }}
            options={users}
            value={grantUser}
            onChange={(_, v) => setGrantUser(v)}
            getOptionLabel={(u) => `${u.name || u.email} (${u.email})`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => <TextField {...params} label="User" />}
          />
          <TextField
            size="small" select label="Plan" value={grantPlanId}
            onChange={(e) => setGrantPlanId(e.target.value)} sx={{ minWidth: 180 }}
          >
            {plans.map((p) => <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>)}
          </TextField>
          <DateEntryField
            size="small" label="Expires (optional)" value={grantExpiresAt}
            onChange={(e) => setGrantExpiresAt(e.target.value)} sx={{ width: 200 }}
          />
          <Button variant="contained" onClick={() => { void onGrant() }} disabled={busy}>Grant</Button>
        </Stack>
      </Paper>

      <FormControlLabel
        control={<Switch checked={repairOnly} onChange={(e) => setRepairOnly(e.target.checked)} />}
        label="Only needing attention"
        sx={{ mb: 1 }}
      />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : (
        <Paper elevation={0} sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Plan</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Interval</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell>Period end</TableCell>
                <TableCell>Flags</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Typography variant="body2">{r.userName}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.userEmail}</Typography>
                  </TableCell>
                  <TableCell>{r.planSlug}</TableCell>
                  <TableCell>
                    <Chip size="small" label={r.status} />
                    {r.isComplimentary && <Chip size="small" color="secondary" label="comp" sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell>{r.billingInterval ?? '—'}</TableCell>
                  <TableCell align="right">{r.isComplimentary ? '—' : formatEur(r.priceCents)}</TableCell>
                  <TableCell>{periodEnd(r)}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5}>
                      {r.scheduleStale && <Chip size="small" color="warning" label="schedule" />}
                      {r.repairNeeded && <Chip size="small" color="error" label="repair" />}
                      {r.cancelAtPeriodEnd && <Chip size="small" label="canceling" />}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    {r.isComplimentary && (
                      <Button size="small" color="error" disabled={busy} onClick={() => { void onRevoke(r.userId) }}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={8}>
                  <Typography variant="body2" sx={{ color: 'text.secondary', py: 2, textAlign: 'center' }}>
                    No subscriptions.
                  </Typography>
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  )
}
