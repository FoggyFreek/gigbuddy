import Box from '@mui/material/Box'
import type { ReactNode } from 'react'

const SHOWN = { display: 'block' } as const
const HIDDEN = { display: 'none' } as const

/**
 * Visibility wrapper for one detail tab. Panels stay mounted so auto-saving
 * children and form state survive a switch; hiding is the wrapper's job, which
 * keeps `active` out of the panel's own props — a memoized panel then skips a
 * switch entirely instead of re-rendering just to hide.
 */
export default function TabPanel({ active, children }: Readonly<{ active: boolean; children: ReactNode }>) {
  return <Box sx={active ? SHOWN : HIDDEN}>{children}</Box>
}
