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
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import SavingsIcon from '@mui/icons-material/Savings'
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined'
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore'
import ToggleOffIcon from '@mui/icons-material/ToggleOff'
import ToggleOnIcon from '@mui/icons-material/ToggleOn'
import { listAccounts, createAccount, updateAccount, deleteAccount } from '../../../../finance/accounts/accounts.ts'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'
import type { Account, Id } from '../../../../types/entities.ts'

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

interface AccountNameEditorProps {
  initialName: string
  saving: boolean
  onSave: (name: string) => void
  onCancel: () => void
}

// Owns the draft for the row being edited. Mounted only while editing, so the
// draft starts from the current name without deriving state across renders.
function AccountNameEditor({ initialName, saving, onSave, onCancel }: Readonly<AccountNameEditorProps>) {
  const { t } = useTranslation(['settings', 'common'])
  const [draft, setDraft] = useState(initialName)

  return (
    <Stack direction="row" spacing={0.5} sx={{ flex: 1, alignItems: 'center' }}>
      <TextField
        autoFocus
        size="small"
        variant="standard"
        fullWidth
        label={t($ => $.chartOfAccounts.addDialog.nameLabel)}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSave(draft) }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        slotProps={{ htmlInput: { maxLength: 120 } }}
      />
      <IconButton
        size="small"
        aria-label={t($ => $.actions.save, { ns: 'common' })}
        disabled={saving || !draft.trim()}
        onClick={() => onSave(draft)}
      >
        <CheckIcon fontSize="small" color="primary" />
      </IconButton>
      <IconButton
        size="small"
        aria-label={t($ => $.actions.cancel, { ns: 'common' })}
        disabled={saving}
        onClick={onCancel}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}

interface AccountRowProps {
  account: AccountNode
  depth: number
  onAddChild: (account: AccountNode) => void
  onToggleActive: (account: AccountNode) => void
  onToggleCapitalizable: (account: AccountNode) => void
  onDelete: (account: AccountNode) => void
  onStartEdit: (account: AccountNode) => void
  onRename: (account: AccountNode, name: string) => void
  onCancelEdit: () => void
  onResetName: (account: AccountNode) => void
  editingId?: Id | null
  renameSaving?: boolean
  errorId?: Id | null
}

function AccountRow({
  account, depth, onAddChild, onToggleActive, onToggleCapitalizable, onDelete,
  onStartEdit, onRename, onCancelEdit, onResetName, editingId, renameSaving, errorId,
}: Readonly<AccountRowProps>) {
  const { t } = useTranslation(['settings', 'common'])
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const editing = editingId === account.id
  // Only a seeded account has a country default to go back to, which is the
  // same is_system gate the backend enforces.
  const resettable = Boolean(account.is_system && account.name_is_customized)

  const closeMenu = () => setMenuAnchor(null)
  // Every item dismisses the menu before acting, so a dialog or the inline
  // editor never opens behind it.
  const runFromMenu = (action: () => void) => () => { closeMenu(); action() }

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
        {editing ? (
          <AccountNameEditor
            initialName={account.name ?? ''}
            saving={Boolean(renameSaving)}
            onSave={(name) => onRename(account, name)}
            onCancel={onCancelEdit}
          />
        ) : (
          <Typography variant="body2" sx={{ flex: 1 }}>
            {account.name}
          </Typography>
        )}
        {!account.is_active && (
          <Chip label={t($ => $.chartOfAccounts.inactive)} size="small" sx={{ mr: 1, fontSize: 11 }} />
        )}
        {account.is_capitalizable && (
          <Chip label={t($ => $.chartOfAccounts.capitalizable)} size="small" color="primary" variant="outlined" sx={{ mr: 1, fontSize: 11 }} />
        )}
        {!editing && (
          <>
            <Tooltip title={t($ => $.chartOfAccounts.actions)}>
              <IconButton
                size="small"
                aria-label={t($ => $.chartOfAccounts.aria.actions)}
                onClick={(e) => setMenuAnchor(e.currentTarget)}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={closeMenu}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <MenuItem onClick={runFromMenu(() => onStartEdit(account))}>
                <ListItemIcon><EditOutlinedIcon fontSize="small" /></ListItemIcon>
                <ListItemText>{t($ => $.chartOfAccounts.rename)}</ListItemText>
              </MenuItem>
              {resettable && (
                <MenuItem onClick={runFromMenu(() => onResetName(account))}>
                  <ListItemIcon><SettingsBackupRestoreIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>{t($ => $.chartOfAccounts.resetName)}</ListItemText>
                </MenuItem>
              )}
              <MenuItem onClick={runFromMenu(() => onAddChild(account))}>
                <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>
                <ListItemText>{t($ => $.chartOfAccounts.addSubAccount)}</ListItemText>
              </MenuItem>
              {account.type === 'asset' && (
                <MenuItem onClick={runFromMenu(() => onToggleCapitalizable(account))}>
                  <ListItemIcon>
                    {account.is_capitalizable
                      ? <SavingsIcon fontSize="small" color="primary" />
                      : <SavingsOutlinedIcon fontSize="small" />}
                  </ListItemIcon>
                  <ListItemText>
                    {account.is_capitalizable
                      ? t($ => $.chartOfAccounts.unsetCapitalizable)
                      : t($ => $.chartOfAccounts.setCapitalizable)}
                  </ListItemText>
                </MenuItem>
              )}
              <MenuItem onClick={runFromMenu(() => onToggleActive(account))}>
                <ListItemIcon>
                  {account.is_active
                    ? <ToggleOnIcon fontSize="small" color="primary" />
                    : <ToggleOffIcon fontSize="small" />}
                </ListItemIcon>
                <ListItemText>
                  {account.is_active
                    ? t($ => $.chartOfAccounts.deactivate)
                    : t($ => $.chartOfAccounts.activate)}
                </ListItemText>
              </MenuItem>
              <MenuItem onClick={runFromMenu(() => onDelete(account))} sx={{ color: 'error.main' }}>
                <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
                <ListItemText>{t($ => $.actions.delete, { ns: 'common' })}</ListItemText>
              </MenuItem>
            </Menu>
          </>
        )}
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
          onStartEdit={onStartEdit}
          onRename={onRename}
          onCancelEdit={onCancelEdit}
          onResetName={onResetName}
          editingId={editingId}
          renameSaving={renameSaving}
          errorId={errorId}
        />
      ))}
    </>
  )
}

