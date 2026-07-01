import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import PeriodPicker from './shared/periodPicker.tsx'
import PurchasesList from './purchases/PurchasesList.tsx'
import { listPurchasePeriods, listPurchases } from '../api/purchases.ts'
import { defaultPeriodForDates } from '../utils/invoicePeriod.ts'
import type { Purchase, Id, Period } from '../types/entities.ts'

interface SupplierPurchasesSectionProps {
  contactId: Id
}

// Linked-purchases list shown on a supplier contact's page. Mirrors the
// Purchases page data flow (server-side period filter + the shared
// PurchasesList renderer) but scoped to one supplier via supplier_contact_id.
export default function SupplierPurchasesSection({ contactId }: Readonly<SupplierPurchasesSectionProps>) {
  const { t } = useTranslation('contacts')
  const navigate = useNavigate()
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [period, setPeriod] = useState<Period>(() => ({ mode: 'fiscal_year', year: new Date().getFullYear() }))
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)
  const [loading, setLoading] = useState(true)

  // Seed the available dates + default period from this supplier's own purchase
  // dates so the picker lands on a period that actually has data.
  useEffect(() => {
    let active = true
    setPeriodsLoaded(false)
    listPurchasePeriods({ supplierContactId: contactId })
      .then((dates) => {
        if (!active) return
        setAvailableDates(dates.filter(Boolean))
        setPeriod(defaultPeriodForDates(dates))
      })
      .catch(() => { if (active) setAvailableDates([]) })
      .finally(() => { if (active) setPeriodsLoaded(true) })
    return () => { active = false }
  }, [contactId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listPurchases(period, { supplierContactId: contactId })
      setPurchases(data)
    } catch {
      setPurchases([])
    } finally {
      setLoading(false)
    }
  }, [contactId, period])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  return (
    <>
      <Divider sx={{ my: 3 }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{t($ => $.detail.purchasesHeading)}</Typography>
        <Chip size="small" label={purchases.length} />
        <Box sx={{ flexGrow: 1 }} />
        <PeriodPicker availableDates={availableDates} value={period} onChange={setPeriod} />
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <PurchasesList
          purchases={purchases}
          selectedId={null}
          onRowClick={(p) => navigate(`/purchases/${p.id}`)}
        />
      )}
    </>
  )
}
