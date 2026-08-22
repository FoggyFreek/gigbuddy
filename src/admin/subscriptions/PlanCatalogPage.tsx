import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import PlanCatalogSection from '../components/PlanCatalogSection.tsx'
import { listAdminPlans } from './adminSubscriptions.ts'
import type { SubscriptionPlan } from '../../commerce/billing/billing.ts'

export default function PlanCatalogPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    listAdminPlans()
      .then((result) => { if (!cancelled) setPlans(result) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [revision])

  if (error) return <Alert severity="error">Plan catalog could not be loaded.</Alert>
  if (!plans) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
  return <PlanCatalogSection plans={plans} onChanged={() => setRevision((value) => value + 1)} />
}
