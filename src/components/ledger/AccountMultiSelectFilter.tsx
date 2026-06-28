import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Divider from '@mui/material/Divider'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import type { Account } from '../../types/entities.ts'

// Account nodes in the tree carry their children.
type AccountNode = Account & { children: AccountNode[] }

// Account-type labels are shared with the chart of accounts; reuse the
// `settings.chartOfAccounts.types` translations rather than duplicating them.
const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'cost_of_goods_sold', 'expense'] as const

// Build the parent/child forest for one account type (sub-accounts inherit
// their parent's type, so a per-type tree is complete).
function buildTree(accounts: Account[]): AccountNode[] {
  const byCode = new Map<string, AccountNode>(accounts.map((a) => [a.code!, { ...a, children: [] }]))
  const roots: AccountNode[] = []
  for (const node of byCode.values()) {
    const parent = node.parent_code ? byCode.get(node.parent_code) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  for (const node of byCode.values()) {
    node.children.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
  }
  roots.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
  return roots
}

// Every code in a node's subtree, including the node itself.
function subtreeCodes(node: AccountNode): string[] {
  return [node.code!, ...node.children.flatMap(subtreeCodes)]
}

interface AccountMultiSelectFilterProps {
  accounts: Account[]
  value: Set<string>
  onChange: (next: Set<string>) => void
}

// "Accounts: …" dropdown of a hierarchical checkbox tree. `value` holds every
// checked code (a parent and its descendants are all members); toggling a node
// adds/removes its entire subtree, so the set is ready to send to the API as-is.
// A parent shows checked when its whole subtree is selected, indeterminate when
// only part of it is.
export default function AccountMultiSelectFilter({ accounts, value, onChange }: AccountMultiSelectFilterProps) {
  const { t } = useTranslation(['ledger', 'common', 'settings'])
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const groups = useMemo(
    () => TYPE_ORDER
      .map((type) => ({ type, trees: buildTree(accounts.filter((a) => a.type === type)) }))
      .filter((g) => g.trees.length > 0),
    [accounts],
  )

  function toggle(node: AccountNode, fullyChecked: boolean) {
    const codes = subtreeCodes(node)
    const next = new Set(value)
    if (fullyChecked) codes.forEach((c) => next.delete(c))
    else codes.forEach((c) => next.add(c))
    onChange(next)
  }

  // Recursively render a node and its descendants as indented menu rows.
  function renderNode(node: AccountNode, depth: number): React.ReactNode[] {
    const codes = subtreeCodes(node)
    const selected = codes.filter((c) => value.has(c)).length
    const fullyChecked = selected === codes.length
    const indeterminate = selected > 0 && !fullyChecked
    return [
      <MenuItem key={node.code} onClick={() => toggle(node, fullyChecked)} sx={{ pl: 1 + depth * 2.5 }}>
        <Checkbox size="small" checked={fullyChecked} indeterminate={indeterminate} sx={{ py: 0, pl: 0 }} />
        <ListItemText
          primary={`${node.code} — ${node.name}`}
          slotProps={{ primary: { variant: 'body2', noWrap: true } }}
        />
      </MenuItem>,
      ...node.children.flatMap((child) => renderNode(child, depth + 1)),
    ]
  }

  const selection = value.size
    ? t($ => $.accountFilter.selected, { count: value.size })
    : t($ => $.state.none, { ns: 'common' })

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
        {t($ => $.accountFilter.button, { selection })}
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { maxHeight: 420, maxWidth: 360 } } }}
      >
        {value.size > 0 && [
          <MenuItem key="__clear" onClick={() => onChange(new Set())}>
            <ListItemText primary={t($ => $.accountFilter.clear)} slotProps={{ primary: { variant: 'body2', color: 'primary' } }} />
          </MenuItem>,
          <Divider key="__clear-divider" />,
        ]}
        {groups.map(({ type, trees }) => [
          <Typography
            key={`${type}-header`}
            variant="caption"
            sx={{
              display: 'block', px: 2, pt: 1, pb: 0.25, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary',
            }}
          >
            {t($ => $.chartOfAccounts.types[type], { ns: 'settings' })}
          </Typography>,
          ...trees.flatMap((node) => renderNode(node, 0)),
        ])}
      </Menu>
    </>
  )
}