export default function ChartOfAccountsSection() {
  const { t } = useTranslation(['settings', 'common'])
  const compact = useCompactLayout()
  const [errorId, setErrorId] = useState<Id | null>(null)

  const [addParent, setAddParent] = useState<AccountNode | null>(null)
  const [addCode, setAddCode] = useState('')
  const [addName, setAddName] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<Id | null>(null)
  const [renameSaving, setRenameSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AccountNode | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState(false)

  // `loading` is the derived fact that the first fetch hasn't landed yet; a
  // reload leaves the current rows on screen (and keeps them on failure).
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])
  const [accountsState, setAccountsState] = useState<Account[] | null>(null)
  const accounts = accountsState ?? []
  const loading = accountsState == null

  useEffect(() => {
    let cancelled = false
    listAccounts()
      .then((rows) => { if (!cancelled) setAccountsState(rows) })
      // Leave the previous rows in place; just stop showing the spinner.
      .catch(() => { if (!cancelled) setAccountsState((prev) => prev ?? []) })
    return () => { cancelled = true }
  }, [reloadNonce])

  async function handleToggleActive(account: AccountNode) {
    setErrorId(null)
    try {
      await updateAccount(account.id, { is_active: !account.is_active })
      reload()
    } catch (err) {
      if ((err as { status?: number }).status === 409) setErrorId(account.id!)
    }
  }

  async function handleToggleCapitalizable(account: AccountNode) {
    setErrorId(null)
    try {
      await updateAccount(account.id, { is_capitalizable: !account.is_capitalizable })
      reload()
    } catch {
      // leave previous state
    }
  }

  // Sends the label only — the account code is its identity and never moves.
  async function submitName(account: AccountNode, name: string | null) {
    setRenameSaving(true)
    setErrorId(null)
    try {
      await updateAccount(account.id, { name })
      setEditingId(null)
      reload()
    } catch (err) {
      if ((err as { status?: number }).status === 409) setErrorId(account.id!)
      // Stay in edit mode so the draft isn't lost.
    } finally {
      setRenameSaving(false)
    }
  }

  async function handleRename(account: AccountNode, name: string) {
    const next = name.trim()
    if (!next || next === account.name) { setEditingId(null); return }
    await submitName(account, next)
  }

  function handleStartEdit(account: AccountNode) {
    setErrorId(null)
    setEditingId(account.id!)
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
      reload()
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
      reload()
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
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
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
                onStartEdit={handleStartEdit}
                onRename={handleRename}
                onCancelEdit={() => setEditingId(null)}
                onResetName={(account) => submitName(account, null)}
                editingId={editingId}
                renameSaving={renameSaving}
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
