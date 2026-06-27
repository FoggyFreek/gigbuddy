import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Divider from '@mui/material/Divider'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { ALL_LEDGER_GROUPS, LEDGER_TYPE_GROUPS } from '../../utils/ledgerEntryType.ts'

interface LedgerTypeFilterProps {
  value: Set<string>
  onChange: (value: Set<string>) => void
}

// "Types: All ▾" dropdown of checkbox menu items. Emits the active Set of
// group keys upward; "All" toggles every group on/off at once.
export default function LedgerTypeFilter({ value, onChange }: LedgerTypeFilterProps) {
  const { t } = useTranslation(['ledger', 'common'])
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const allSelected = ALL_LEDGER_GROUPS.every((key) => value.has(key))
  const selection = allSelected
    ? t($ => $.typeFilter.all)
    : LEDGER_TYPE_GROUPS.filter((g) => value.has(g.key)).map((g) => t($ => $.typeGroups[g.key])).join(', ')
      || t($ => $.state.none, { ns: 'common' })

  function toggleAll() {
    onChange(new Set(allSelected ? [] : ALL_LEDGER_GROUPS))
  }

  function toggleGroup(key: string) {
    const next = new Set(value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        endIcon={<ArrowDropDownIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="true"
        aria-expanded={Boolean(anchor)}
      >
        {t($ => $.typeFilter.button, { selection })}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={toggleAll}>
          <Checkbox size="small" checked={allSelected} sx={{ py: 0, pl: 0 }} />
          <ListItemText primary={t($ => $.typeFilter.all)} />
        </MenuItem>
        <Divider />
        {LEDGER_TYPE_GROUPS.map((group) => (
          <MenuItem key={group.key} onClick={() => toggleGroup(group.key)}>
            <Checkbox size="small" checked={value.has(group.key)} sx={{ py: 0, pl: 0 }} />
            <ListItemText primary={t($ => $.typeGroups[group.key])} />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
