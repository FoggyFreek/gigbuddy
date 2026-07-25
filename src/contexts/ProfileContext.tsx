import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ProfileContext } from './profileContext.ts'
import { getProfile } from '../api/profile.ts'
import { useAuth } from './authContext.ts'
import { DEFAULT_VAT_COUNTRY, getStandardVatRate, isAllowedVatRate } from '../utils/vatRates.ts'

// The tenant's default VAT rate is its configured VAT % when that is a valid
// rate for its country, otherwise the country's standard rate.
function resolveDefaultVatRate(country: string, taxPercentage: number): number {
  return Number.isFinite(taxPercentage) && isAllowedVatRate(country, taxPercentage)
    ? taxPercentage
    : getStandardVatRate(country)
}

interface ProfileProviderProps {
  children: ReactNode
}

export function ProfileProvider({ children }: Readonly<ProfileProviderProps>) {
  const { user } = useAuth()
  const activeTenantId = user?.activeTenantId ?? null
  const [bandName, setBandName] = useState('')
  const [accentColor, setAccentColor] = useState<string | null>(null)
  const [vatCountry, setVatCountry] = useState<string>(DEFAULT_VAT_COUNTRY)
  const [defaultVatRate, setDefaultVatRate] = useState<number>(getStandardVatRate(DEFAULT_VAT_COUNTRY))

  const setVatSettings = useCallback((country: string, taxPercentage: number) => {
    const c = country || DEFAULT_VAT_COUNTRY
    setVatCountry(c)
    setDefaultVatRate(resolveDefaultVatRate(c, taxPercentage))
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.resolve(activeTenantId ? getProfile() : null)
      .then((p) => {
        if (cancelled) return
        setBandName(p?.band_name || '')
        setAccentColor(p?.accent_color || null)
        const country = String(p?.vat_country || DEFAULT_VAT_COUNTRY)
        const taxPct = p?.tax_percentage != null ? Number(p.tax_percentage) : NaN
        setVatCountry(country)
        setDefaultVatRate(resolveDefaultVatRate(country, taxPct))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeTenantId])

  const value = useMemo(
    () => ({ bandName, setBandName, accentColor, setAccentColor, vatCountry, defaultVatRate, setVatSettings }),
    [bandName, accentColor, vatCountry, defaultVatRate, setVatSettings],
  )

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  )
}
