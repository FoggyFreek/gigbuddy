import { useTranslation } from 'react-i18next'
import Popover from '@mui/material/Popover'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import AddIcon from '@mui/icons-material/Add'

interface JournalLinePoppperProps {
  anchorEl: HTMLElement | null
  onClose: () => void
  onDuplicate: () => void
  onDelete: () => void
  onAdd: () => void
  canDelete?: boolean
}

// Per-line action popper: duplicate, delete, add line (matches the screenshot).
export default function JournalLinePopper({ anchorEl, onClose, onDuplicate, onDelete, onAdd, canDelete }: Readonly<JournalLinePoppperProps>) {
  const { t } = useTranslation('journal')
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'center', horizontal: 'left' }}
      transformOrigin={{ vertical: 'center', horizontal: 'right' }}
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.25 }}>
        <Tooltip title={t($ => $.line.duplicate)}>
          <IconButton size="small" aria-label={t($ => $.line.duplicateAria)} onClick={() => { onDuplicate(); onClose() }}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t($ => $.line.delete)}>
          <span>
            <IconButton size="small" aria-label={t($ => $.line.deleteAria)} disabled={!canDelete} onClick={() => { onDelete(); onClose() }}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t($ => $.line.add)}>
          <IconButton size="small" aria-label={t($ => $.line.addAria)} onClick={() => { onAdd(); onClose() }}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Popover>
  )
}
