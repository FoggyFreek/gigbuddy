import type { ReactNode } from 'react'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Tooltip from '@mui/material/Tooltip'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useTranslation } from 'react-i18next'

interface Props {
  /** The explanation. It describes the icon rather than naming it. */
  help: string
  /** A unit or symbol to keep at the end of the field, before the icon. */
  children?: ReactNode
}

// A field's explanation, folded into the field itself: the detail's forms carry
// enough numbers without a line of prose under every one of them.
//
// The icon's name stays generic and the explanation is its *description*
// (`describeChild`), for two reasons: a paragraph makes a poor accessible name,
// and a name repeating the field's own label would answer to every query and
// every screen reader announcement that already names the field. MUI keeps the
// description on the native `title` while the tooltip is closed, so the text is
// reachable without hovering.
export default function FieldHelpAdornment({ help, children }: Readonly<Props>) {
  return (
    <InputAdornment position="end">
      {children}
      <FieldHelpIcon help={help} />
    </InputAdornment>
  )
}

// The icon on its own, for a control whose label is not a field's own label —
// a group of inputs, say — where there is no adornment slot to put it in.
export function FieldHelpIcon({ help }: Readonly<{ help: string }>) {
  const { t } = useTranslation('gigs')

  return (
    <Tooltip describeChild title={help}>
      <IconButton size="small" aria-label={t($ => $.detail.fieldHelp)} sx={{ p: 0.25 }}>
        <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
      </IconButton>
    </Tooltip>
  )
}
