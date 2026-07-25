import type { ReactNode } from 'react'
import ListSubheader from '@mui/material/ListSubheader'
import MenuItem from '@mui/material/MenuItem'
import { vatRateGroups } from '../../utils/vatRates.ts'

// Renders the MenuItem list for a VAT-rate <Select>: the tenant's home-country
// rates first, then — under an "other countries" subheader — every other real
// VAT rate as an override (for a gig played abroad). Returned as a flat array so
// it drops straight into a MUI Select/TextField-select as children (the Select
// still matches the selected `value` against these items).
export function vatRateMenuItems(
  country: string | null | undefined,
  current: number | null | undefined,
  otherLabel: string,
): ReactNode[] {
  const { primary, other } = vatRateGroups(country, current)
  const items: ReactNode[] = primary.map((rate) => (
    <MenuItem key={`p-${rate}`} value={rate}>{rate}%</MenuItem>
  ))
  if (other.length > 0) {
    items.push(<ListSubheader key="other-header">{otherLabel}</ListSubheader>)
    for (const rate of other) {
      items.push(<MenuItem key={`o-${rate}`} value={rate}>{rate}%</MenuItem>)
    }
  }
  return items
}
