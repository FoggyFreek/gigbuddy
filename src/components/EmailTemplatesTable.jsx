import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import DeleteIcon from '@mui/icons-material/Delete'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'

const COLUMN_COUNT = 3

function formatDate(val) {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function TemplateCard({ template, onClick, onDelete }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        p: 1.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: 'pointer',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="body2" fontWeight={600}>
            {template.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {template.subject || '(no subject)'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Created {formatDate(template.created_at)}
          </Typography>
        </Box>
        <IconButton
          size="small"
          aria-label="delete template"
          onClick={(e) => { e.stopPropagation(); onDelete?.(template) }}
          sx={{ mt: -0.5, mr: -0.5 }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  )
}

function DesktopRow({ template, onClick, onDelete }) {
  return (
    <TableRow hover onClick={onClick} sx={{ cursor: 'pointer' }}>
      <TableCell>
        <Typography variant="body2" fontWeight={600}>{template.name}</Typography>
      </TableCell>
      <TableCell>{template.subject || '—'}</TableCell>
      <TableCell align="right" padding="none" sx={{ pr: 1 }}>
        <IconButton
          size="small"
          aria-label="delete template"
          onClick={(e) => { e.stopPropagation(); onDelete?.(template) }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      </TableCell>
    </TableRow>
  )
}

export default function EmailTemplatesTable({ templates, onRowClick, onDelete }) {
  const theme = useTheme()
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'))

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {templates.length === 0 ? (
          <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
            No templates yet — create one to get started.
          </Box>
        ) : (
          templates.map((t) => (
            <TemplateCard key={t.id} template={t} onClick={() => onRowClick(t)} onDelete={onDelete} />
          ))
        )}
      </Paper>
    )
  }

  return (
    <Stack spacing={2}>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 600 } }}>
              <TableCell>Name</TableCell>
              <TableCell>Subject</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  No templates yet — create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              templates.map((t) => (
                <DesktopRow key={t.id} template={t} onClick={() => onRowClick(t)} onDelete={onDelete} />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  )
}
