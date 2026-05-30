import PropTypes from 'prop-types'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'

/**
 * Presentational dashboard card: a titled MUI Card with an optional "View all"
 * link, plus error / empty / content states. Content (the item list) is passed
 * as children so the page stays thin.
 */
export default function DashboardCard({
  title,
  viewAllTo,
  status = 'ok',
  isEmpty = false,
  emptyText = 'Nothing to show',
  children,
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
          {viewAllTo && (
            <Button
              component={RouterLink}
              to={viewAllTo}
              size="small"
              endIcon={<ChevronRightIcon />}
              sx={{ textTransform: 'none' }}
            >
              View all
            </Button>
          )}
        </Box>

        {status === 'error' ? (
          <Typography variant="body2" sx={{ py: 2, color: 'error.main' }}>
            ⚠ Couldn&apos;t load
          </Typography>
        ) : isEmpty ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            {emptyText}
          </Typography>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}

DashboardCard.propTypes = {
  title: PropTypes.string.isRequired,
  viewAllTo: PropTypes.string,
  status: PropTypes.oneOf(['ok', 'error']),
  isEmpty: PropTypes.bool,
  emptyText: PropTypes.string,
  children: PropTypes.node,
}
