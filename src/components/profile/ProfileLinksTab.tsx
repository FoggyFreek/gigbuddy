import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Id } from '../../types/entities.ts'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import LaunchIcon from '@mui/icons-material/Launch'
import LinkIcon from '@mui/icons-material/Link'
import useDebouncedSave from '../../hooks/useDebouncedSave.ts'
import { updateLink } from '../../api/profile.ts'

interface ProfileLink {
  id?: Id
  label?: string
  url?: string
  sort_order?: number
}

interface ProfileLinkRowProps {
  link: ProfileLink
  onChange: (patch: Partial<ProfileLink>) => void
  onDelete: () => void
}

function ProfileLinkRow({ link, onChange, onDelete }: Readonly<ProfileLinkRowProps>) {
  const { t } = useTranslation('profile')
  const [editing, setEditing] = useState(false)
  const saveFn = useCallback(
    async (patch: Partial<ProfileLink>) => { await updateLink(link.id!, patch) },
    [link.id],
  )
  const { schedule } = useDebouncedSave(saveFn)

  function handle(field: keyof ProfileLink, value: string) {
    onChange({ [field]: value })
    schedule({ [field]: value })
  }

  if (!editing) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box sx={{ display: 'grid', placeItems: 'center' }}>
          <LinkIcon color="action" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{link.label || '—'}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            {link.url || '—'}
          </Typography>
        </Box>
        <Tooltip title={t($ => $.links.openInNewTab)}>
          <IconButton
            component="a"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            disabled={!link.url}
            size="small"
          >
            <Box sx={{ display: 'grid', placeItems: 'center' }}>
              <LaunchIcon fontSize="small" />
            </Box>
          </IconButton>
        </Tooltip>
        <Tooltip title={t($ => $.links.edit)}>
          <IconButton size="small" onClick={() => setEditing(true)}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t($ => $.links.delete)}>
          <IconButton onClick={onDelete} color="error" size="small">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    )
  }

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box sx={{ display: 'grid', placeItems: 'center' }}>
        <LinkIcon color="action" />
      </Box>
      <TextField
        label={t($ => $.links.label)}
        size="small"
        value={link.label}
        onChange={(e) => handle('label', e.target.value)}
        sx={{ flex: 1 }}
      />
      <TextField
        label={t($ => $.links.url)}
        size="small"
        value={link.url}
        onChange={(e) => handle('url', e.target.value)}
        sx={{ flex: 2 }}
      />
      <Tooltip title="Open in new tab">
        <span>
          <IconButton
            component="a"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            disabled={!link.url}
            size="small"
          >
            <Box sx={{ display: 'grid', placeItems: 'center' }}>
              <LaunchIcon fontSize="small" />
            </Box>
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t($ => $.links.doneEditing)}>
        <IconButton size="small" onClick={() => setEditing(false)} color="primary">
          <CheckIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Delete link">
        <IconButton onClick={onDelete} color="error" size="small">
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

interface NewLinkState {
  label: string
  url: string
}

interface ProfileLinksTabProps {
  links: ProfileLink[]
  newLink: NewLinkState
  setNewLink: Dispatch<SetStateAction<NewLinkState>>
  adding?: boolean
  onAdd: () => void
  onLinkChange: (id: Id, patch: Partial<ProfileLink>) => void
  onDeleteLink: (id: Id) => void
}

export default function ProfileLinksTab({ links, newLink, setNewLink, adding, onAdd, onLinkChange, onDeleteLink }: Readonly<ProfileLinksTabProps>) {
  const { t } = useTranslation('profile')
  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={2}>
        {links.map((link) => (
          <ProfileLinkRow
            key={String(link.id)}
            link={link}
            onChange={(patch) => onLinkChange(link.id!, patch)}
            onDelete={() => onDeleteLink(link.id!)}
          />
        ))}

        {links.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t($ => $.links.empty)}
          </Typography>
        )}

        <Divider />

        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            label={t($ => $.links.label)}
            size="small"
            value={newLink.label}
            onChange={(e) => setNewLink((p) => ({ ...p, label: e.target.value }))}
            sx={{ flex: 1 }}
          />
          <TextField
            label={t($ => $.links.url)}
            size="small"
            value={newLink.url}
            onChange={(e) => setNewLink((p) => ({ ...p, url: e.target.value }))}
            sx={{ flex: 2 }}
            placeholder="https://…"
          />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onAdd}
            disabled={!newLink.label.trim() || !newLink.url.trim() || adding}
            sx={{ height: 40, whiteSpace: 'nowrap' }}
          >
            {t($ => $.links.add)}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
