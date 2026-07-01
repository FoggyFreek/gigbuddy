import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import type { Account, Id } from '../../types/entities.ts'

// Account nodes in the tree have their children attached.
type AccountNode = Account & { children: AccountNode[] }

const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'cost_of_goods_sold', 'expense'] as const
type AccountType = typeof TYPE_ORDER[number]

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

function AccountRow({ account, depth, onAddChild, onToggleActive, onToggleCapitalizable, onDelete, errorId }: Readonly<AccountRowProps>) {
  const { t } = useTranslation(['settings', 'common'])
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
          <Chip label={t($ => $.chartOfAccounts.inactive)} size="small" sx={{ mr: 1, fontSize: 11 }} />
        )}
        {account.is_capitalizable && (
          <Chip label={t($ => $.chartOfAccounts.capitalizable)} size="small" color="primary" variant="outlined" sx={{ mr: 1, fontSize: 11 }} />
        )}
        {account.type === 'asset' && (
          <Tooltip title={account.is_capitalizable
            ? t($ => $.chartOfAccounts.unsetCapitalizable)
            : t($ => $.chartOfAccounts.setCapitalizable)}
          >
            <IconButton
              size="small"
              aria-label={account.is_capitalizable ? t($ => $.chartOfAccounts.aria.unsetCapitalizable) : t($ => $.chartOfAccounts.aria.setCapitalizable)}
              onClick={() => onToggleCapitalizable(account)}
            >
              {account.is_capitalizable
                ? <SavingsIcon fontSize="small" color="primary" />
                : <SavingsOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t($ => $.chartOfAccounts.addSubAccount)}>
          <IconButton
            size="small"
            aria-label={t($ => $.chartOfAccounts.aria.addSubAccount)}
            onClick={() => onAddChild(account)}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={account.is_active ? t($ => $.chartOfAccounts.deactivate) : t($ => $.chartOfAccounts.activate)}>
          <IconButton
            size="small"
            aria-label={account.is_active ? t($ => $.chartOfAccounts.aria.deactivate) : t($ => $.chartOfAccounts.aria.activate)}
            onClick={() => onToggleActive(account)}
          >
            {account.is_active ? <ToggleOnIcon fontSize="small" color="primary" /> : <ToggleOffIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title={t($ => $.actions.delete, { ns: 'common' })}>
          <IconButton
            size="small"
            aria-label={t($ => $.chartOfAccounts.aria.delete)}
            color="error"
            onClick={() => onDelete(account)}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {errorId === account.id && (
        <Typography variant="caption" color="error" sx={{ pl: depth * 3 + 1 }}>
          {t($ => $.chartOfAccounts.inUse)}
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
  const { t } = useTranslation(['settings', 'common'])
  const compact = useCompactLayout()
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
      setAddError((err as Error).message || t($ => $.chartOfAccounts.addDialog.createFailed))
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
  }).filter(Boolean) as Array<{ type: AccountType; trees: AccountNode[] }>

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3, mt: 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <AccountBalanceIcon fontSize="small" color="primary" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.chartOfAccounts.title)}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t($ => $.chartOfAccounts.description)}
      </Typography>

      {loading ? (
        <CircularProgress size={20} />
      ) : (
        groupedTrees.map(({ type, trees }) => (
          <Box key={type} sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
              {t($ => $.chartOfAccounts.types[type])}
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
        <DialogTitle>{t($ => $.chartOfAccounts.addDialog.title, { code: addParent?.code })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t($ => $.chartOfAccounts.addDialog.codeLabel)}
              size="small"
              fullWidth
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 6, pattern: '[0-9]{4,6}' } }}
            />
            <TextField
              label={t($ => $.chartOfAccounts.addDialog.nameLabel)}
              size="small"
              fullWidth
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              error={!!addError}
              helperText={addError || t($ => $.chartOfAccounts.addDialog.typeHelper, { type: addParent?.type })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddParent(null)} disabled={addSaving}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
          <Button
            variant="contained"
            onClick={handleAddSubmit}
            disabled={!addCode || !addName || addSaving}
            startIcon={addSaving ? <CircularProgress size={14} color="inherit" /> : null}
          >
            {t($ => $.actions.add, { ns: 'common' })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs">
        <DialogTitle>{t($ => $.chartOfAccounts.deleteDialog.title)}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <Trans
              t={t}
              i18nKey={$ => $.chartOfAccounts.deleteDialog.confirm}
              values={{ label: `${deleteTarget?.code ?? ''} ${deleteTarget?.name ?? ''}`.trim() }}
              components={{ strong: <strong /> }}
            />
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteConfirm}
            disabled={deleteConfirming}
          >
            {t($ => $.actions.confirm, { ns: 'common' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
