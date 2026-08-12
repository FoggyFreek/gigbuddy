import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { listMyBands } from '../myBands.ts'
import { useTenantKind } from '../../../hooks/useTenantKind.ts'
import { TENANT_CAPABILITIES } from '../../../auth/tenantCapabilities.ts'
import type { Id, MyBand } from '../../../types/entities.ts'

interface MyBandSelectProps {
  value: Id | null
  onChange: (myBandId: Id | null) => void
  disabled?: boolean
}

/**
 * Which of the artist's bands an event was for. Renders nothing outside a
 * personal workspace: a band's own events are already the band's, and the
 * server refuses the field there anyway.
 *
 * Also renders nothing when the collection is empty — an empty picker is just a
 * dead control, and My Bands is where you add one.
 */
export default function MyBandSelect({ value, onChange, disabled = false }: Readonly<MyBandSelectProps>) {
  const { t } = useTranslation('myBands')
  const { supports } = useTenantKind()
  const enabled = supports(TENANT_CAPABILITIES.MY_BANDS)
  const [bands, setBands] = useState<MyBand[] | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    listMyBands()
      .then(({ items }) => { if (!cancelled) setBands(items) })
      .catch(() => { if (!cancelled) setBands([]) })
    return () => { cancelled = true }
  }, [enabled])

  if (!enabled || bands === null || bands.length === 0) return null

  return (
    <TextField
      select
      label={t($ => $.selectLabel)}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as Id))}
      disabled={disabled}
      fullWidth
    >
      <MenuItem value="">{t($ => $.selectNone)}</MenuItem>
      {bands.map((band) => (
        <MenuItem key={String(band.id)} value={band.id}>{band.bandProfile.name}</MenuItem>
      ))}
    </TextField>
  )
}
