import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import type { SvgIconComponent } from '@mui/icons-material'
import type { SxProps, Theme } from '@mui/material/styles'

interface DashboardCardProps {
  title: ReactNode
  icon?: SvgIconComponent
  count?: number
  action?: ReactNode
  viewAllTo?: string
  viewAllLabel?: string
  status?: 'ok' | 'error'
  isEmpty?: boolean
  emptyText?: string
  sx?: SxProps<Theme>
  children?: ReactNode
}

/**
 * Presentational dashboard card: a titled MUI Card with a leading icon, an
 * optional count badge after the title, an optional "View all" link, plus
 * error / empty / content states. Content (the item list) is passed as
 * children so the page stays thin.
 */
export default function DashboardCard({
  title,
  icon: Icon,
  count,
  action,
  viewAllTo,
  viewAllLabel = 'View all',
  status = 'ok',
  isEmpty = false,
  emptyText = 'Nothing to show',
  sx,
  children,
}: DashboardCardProps) {
  let body = children
  if (status === 'error') {
    body = (
      <Typography variant="body2" sx={{ py: 2, color: 'error.main' }}>
        ⚠ Couldn&apos;t load
      </Typography>
    )
  } else if (isEmpty) {
    body = (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        {emptyText}
      </Typography>
    )
  }

  return (
    <Card variant="outlined" data-card sx={{ height: '100%', boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)', ...sx }}>
      <CardContent sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          {Icon && <Icon fontSize="small" sx={{ color: 'text.secondary' }} />}
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          {count !== undefined && count > 0 && (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontSize: '0.75rem',
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              {count}
            </Box>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {action}
          {viewAllTo && (
            <Button
              component={RouterLink}
              to={viewAllTo}
              size="small"
              endIcon={<ChevronRightIcon />}
              sx={{ textTransform: 'none' }}
            >
              {viewAllLabel}
            </Button>
          )}
        </Box>

        {body}
      </CardContent>
    </Card>
  )
}
