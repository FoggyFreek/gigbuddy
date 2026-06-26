import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddLinkIcon from '@mui/icons-material/AddLink'
import LinkIcon from '@mui/icons-material/Link'
import LinkOffIcon from '@mui/icons-material/LinkOff'

interface SetlistTransitionPatch {
  linked_to_next?: boolean
  transition_note?: string | null
}

interface SetlistTransitionProps {
  linked?: boolean
  note?: string | null
  onUpdate: (patch: SetlistTransitionPatch) => void
  editing?: boolean
}

// Rendered between two consecutive song cards. When the songs aren't linked it's a
// thin hover zone that reveals an "add link" button; once linked it becomes an
// always-visible strip with a chain icon, an inline note, and an unlink button.
// It's a sibling of the cards (never inside the sortable node), so drag transforms
// don't move it.
export default function SetlistTransition({ linked = false, note = null, onUpdate, editing = true }: SetlistTransitionProps) {
  const { t } = useTranslation('setlists')
  // Read-only: a linked pair shows a static segue strip; an unlinked pair shows
  // nothing (the add-link affordance is editing-only).
  if (!editing) {
    if (!linked) return null
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          mx: 2,
          mb: 0.75,
          px: 1,
          py: 0.25,
          borderLeft: '2px solid',
          borderColor: 'primary.main',
          bgcolor: 'action.hover',
        }}
      >
        <LinkIcon fontSize="small" color="primary" />
        {note && (
          <Typography variant="caption" sx={{ fontSize: '0.8rem' }}>
            {note}
          </Typography>
        )}
      </Box>
    )
  }

  if (!linked) {
    return (
      <Box
        sx={{
          position: 'relative',
          height: 8,
          '&:hover .add-link-btn': { opacity: 1 },
        }}
      >
        <Tooltip title={t($ => $.transition.link)}>
          <IconButton
            size="small"
            className="add-link-btn"
            onClick={() => onUpdate({ linked_to_next: true })}
            aria-label={t($ => $.transition.linkAria)}
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              p: 0.25,
              opacity: 0,
              transition: 'opacity 120ms',
              bgcolor: 'background.paper',
              boxShadow: 1,
            }}
          >
            <AddLinkIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        mx: 2,
        mb: 0.75,
        px: 1,
        py: 0.25,
        borderLeft: '2px solid',
        borderColor: 'primary.main',
        bgcolor: 'action.hover',
        '&:hover .unlink-btn': { opacity: 1 },
      }}
    >
      <LinkIcon fontSize="small" color="primary" />
      <TextField
        variant="standard"
        size="small"
        placeholder={t($ => $.transition.notePlaceholder)}
        defaultValue={note || ''}
        onBlur={(e) => {
          const value = e.target.value.trim()
          if (value !== (note || '')) onUpdate({ transition_note: value || null })
        }}
        slotProps={{
          input: { disableUnderline: true, sx: { fontSize: '0.8rem' } },
          htmlInput: { 'aria-label': t($ => $.transition.noteAria) },
        }}
        sx={{ flexGrow: 1 }}
      />
      <Tooltip title={t($ => $.transition.remove)}>
        <IconButton
          size="small"
          className="unlink-btn"
          onClick={() => onUpdate({ linked_to_next: false, transition_note: null })}
          aria-label={t($ => $.transition.removeAria)}
          sx={{ p: 0.25, opacity: 0, transition: 'opacity 120ms' }}
        >
          <LinkOffIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
