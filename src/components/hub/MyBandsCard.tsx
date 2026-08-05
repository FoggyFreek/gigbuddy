import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Avatar from '@mui/material/Avatar'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import PersonOutlined from '@mui/icons-material/PersonOutlined'
import { useAuth } from '../../contexts/authContext.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { listMyBands, type MyBand } from '../../api/me.ts'
import { createContact } from '../../api/contacts.ts'
import { ENSEMBLE_CATEGORY } from '../../utils/contactCategories.ts'
import type { Id } from '../../types/entities.ts'

interface MyBandsCardProps {
  /** The caller's personal workspace, if they have one — external bands live there. */
  personalTenantId: Id | null
}

// Every band the musician plays in, of both sorts: gigbuddy tenants they are a
// member of, and external ensembles that exist only in their own address book.
// The external ones are contacts, deliberately not shell tenants.
export default function MyBandsCard({ personalTenantId }: Readonly<MyBandsCardProps>) {
  const { t } = useTranslation('dashboard')
  const compact = useCompactLayout()
  const { switchTenant } = useAuth()
  const [bands, setBands] = useState<MyBand[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    listMyBands()
      .then((res) => setBands(res.items))
      .catch(() => setError(t($ => $.hub.loadError)))
  }, [t])

  useEffect(() => { load() }, [load])

  async function addExternalBand() {
    if (personalTenantId === null) return
    setBusy(true)
    setError(null)
    try {
      // An external band is an address-book entry, nothing more — it gets no
      // tenant, so it never consumes the band cap.
      await switchTenant(personalTenantId)
      await createContact({ name: name.trim(), category: ENSEMBLE_CATEGORY })
      setAdding(false)
      setName('')
      load()
    } catch {
      setError(t($ => $.hub.bands.addFailed))
    } finally {
      setBusy(false)
    }
  }

  const bandRow = (band: MyBand) => {
    const label = band.source === 'contact'
      ? t($ => $.hub.bands.external)
      : t($ => $.hub.bands.onGigbuddy)
    const icon = band.kind === 'personal' ? <PersonOutlined /> : <GroupsOutlined />
    const content = (
      <>
        <ListItemAvatar>
          <Avatar sx={{ width: 32, height: 32 }}>{icon}</Avatar>
        </ListItemAvatar>
        <ListItemText primary={band.displayName} />
        <Chip size="small" label={label} variant="outlined" />
      </>
    )

    // Only a real tenant can be switched into; an external band has no data of
    // its own to open.
    return band.source === 'tenant' ? (
      <ListItemButton
        key={`t-${band.tenantId}`}
        onClick={() => { void switchTenant(band.tenantId).catch(() => {}) }}
      >
        {content}
      </ListItemButton>
    ) : (
      <ListItem key={`c-${band.contactId}`}>{content}</ListItem>
    )
  }

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {t($ => $.hub.bands.title)}
        </Typography>
        {personalTenantId !== null && (
          <Button size="small" onClick={() => setAdding(true)}>
            {t($ => $.hub.bands.add)}
          </Button>
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

      {bands.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t($ => $.hub.bands.empty)}
        </Typography>
      ) : (
        <List dense disablePadding>{bands.map(bandRow)}</List>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t($ => $.hub.bands.addTitle)}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t($ => $.hub.bands.addHelp)}
          </Typography>
          <TextField
            label={t($ => $.hub.bands.nameLabel)}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdding(false)} disabled={busy}>
            {t($ => $.hub.bands.cancel)}
          </Button>
          <Button
            variant="contained"
            disabled={busy || name.trim() === ''}
            onClick={() => { void addExternalBand() }}
          >
            {t($ => $.hub.bands.save)}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
