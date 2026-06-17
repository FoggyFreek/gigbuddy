import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PointOfSaleOutlinedIcon from '@mui/icons-material/PointOfSaleOutlined'
import CloudDownloadOutlinedIcon from '@mui/icons-material/CloudDownloadOutlined'
import ProductDialog from '../components/merch/ProductDialog.tsx'
import RecordSaleDialog from '../components/merch/RecordSaleDialog.tsx'
import ShopifyImportDialog from '../components/merch/ShopifyImportDialog.tsx'
import { useMerchState } from '../components/merch/useMerchState.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import PeriodPicker from '../components/shared/periodPicker.tsx'
import SplitView from '../components/SplitView.tsx'
import {
  createProduct, updateProduct, archiveProduct,
  recordMerchSale, listMerchSalePeriods, listMerchSalesSummary,
} from '../api/merch.ts'
import { formatEur } from '../utils/purchaseTotals.ts'
import MoneyCells, { MoneyHeaderCells } from '../components/shared/MoneyCells.tsx'
import type { Product, MerchSale, MerchSalesSummaryRow, Period, Id } from '../types/entities.ts'

interface SaleBody {
  product_id: Id
  quantity: number
  unit_price_incl_cents: number
  vat_rate: number
  sale_date: string
  payment_method: string
  gig_id: Id | null
}

export default function MerchPage() {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const { products, revenueAccounts, error, setError, reload } = useMerchState()
  const [productDialog, setProductDialog] = useState<Product | 'new' | null>(null)
  const [saleDialogOpen, setSaleDialogOpen] = useState(false)
  const [shopifyOpen, setShopifyOpen] = useState(false)

  // Merch defaults to all-time: bands want their full sales-per-product picture
  // first, then narrow by period if they care to.
  const [period, setPeriod] = useState<Period>(() => ({ mode: 'all_time' }))
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)
  const [summary, setSummary] = useState<MerchSalesSummaryRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(true)

  const refreshPeriods = useCallback(async ({ signalLoaded = false } = {}) => {
    try {
      const dates = await listMerchSalePeriods()
      setAvailableDates(dates.filter(Boolean))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (signalLoaded) setPeriodsLoaded(true)
    }
  }, [setError])

  const loadSummary = useCallback(async () => {
    try {
      setSummaryLoading(true)
      setSummary(await listMerchSalesSummary(period))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSummaryLoading(false)
    }
  }, [period, setError])

  useEffect(() => {
    refreshPeriods({ signalLoaded: true })
  }, [refreshPeriods])

  useEffect(() => {
    if (periodsLoaded) loadSummary()
  }, [loadSummary, periodsLoaded])

  // The detail pane fires this after a void: the totals change and a product may
  // drop out of the summary (and its dates out of the picker) entirely.
  const handleSalesChanged = useCallback(() => {
    refreshPeriods()
    loadSummary()
    reload()
  }, [refreshPeriods, loadSummary, reload])

  async function handleProductSubmit(body: Partial<Product>) {
    if (productDialog === 'new') await createProduct(body)
    else if (productDialog && typeof productDialog === 'object') await updateProduct(productDialog.id!, body)
    await reload()
  }

  async function handleArchive(product: Product) {
    try {
      setError(null)
      await archiveProduct(product.id!)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleRecordSale(body: SaleBody): Promise<void> {
    await recordMerchSale(body as Partial<MerchSale>)
    handleSalesChanged()
  }

  const loading = products === null

  return (
    <SplitView basePath="/merch" outletContext={{ onReload: handleSalesChanged, period }}>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>Merchandise</Typography>

      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      )}

      {!loading && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="h6">Products</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button startIcon={<AddIcon />} onClick={() => setProductDialog('new')}>
                New product
              </Button>
              <Button
                variant="contained"
                startIcon={<PointOfSaleOutlinedIcon />}
                disabled={!products!.some((p) => !p.archived_at)}
                onClick={() => setSaleDialogOpen(true)}
              >
                Record sale
              </Button>
            </Box>
          </Box>

          {!products!.length && (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              No products yet — create one to start tracking inventory.
            </Typography>
          )}

          {Boolean(products!.length) && (
            <ProductsList
              products={products!}
              onEdit={(p) => setProductDialog(p)}
              onArchive={handleArchive}
            />
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1 }}>
              <Typography variant="h6">Sales by product</Typography>
              <Chip size="small" label={summary.length} />
            </Box>
            <Button
              size="small"
              startIcon={<CloudDownloadOutlinedIcon />}
              onClick={() => setShopifyOpen(true)}
            >
              Import from Shopify
            </Button>
            <PeriodPicker availableDates={availableDates} value={period} onChange={setPeriod} />
          </Box>

          {summaryLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>
          ) : (
            <ProductSalesSummaryList
              rows={summary}
              selectedId={selectedId}
              onRowClick={(row) => navigate(`/merch/${row.product_id}`)}
            />
          )}
        </>
      )}

      {productDialog && (
        <ProductDialog
          product={productDialog === 'new' ? undefined : productDialog}
          revenueAccounts={revenueAccounts}
          onSubmit={handleProductSubmit}
          onClose={() => setProductDialog(null)}
        />
      )}
      {saleDialogOpen && (
        <RecordSaleDialog
          products={products || []}
          onSubmit={handleRecordSale}
          onClose={() => setSaleDialogOpen(false)}
        />
      )}
      {shopifyOpen && (
        <ShopifyImportDialog
          products={products || []}
          onClose={(imported) => {
            setShopifyOpen(false)
            if (imported) handleSalesChanged()
          }}
        />
      )}
    </SplitView>
  )
}

const cardSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  p: 1.5,
  borderBottom: '1px solid',
  borderColor: 'divider',
  '&:last-of-type': { borderBottom: 'none' },
}

interface ProductActionsProps {
  product: Product
  onEdit: (p: Product) => void
  onArchive: (p: Product) => void
}

function ProductActions({ product, onEdit, onArchive }: ProductActionsProps) {
  return (
    <>
      <Tooltip title="Edit">
        <IconButton size="small" onClick={() => onEdit(product)}>
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {!product.archived_at && (
        <Tooltip title="Archive">
          <IconButton size="small" onClick={() => onArchive(product)}>
            <ArchiveOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </>
  )
}

interface ProductsListProps {
  products: Product[]
  onEdit: (p: Product) => void
  onArchive: (p: Product) => void
}

function ProductsList({ products, onEdit, onArchive }: ProductsListProps) {
  const isCompact = useCompactLayout()

  if (isCompact) {
    return (
      <Paper variant="outlined" sx={{ mb: 3 }}>
        {products.map((p) => (
          <Box key={String(p.id)} sx={{ ...cardSx, opacity: p.archived_at ? 0.5 : 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</Typography>
                {p.archived_at && <Chip label="Archived" size="small" />}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {formatEur(p.default_price_incl_cents)} incl. {Number(p.vat_rate)}% VAT · cost {formatEur(p.unit_cost_cents)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {p.quantity_on_hand} on hand
              </Typography>
            </Box>
            <Box sx={{ flexShrink: 0 }}>
              <ProductActions product={p} onEdit={onEdit} onArchive={onArchive} />
            </Box>
          </Box>
        ))}
      </Paper>
    )
  }

  return (
    <Paper variant="outlined" sx={{ mb: 3 }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <MoneyHeaderCells label="Unit cost" />
              <MoneyHeaderCells label="Price (incl. VAT)" />
              <TableCell align="right">VAT</TableCell>
              <TableCell align="right">On hand</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {products.map((p) => (
              <TableRow key={String(p.id)} sx={p.archived_at ? { opacity: 0.5 } : undefined}>
                <TableCell>
                  {p.name}
                  {p.archived_at && <Chip label="Archived" size="small" sx={{ ml: 1 }} />}
                </TableCell>
                <MoneyCells cents={p.unit_cost_cents} />
                <MoneyCells cents={p.default_price_incl_cents} />
                <TableCell align="right">{Number(p.vat_rate)}%</TableCell>
                <TableCell align="right">{p.quantity_on_hand}</TableCell>
                <TableCell align="right">
                  <ProductActions product={p} onEdit={onEdit} onArchive={onArchive} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}

function accountLabel(row: MerchSalesSummaryRow): string {
  if (!row.revenue_account_code) return '—'
  return row.revenue_account_name
    ? `${row.revenue_account_code} — ${row.revenue_account_name}`
    : row.revenue_account_code
}

interface ProductSalesSummaryListProps {
  rows: MerchSalesSummaryRow[]
  selectedId: Id | null
  onRowClick: (row: MerchSalesSummaryRow) => void
}

function ProductSalesSummaryList({ rows, selectedId, onRowClick }: ProductSalesSummaryListProps) {
  const isCompact = useCompactLayout()

  if (!rows.length) {
    return (
      <Paper variant="outlined">
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          No sales in this period.
        </Typography>
      </Paper>
    )
  }

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {rows.map((row) => (
          <Box
            key={String(row.product_id)}
            onClick={() => onRowClick(row)}
            sx={{
              ...cardSx,
              cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' },
              boxShadow: row.product_id === selectedId
                ? (t) => `inset -3px 0 0 0 ${t.palette.primary.main}`
                : 'none',
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.product_name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {accountLabel(row)} · {row.total_qty} sold
              </Typography>
            </Box>
            <Typography variant="body1" sx={{ fontWeight: 500, flexShrink: 0 }}>
              {formatEur(row.total_amount_cents)}
            </Typography>
          </Box>
        ))}
      </Paper>
    )
  }

  return (
    <Paper variant="outlined">
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Product</TableCell>
              <TableCell>Account</TableCell>
              <TableCell align="right">Qty</TableCell>
              <MoneyHeaderCells label="Total" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={String(row.product_id)}
                hover
                selected={row.product_id === selectedId}
                sx={{ cursor: 'pointer' }}
                onClick={() => onRowClick(row)}
              >
                <TableCell>{row.product_name}</TableCell>
                <TableCell>{accountLabel(row)}</TableCell>
                <TableCell align="right">{row.total_qty}</TableCell>
                <MoneyCells cents={row.total_amount_cents} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}
