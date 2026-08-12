import { useMemo } from 'react'
import { useAccountingProfile } from '../../contexts/accountingProfileContext.ts'
import type { FiscalYearStart } from '../invoices/invoicePeriod.ts'

export default function useFiscalYearStart(): FiscalYearStart {
  const { profile } = useAccountingProfile()
  const month = profile?.financial_year_start_month ?? 1
  const day = profile?.financial_year_start_day ?? 1
  return useMemo(() => ({ month, day }), [month, day])
}
