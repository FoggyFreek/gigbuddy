import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SxProps, Theme } from '@mui/material/styles'
import type { Account } from '../../types/entities.ts'
import type { JournalFormLine } from './journalFormHelpers.ts'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import AccountAutocomplete from './AccountAutocomplete.tsx'
import AmountCell from './AmountCell.tsx'
import JournalLinePopper from './JournalLinePopper.tsx'
import { VAT_RATES } from './journalFormHelpers.ts'

// Description · Account · VAT · Debit · Credit read as one connected segmented
// control; a connector line then bridges to the standalone balancing account.
export const LINE_GRID = '1.6fr 2fr 1.1fr 1fr 1fr 20px 2fr 40px'

const GROUP_RADIUS = '12px'

// Square the inner corners, round only the group's outer edge, and overlap each
// field 1px onto its neighbour so they share a single divider instead of a seam.
const connect = (pos: 'first' | 'mid' | 'last'): SxProps<Theme> => ({
  ...(pos !== 'first' && { ml: '-1px' }),
  '& .MuiOutlinedInput-root': {
    position: 'relative',
    borderRadius: 0,
    ...(pos === 'first' && { borderTopLeftRadius: GROUP_RADIUS, borderBottomLeftRadius: GROUP_RADIUS }),
    ...(pos === 'last' && { borderTopRightRadius: GROUP_RADIUS, borderBottomRightRadius: GROUP_RADIUS }),
    // lift the active field so its full outline paints over the shared border
    '&:hover, &.Mui-focused': { zIndex: 1 },
  },
})

interface JournalLineRowProps {
  line: JournalFormLine
  idx: number
  accounts?: Account[]
  readOnly?: boolean
  canDelete?: boolean
  patchLine: (idx: number, patch: Partial<JournalFormLine>) => void
  addLine: () => void
  removeLine: (idx: number) => void
  duplicateLine: (idx: number) => void
}

export default function JournalLineRow({
  line, idx, accounts, readOnly, canDelete,
  patchLine, addLine, removeLine, duplicateLine,
}: Readonly<JournalLineRowProps>) {
  const { t } = useTranslation('journal')
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const commitDebit = (cents: number) => {
    if (cents > 0) patchLine(idx, { side: 'debit', amount_cents: cents })
    else if (line.side === 'debit') patchLine(idx, { side: null, amount_cents: 0 })
  }
  const commitCredit = (cents: number) => {
    if (cents > 0) patchLine(idx, { side: 'credit', amount_cents: cents })
    else if (line.side === 'credit') patchLine(idx, { side: null, amount_cents: 0 })
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: LINE_GRID, gap: 0, alignItems: 'center', mb: 1 }}>
      <TextField
        size="small"
        fullWidth
        sx={connect('first')}
        placeholder={t($ => $.line.description)}
        value={line.description}
        disabled={readOnly}
        onChange={(e) => patchLine(idx, { description: e.target.value })}
      />
      <AccountAutocomplete
        value={line.account_code}
        accounts={accounts}
        placeholder={t($ => $.line.account)}
        disabled={readOnly}
        sx={connect('mid')}
        onChange={(code) => patchLine(idx, { account_code: code })}
      />
      <FormControl size="small" fullWidth disabled={readOnly} sx={connect('mid')}>
        <InputLabel>{t($ => $.line.vatRate)}</InputLabel>
        <Select
          label={t($ => $.line.vatRate)}
          value={VAT_RATES.includes(Number(line.vat_rate)) ? Number(line.vat_rate) : 0}
          onChange={(e) => patchLine(idx, { vat_rate: Number(e.target.value) })}
          renderValue={(v) => `${v}%`}
        >
          {VAT_RATES.map((rate) => (
            <MenuItem key={rate} value={rate}>{rate}%</MenuItem>
          ))}
        </Select>
      </FormControl>
      <AmountCell
        cents={line.amount_cents}
        active={line.side === 'debit'}
        placeholder={t($ => $.line.debit)}
        disabled={readOnly}
        sx={connect('mid')}
        onCommit={commitDebit}
      />
      <AmountCell
        cents={line.amount_cents}
        active={line.side === 'credit'}
        placeholder={t($ => $.line.credit)}
        disabled={readOnly}
        sx={connect('last')}
        onCommit={commitCredit}
      />
      {/* connector line bridging the debit/credit group to its balancing account */}
      <Box aria-hidden sx={{ display: 'flex', alignItems: 'center', px: 0.25 }}>
        <Box sx={{ width: '100%', height: '2px', borderRadius: 1, bgcolor: 'divider' }} />
      </Box>
      <AccountAutocomplete
        value={line.balancing_account_code}
        accounts={accounts}
        placeholder={t($ => $.line.balancingAccount)}
        disabled={readOnly}
        onChange={(code) => patchLine(idx, { balancing_account_code: code })}
      />
      <IconButton
        size="small"
        aria-label={t($ => $.line.actions)}
        disabled={readOnly}
        sx={{ ml: 0.5, justifySelf: 'center' }}
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <ChevronLeftIcon fontSize="small" />
      </IconButton>
      <JournalLinePopper
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        onDuplicate={() => duplicateLine(idx)}
        onDelete={() => removeLine(idx)}
        onAdd={addLine}
        canDelete={canDelete}
      />
    </Box>
  )
}
