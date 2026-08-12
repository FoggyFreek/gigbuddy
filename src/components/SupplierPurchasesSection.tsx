import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import PeriodPicker from './shared/periodPicker.tsx'
import PurchasesList from './purchases/PurchasesList.tsx'
import { listPurchasePeriods, listPurchases } from '../api/purchases.ts'
import { defaultPeriodForDates, periodKey } from '../utils/invoicePeriod.ts'
import type { Purchase, Id, Period } from '../types/entities.ts'
import useFiscalYearStart from '../hooks/useFiscalYearStart.ts'

interface SupplierPurchasesSectionProps {
  contactId: Id
}

// Linked-purchases list shown on a supplier contact's page. Mirrors the
// Purchases page data flow (server-side period filter + the shared
// PurchasesList renderer) but scoped to one supplier via supplier_contact_id.
export default function SupplierPurchasesSection({ contactId }: Readonly<SupplierPurchasesSectionProps>) {
  const fiscalYearStart = useFiscalYearStart()
  const { t } = useTranslation('contacts')
  const navigate = useNavigate()
  const [period, setPeriod] = useState<Period>(() => defaultPeriodForDates([], fiscalYearStart))

  // Both fetches tag their result with the request it answered, so "which
  // supplier is this data for" and "are we still loading" are derived during
  // render instead of being reset by the effect that starts the next fetch.
  const [periodsState, setPeriodsState] = useState<{ contactId: Id; dates: string[] } | null>(null)
  const periodsLoaded = periodsState?.contactId === contactId
  const availableDates = periodsState?.contactId === contactId ? periodsState.dates : []

  // Seed the available dates + default period from this supplier's own purchase
  // dates so the picker lands on a period that actually has data.
  useEffect(() => {
    let active = true
    listPurchasePeriods({ supplierContactId: contactId })
      .then((dates) => {
        if (!active) return
        setPeriodsState({ contactId, dates: dates.filter(Boolean) })
        setPeriod(defaultPeriodForDates(dates, fiscalYearStart))
      })
      .catch(() => { if (active) setPeriodsState({ contactId, dates: [] }) })
    return () => { active = false }
  }, [contactId, fiscalYearStart])

  const purchasesKey = periodsLoaded ? `${contactId}|${periodKey(period)}` : null
  const [purchasesState, setPurchasesState] = useState<{ key: string; purchases: Purchase[] } | null>(null)
  const purchases = purchasesState?.purchases ?? []
  const loading = purchasesKey == null || purchasesState?.key !== purchasesKey

  useEffect(() => {
    if (purchasesKey == null) return
    let active = true
    listPurchases(period, { supplierContactId: contactId })
      .then((data) => { if (active) setPurchasesState({ key: purchasesKey, purchases: data }) })
      .catch(() => { if (active) setPurchasesState({ key: purchasesKey, purchases: [] }) })
    return () => { active = false }
  }, [purchasesKey, period, contactId])

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
