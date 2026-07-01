import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import ListPagination from '../shared/ListPagination.tsx'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { formatEur } from '../../utils/purchaseTotals.ts'
import { formatShortDate } from '../../utils/dateFormat.ts'
import { purchaseStatusColor } from '../../utils/purchaseStatus.ts'
import StatusDot from '../StatusDot.tsx'
import MoneyCells, { MoneyHeaderCells } from '../shared/MoneyCells.tsx'
import type { Purchase, PurchaseStatus, Id } from '../../types/entities.ts'

const PAGE_SIZE = 25

interface PurchasesListProps {
  purchases: Purchase[]
  selectedId: Id | null
  onRowClick: (p: Purchase) => void
}

export default function PurchasesList({ purchases, selectedId, onRowClick }: Readonly<PurchasesListProps>) {
  const { t, i18n } = useTranslation('purchases')
  const isCompact = useCompactLayout()
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)

  // Filtering happens in the parent; clamp so a shrinking list can't strand
  // the user on an empty page.
  const pageCount = Math.max(0, Math.ceil(purchases.length / rowsPerPage) - 1)
  const safePage = Math.min(page, pageCount)
  const paged = purchases.slice(safePage * rowsPerPage, (safePage + 1) * rowsPerPage)

  const pagination = purchases.length > rowsPerPage && (
    <ListPagination
      count={purchases.length}
      page={safePage}
      rowsPerPage={rowsPerPage}
      rowsPerPageOptions={[25, 50, 100]}
      labelRowsPerPage={t($ => $.pagination.rowsPerPage)}
      labelDisplayedRows={({ from, to, count }) => t($ => $.pagination.displayedRows, { from, to, count })}
      getItemAriaLabel={(type) => t($ => $.pagination[type])}
      onPageChange={(_, p) => setPage(p)}
      onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
    />
  )

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {!purchases.length && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>{t($ => $.empty)}</Typography>
        )}
        {paged.map((p) => (
          <Box
            key={String(p.id)}
            onClick={() => onRowClick(p)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1.5,
              cursor: 'pointer',
              borderBottom: '1px solid',
              borderColor: 'divider',
              '&:last-of-type': { borderBottom: 'none' },
              '&:hover': { bgcolor: 'action.hover' },
              boxShadow: p.id === selectedId ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}` : 'none',
            }}
          >
            <StatusDot color={purchaseStatusColor(p.status)} label={p.status ? t($ => $.rawStatus[p.status as PurchaseStatus]) : undefined} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>#{p.receipt_number}</Typography>
                <Typography variant="caption" color="text.secondary">{formatShortDate(p.receipt_date, i18n.resolvedLanguage)}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.25 }}>
                {p.supplier_name || '-'}
              </Typography>
            </Box>
            <Typography variant="body1" sx={{ fontWeight: 500,  flexShrink: 0  }}>{formatEur(p.total_cents)}</Typography>
          </Box>
        ))}
        {pagination}
      </Paper>
    )
  }

  return (
    <Paper variant="outlined">
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '1%', whiteSpace: 'nowrap', px: 1.5 }} />
              <TableCell>{t($ => $.table.receiptNumber)}</TableCell>
              <TableCell>{t($ => $.table.date)}</TableCell>
              <TableCell>{t($ => $.labels.dueDate)}</TableCell>
              <TableCell>{t($ => $.labels.description)}</TableCell>
              <TableCell>{t($ => $.labels.supplier)}</TableCell>
              <MoneyHeaderCells label={t($ => $.labels.exclVat)} />
              <MoneyHeaderCells label={t($ => $.labels.inclVat)} />
            </TableRow>
          </TableHead>
          <TableBody>
            {!purchases.length && (
              <TableRow>
                <TableCell colSpan={10}>
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>{t($ => $.empty)}</Typography>
                </TableCell>
              </TableRow>
            )}
            {paged.map((p) => (
              <TableRow
                key={String(p.id)}
                hover
                selected={p.id === selectedId}
                sx={{ cursor: 'pointer' }}
                onClick={() => onRowClick(p)}
              >
                <TableCell sx={{ width: '1%', whiteSpace: 'nowrap', px: 1.5 }}><StatusDot color={purchaseStatusColor(p.status)} label={p.status ? t($ => $.rawStatus[p.status as PurchaseStatus]) : undefined} /></TableCell>
                <TableCell>{p.receipt_number}</TableCell>
                <TableCell>{formatShortDate(p.receipt_date, i18n.resolvedLanguage)}</TableCell>
                <TableCell>{p.due_date ? formatShortDate(p.due_date, i18n.resolvedLanguage) : ''}</TableCell>
                <TableCell>{p.description || ''}</TableCell>
                <TableCell>{p.supplier_name}</TableCell>
                <MoneyCells cents={p.subtotal_cents} />
                <MoneyCells cents={p.total_cents} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {pagination}
    </Paper>
  )
}
