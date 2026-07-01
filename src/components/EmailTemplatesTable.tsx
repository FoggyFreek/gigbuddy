import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import type { Id } from '../types/entities.ts'

interface EmailTemplate {
  id?: Id
  name?: string
  subject?: string
  created_at?: string
}

interface TemplateCardProps {
  template: EmailTemplate
  onClick: () => void
}

interface DesktopRowProps {
  template: EmailTemplate
  onClick: () => void
}

interface EmailTemplatesTableProps {
  templates: EmailTemplate[]
  onRowClick: (template: EmailTemplate) => void
}

const COLUMN_COUNT = 3

function formatDate(val?: string): string {
  if (!val) return '—'
  return new Date(val).toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function TemplateCard({ template, onClick }: Readonly<TemplateCardProps>) {
  const { t } = useTranslation('emailTemplates')
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
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {template.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {template.subject || t($ => $.table.noSubject)}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t($ => $.table.created, { date: formatDate(template.created_at) })}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

function DesktopRow({ template, onClick }: Readonly<DesktopRowProps>) {
  return (
    <TableRow hover onClick={onClick} sx={{ cursor: 'pointer' }}>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{template.name}</Typography>
      </TableCell>
      <TableCell>{template.subject || '—'}</TableCell>
      <TableCell align="right" padding="none" sx={{ pr: 1 }}>
      </TableCell>
    </TableRow>
  )
}

export default function EmailTemplatesTable({ templates, onRowClick }: Readonly<EmailTemplatesTableProps>) {
  const { t } = useTranslation('emailTemplates')
  const theme = useTheme()
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'))

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {templates.length === 0 ? (
          <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
            {t($ => $.table.empty)}
          </Box>
        ) : (
          templates.map((t) => (
            <TemplateCard key={String(t.id)} template={t} onClick={() => onRowClick(t)} />
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
              <TableCell>{t($ => $.table.name)}</TableCell>
              <TableCell>{t($ => $.table.subject)}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  {t($ => $.table.empty)}
                </TableCell>
              </TableRow>
            ) : (
              templates.map((t) => (
                <DesktopRow key={String(t.id)} template={t} onClick={() => onRowClick(t)} />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  )
}
