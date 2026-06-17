import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import SavingsIcon from '@mui/icons-material/Savings'
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined'
import ToggleOffIcon from '@mui/icons-material/ToggleOff'
import ToggleOnIcon from '@mui/icons-material/ToggleOn'
import { listAccounts, createAccount, updateAccount, deleteAccount } from '../../api/accounts.ts'
import type { Account, Id } from '../../types/entities.ts'

// Account nodes in the tree have their children attached.
type AccountNode = Account & { children: AccountNode[] }

const TYPE_LABELS: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  cost_of_goods_sold: 'Cost of Goods Sold',
  expense: 'Expenses',
}
const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'cost_of_goods_sold', 'expense']

function buildTree(accounts: Account[]): AccountNode[] {
  const byCode = new Map<string, AccountNode>(accounts.map((a) => [a.code!, { ...a, children: [] }]))
  const roots: AccountNode[] = []
  for (const node of byCode.values()) {
    if (node.parent_code && byCode.has(node.parent_code)) {
      byCode.get(node.parent_code)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  for (const node of byCode.values()) {
    node.children.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
  }
  roots.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
  return roots
}

interface AccountRowProps {
  account: AccountNode
  depth: number
  onAddChild: (account: AccountNode) => void
  onToggleActive: (account: AccountNode) => void
  onToggleCapitalizable: (account: AccountNode) => void
  onDelete: (account: AccountNode) => void
  errorId?: Id | null
}

function AccountRow({ account, depth, onAddChild, onToggleActive, onToggleCapitalizable, onDelete, errorId }: AccountRowProps) {
  return (
    <>
      <Stack
        data-testid={`account-row-${account.id}`}
        direction="row"
        sx={{ alignItems: 'center', py: 0.5, pl: depth * 3, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Typography
          variant="body2"
          sx={{ fontFamily: 'monospace', minWidth: 64, color: 'text.secondary', flexShrink: 0 }}
        >
          {account.code}
        </Typography>
        <Typography variant="body2" sx={{ flex: 1 }}>
          {account.name}
        </Typography>
        {!account.is_active && (
          <Chip label="Inactive" size="small" sx={{ mr: 1, fontSize: 11 }} />
        )}
        {account.is_capitalizable && (
          <Chip label="Capitalizable" size="small" color="primary" variant="outlined" sx={{ mr: 1, fontSize: 11 }} />
        )}
        {account.type === 'asset' && (
          <Tooltip title={account.is_capitalizable
            ? 'Stop offering this asset account on purchases'
            : 'Allow capitalizing purchases to this asset account'}
          >
            <IconButton
              size="small"
              aria-label={account.is_capitalizable ? 'unset capitalizable' : 'set capitalizable'}
              onClick={() => onToggleCapitalizable(account)}
            >
              {account.is_capitalizable
                ? <SavingsIcon fontSize="small" color="primary" />
                : <SavingsOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Add sub-account">
          <IconButton
            size="small"
            aria-label="add sub-account"
            onClick={() => onAddChild(account)}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={account.is_active ? 'Deactivate' : 'Activate'}>
          <IconButton
            size="small"
            aria-label={account.is_active ? 'deactivate' : 'activate'}
            onClick={() => onToggleActive(account)}
          >
            {account.is_active ? <ToggleOnIcon fontSize="small" color="primary" /> : <ToggleOffIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            size="small"
            aria-label="delete"
            color="error"
            onClick={() => onDelete(account)}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {errorId === account.id && (
        <Typography variant="caption" color="error" sx={{ pl: depth * 3 + 1 }}>
          Account is in use and cannot be modified.
        </Typography>
      )}
      {account.children.map((child) => (
        <AccountRow
          key={child.id}
          account={child}
          depth={depth + 1}
          onAddChild={onAddChild}
          onToggleActive={onToggleActive}
          onToggleCapitalizable={onToggleCapitalizable}
          onDelete={onDelete}
          errorId={errorId}
        />
      ))}
    </>
  )
}

export default function ChartOfAccountsSection() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [errorId, setErrorId] = useState<Id | null>(null)

  const [addParent, setAddParent] = useState<AccountNode | null>(null)
  const [addCode, setAddCode] = useState('')
  const [addName, setAddName] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<AccountNode | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState(false)

  const reload = useCallback(async () => {
    try {
      setAccounts(await listAccounts())
    } catch {
      // leave previous state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  async function handleToggleActive(account: AccountNode) {
    setErrorId(null)
    try {
      await updateAccount(account.id, { is_active: !account.is_active })
      await reload()
    } catch (err) {
      if ((err as { status?: number }).status === 409) setErrorId(account.id!)
    }
  }

  async function handleToggleCapitalizable(account: AccountNode) {
    setErrorId(null)
    try {
      await updateAccount(account.id, { is_capitalizable: !account.is_capitalizable })
      await reload()
    } catch {
      // leave previous state
    }
  }

  function handleAddChild(parent: AccountNode) {
    setAddParent(parent)
    setAddCode('')
    setAddName('')
    setAddError(null)
  }

  async function handleAddSubmit() {
    if (!addParent) return
    setAddSaving(true)
    setAddError(null)
    try {
      await createAccount({ code: addCode, name: addName, type: addParent.type, parent_code: addParent.code })
      setAddParent(null)
      await reload()
    } catch (err) {
      setAddError((err as Error).message || 'Failed to create account')
    } finally {
      setAddSaving(false)
    }
  }

  function handleDeleteClick(account: AccountNode) {
    setDeleteTarget(account)
    setErrorId(null)
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleteConfirming(true)
    setErrorId(null)
    try {
      await deleteAccount(deleteTarget.id)
      setDeleteTarget(null)
      await reload()
    } catch (err) {
      if ((err as { status?: number }).status === 409) setErrorId(deleteTarget.id!)
      setDeleteTarget(null)
    } finally {
      setDeleteConfirming(false)
    }
  }

  const groupedTrees = TYPE_ORDER.map((type) => {
    const typeAccounts = accounts.filter((a) => a.type === type)
    if (!typeAccounts.length) return null
    const trees = buildTree(typeAccounts).filter((n) => !n.parent_code || !accounts.some((a) => a.code === n.parent_code && a.type === type))
    return { type, trees }
  }).filter(Boolean) as Array<{ type: string; trees: AccountNode[] }>

  return (
    <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <AccountBalanceIcon fontSize="small" color="primary" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Chart of Accounts
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The accounts used to categorize financial transactions. Add sub-accounts or deactivate accounts you don&apos;t need.
      </Typography>

      {loading ? (
        <CircularProgress size={20} />
      ) : (
        groupedTrees.map(({ type, trees }) => (
          <Box key={type} sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
              {TYPE_LABELS[type]}
            </Typography>
            {trees.map((node) => (
              <AccountRow
                key={node.id}
                account={node}
                depth={0}
                onAddChild={handleAddChild}
                onToggleActive={handleToggleActive}
                onToggleCapitalizable={handleToggleCapitalizable}
                onDelete={handleDeleteClick}
                errorId={errorId}
              />
            ))}
          </Box>
        ))
      )}

      {/* Add sub-account dialog */}
      <Dialog open={Boolean(addParent)} onClose={() => setAddParent(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Add sub-account under {addParent?.code}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Account code"
              size="small"
              fullWidth
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 6, pattern: '[0-9]{4,6}' } }}
            />
            <TextField
              label="Account name"
              size="small"
              fullWidth
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              error={!!addError}
              helperText={addError || `Type: ${addParent?.type}`}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddParent(null)} disabled={addSaving}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAddSubmit}
            disabled={!addCode || !addName || addSaving}
            startIcon={addSaving ? <CircularProgress size={14} color="inherit" /> : null}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs">
        <DialogTitle>Delete account?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete <strong>{deleteTarget?.code} {deleteTarget?.name}</strong>? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteConfirm}
            disabled={deleteConfirming}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
