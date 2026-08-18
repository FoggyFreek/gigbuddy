import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import type { SvgIconComponent } from '@mui/icons-material'

export interface FloatingTab<K extends string> {
  key: K
  Icon: SvgIconComponent
  /** Tooltip text and accessible name — callers translate it. */
  label: string
  /** Optional count badge (hidden at 0), e.g. open tasks. */
  badgeCount?: number
}

interface FloatingTabsProps<K extends string> {
  tabs: readonly FloatingTab<K>[]
  value: K
  onChange: (key: K) => void
}

/**
 * The rounded icon pill that floats over a detail page's header image, overlapping
 * it by about half its own height. Purely presentational: the caller owns which
 * tab is selected and keeps its panels mounted so their state survives a switch.
 */
export default function FloatingTabs<K extends string>({ tabs, value, onChange }: Readonly<FloatingTabsProps<K>>) {
  return (
    <Box
      sx={{
        position: 'relative',
        zIndex: 2,
        display: 'flex',
        justifyContent: 'center',
        mt: -3.25,
        mb: 3,
      }}
    >
      <Paper elevation={6} sx={{ display: 'inline-flex', gap: 0.5, p: 0.75, borderRadius: 999 }}>
        {tabs.map(({ key, Icon, label, badgeCount = 0 }) => {
          const selected = value === key
          return (
            <Tooltip key={key} title={label}>
              <IconButton
                aria-label={label}
                aria-pressed={selected}
                onClick={() => onChange(key)}
                color={selected ? 'primary' : 'default'}
                sx={{
                  bgcolor: selected ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                }}
              >
                {badgeCount > 0 ? (
                  <Badge
                    badgeContent={badgeCount}
                    color="primary"
                    anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                  >
                    <Icon />
                  </Badge>
                ) : (
                  <Icon />
                )}
              </IconButton>
            </Tooltip>
          )
        })}
      </Paper>
    </Box>
  )
}
