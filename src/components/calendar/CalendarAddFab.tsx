import type { MouseEvent } from 'react'
import Box from '@mui/material/Box'
import Fab from '@mui/material/Fab'
import AddIcon from '@mui/icons-material/Add'
import { useSplitPaneLayout } from '../../hooks/useCompactLayout.ts'

interface CalendarAddFabProps {
  label: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}

// A viewport-fixed FAB would sit on top of the detail pane once a SplitView
// forces the compact layout on the calendar, so inside a pane it sticks to the
// bottom of the list column instead: `mt: auto` drops it to the foot of the
// column when the content is short, sticky keeps it there once it scrolls.
export default function CalendarAddFab({ label, onClick }: Readonly<CalendarAddFabProps>) {
  const inSplitPane = useSplitPaneLayout()

  if (!inSplitPane) {
    return (
      <Fab
        color="primary"
        aria-label={label}
        onClick={onClick}
        sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: (theme) => theme.zIndex.fab }}
      >
        <AddIcon />
      </Fab>
    )
  }

  return (
    <Box
      sx={{
        position: 'sticky',
        bottom: 0,
        mt: 'auto',
        py: 2,
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: (theme) => theme.zIndex.fab,
        pointerEvents: 'none',
      }}
    >
      <Fab color="primary" aria-label={label} onClick={onClick} sx={{ pointerEvents: 'auto' }}>
        <AddIcon />
      </Fab>
    </Box>
  )
}
