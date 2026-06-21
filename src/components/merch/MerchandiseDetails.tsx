import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TableSortLabel from '@mui/material/TableSortLabel'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined'
import VoidSaleDialog from './VoidSaleDialog.tsx'
import ListPagination from '../shared/ListPagination.tsx'
import MoneyCells, { MoneyHeaderCells } from '../shared/MoneyCells.tsx'
import { listMerchSales, voidMerchSale } from '../../api/merch.ts'
import type { MerchSale, Period, Id } from '../../types/entities.ts'

const PAGE_SIZE = 25

type SortKey = 'date' | 'qty' | 'amount'
type SortDir = 'asc' | 'desc'

function saleAmount(s: MerchSale): number {
  // Imported sales carry the exact gross; manual sales use quantity × unit price.
  return s.gross_incl_cents ?? (s.quantity ?? 0) * (s.unit_price_incl_cents ?? 0)
}

interface MerchandiseDetailsProps {
  productId: Id
  period?: Period | null
  onReload?: () => void
}

export default function MerchandiseDetails({ productId, period, onReload }: MerchandiseDetailsProps) {
  const [sales, setSales] = useState<MerchSale[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [voidTarget, setVoidTarget] = useState<MerchSale | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZE)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setSales(await listMerchSales(period, productId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [period, productId])

  useEffect(() => { if (productId) load() }, [load, productId])

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    if (!sales) return []
    const dir = sortDir === 'asc' ? 1 : -1
    const value = (s: MerchSale) => {
      if (sortKey === 'date') return s.sale_date ?? ''
      if (sortKey === 'qty') return s.quantity ?? 0
      return saleAmount(s)
    }
    return sales.filter((s) => s.status !== 'voided').sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [sales, sortKey, sortDir])

  // Clamp so a shrinking list (e.g. after a void) can't strand the user on an
  // empty page.
  const pageCount = Math.max(0, Math.ceil(sorted.length / rowsPerPage) - 1)
  const safePage = Math.min(page, pageCount)
  const paged = sorted.slice(safePage * rowsPerPage, (safePage + 1) * rowsPerPage)

  async function handleVoid() {
    const sale = voidTarget
    setVoidTarget(null)
    if (!sale) return
    try {
      setError(null)
      await voidMerchSale(sale.id!)
      await load()
      onReload?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading && sales === null) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
    )
  }

  if (sales === null) return null

  const productName = sales[0]?.product_name

  return (
    <Box>
      {productName && (
        <Typography variant="h6" sx={{ mb: 1.5 }}>{productName}</Typography>
      )}
      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      {!sorted.length ? (
        <Paper variant="outlined">
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No sales in this period.
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sortDirection={sortKey === 'date' ? sortDir : false}>
                    <TableSortLabel
                      active={sortKey === 'date'}
                      direction={sortKey === 'date' ? sortDir : 'desc'}
                      onClick={() => handleSort('date')}
                    >
                      Date
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sortDirection={sortKey === 'qty' ? sortDir : false}>
                    <TableSortLabel
                      active={sortKey === 'qty'}
                      direction={sortKey === 'qty' ? sortDir : 'desc'}
                      onClick={() => handleSort('qty')}
                    >
                      Qty
                    </TableSortLabel>
                  </TableCell>
                  <MoneyHeaderCells label="Unit price" />
                  <MoneyHeaderCells
                    label={
                      <TableSortLabel
                        active={sortKey === 'amount'}
                        direction={sortKey === 'amount' ? sortDir : 'desc'}
                        onClick={() => handleSort('amount')}
                      >
                        Total
                      </TableSortLabel>
                    }
                  />
                  <TableCell>Paid into</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paged.map((s) => (
                  <TableRow key={String(s.id)}>
                    <TableCell>{s.sale_date}</TableCell>
                    <TableCell align="right">{s.quantity}</TableCell>
                    <MoneyCells cents={s.unit_price_incl_cents} />
                    <MoneyCells cents={saleAmount(s)} />
                    <TableCell>{s.payment_method === 'cash' ? 'Cash on hand' : 'Bank'}</TableCell>
                    <TableCell align="right">
                      {s.status === 'recorded' && (
                        <Tooltip title="Void sale">
                          <IconButton size="small" onClick={() => setVoidTarget(s)}>
                            <BlockOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {sorted.length > rowsPerPage && (
            <ListPagination
              count={sorted.length}
              page={safePage}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[25, 50, 100]}
              onPageChange={(_, p) => setPage(p)}
              onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
            />
          )}
        </Paper>
      )}

      {voidTarget && (
        <VoidSaleDialog
          sale={voidTarget}
          onConfirm={handleVoid}
          onClose={() => setVoidTarget(null)}
        />
      )}
    </Box>
  )
}
