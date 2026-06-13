import { useState } from 'react'
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
import TablePagination from '@mui/material/TablePagination'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined'
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PointOfSaleOutlinedIcon from '@mui/icons-material/PointOfSaleOutlined'
import PropTypes from 'prop-types'
import ProductDialog from '../components/merch/ProductDialog.jsx'
import VoidSaleDialog from '../components/merch/VoidSaleDialog.jsx'
import RecordSaleDialog from '../components/merch/RecordSaleDialog.jsx'
import { useMerchState } from '../components/merch/useMerchState.js'
import { useCompactLayout } from '../hooks/useCompactLayout.js'
import {
  createProduct, updateProduct, archiveProduct,
  recordMerchSale, voidMerchSale,
} from '../api/merch.js'
import { formatEur } from '../utils/purchaseTotals.js'
import { productShape, merchSaleShape } from '../propTypes/shared.js'
import MoneyCells, { MoneyHeaderCells } from '../components/shared/MoneyCells.jsx'

export default function MerchPage() {
  const { products, sales, error, setError, reload } = useMerchState()
  const [productDialog, setProductDialog] = useState(null) // false-y | 'new' | product
  const [saleDialogOpen, setSaleDialogOpen] = useState(false)
  const [voidTarget, setVoidTarget] = useState(null)

  async function handleProductSubmit(body) {
    if (productDialog === 'new') await createProduct(body)
    else await updateProduct(productDialog.id, body)
    await reload()
  }

  async function handleArchive(product) {
    try {
      setError(null)
      await archiveProduct(product.id)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleRecordSale(body) {
    await recordMerchSale(body)
    await reload()
  }

  async function handleVoid() {
    const sale = voidTarget
    setVoidTarget(null)
    try {
      setError(null)
      await voidMerchSale(sale.id)
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  const loading = products === null || sales === null

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Merchandise</Typography>

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
                disabled={!products.some((p) => !p.archived_at)}
                onClick={() => setSaleDialogOpen(true)}
              >
                Record sale
              </Button>
            </Box>
          </Box>

          {!products.length && (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              No products yet — create one to start tracking inventory.
            </Typography>
          )}

          {Boolean(products.length) && (
            <ProductsList
              products={products}
              onEdit={(p) => setProductDialog(p)}
              onArchive={handleArchive}
            />
          )}

          <Typography variant="h6" sx={{ mb: 1 }}>Sales</Typography>
          {!sales.length && (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              No sales recorded yet.
            </Typography>
          )}
          {Boolean(sales.length) && (
            <SalesList sales={sales} onVoid={(s) => setVoidTarget(s)} />
          )}
        </>
      )}

      {productDialog && (
        <ProductDialog
          product={productDialog === 'new' ? null : productDialog}
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

const cardSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  p: 1.5,
  borderBottom: '1px solid',
  borderColor: 'divider',
  '&:last-of-type': { borderBottom: 'none' },
}

function ProductActions({ product, onEdit, onArchive }) {
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

ProductActions.propTypes = {
  product: productShape.isRequired,
  onEdit: PropTypes.func.isRequired,
  onArchive: PropTypes.func.isRequired,
}

function ProductsList({ products, onEdit, onArchive }) {
  const isCompact = useCompactLayout()

  if (isCompact) {
    return (
      <Paper variant="outlined" sx={{ mb: 3 }}>
        {products.map((p) => (
          <Box key={p.id} sx={{ ...cardSx, opacity: p.archived_at ? 0.5 : 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" fontWeight={600} noWrap>{p.name}</Typography>
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
              <TableRow key={p.id} sx={p.archived_at ? { opacity: 0.5 } : undefined}>
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

ProductsList.propTypes = {
  products: PropTypes.arrayOf(productShape).isRequired,
  onEdit: PropTypes.func.isRequired,
  onArchive: PropTypes.func.isRequired,
}

function VoidSaleButton({ sale, onVoid }) {
  if (sale.status !== 'recorded') return null
  return (
    <Tooltip title="Void sale">
      <IconButton size="small" onClick={() => onVoid(sale)}>
        <BlockOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}

VoidSaleButton.propTypes = {
  sale: merchSaleShape.isRequired,
  onVoid: PropTypes.func.isRequired,
}

const SALES_PAGE_SIZE = 25

function SalesList({ sales, onVoid }) {
  const isCompact = useCompactLayout()
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(SALES_PAGE_SIZE)

  // Clamp so a shrinking list can't strand the user on an empty page.
  const pageCount = Math.max(0, Math.ceil(sales.length / rowsPerPage) - 1)
  const safePage = Math.min(page, pageCount)
  const paged = sales.slice(safePage * rowsPerPage, (safePage + 1) * rowsPerPage)

  const pagination = sales.length > rowsPerPage && (
    <TablePagination
      component="div"
      count={sales.length}
      page={safePage}
      rowsPerPage={rowsPerPage}
      rowsPerPageOptions={[25, 50, 100]}
      onPageChange={(_, p) => setPage(p)}
      onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0) }}
    />
  )

  if (isCompact) {
    return (
      <Paper variant="outlined">
        {paged.map((s) => (
          <Box key={s.id} sx={{ ...cardSx, opacity: s.status === 'voided' ? 0.5 : 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" fontWeight={600} noWrap>{s.product_name}</Typography>
                {s.status === 'voided' && <Chip label="Voided" size="small" />}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {s.sale_date} · {s.quantity} × {formatEur(s.unit_price_incl_cents)}
              </Typography>
            </Box>
            <Typography variant="body1" fontWeight={500} sx={{ flexShrink: 0 }}>
              {formatEur(s.quantity * s.unit_price_incl_cents)}
            </Typography>
            <VoidSaleButton sale={s} onVoid={onVoid} />
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
              <TableCell>Date</TableCell>
              <TableCell>Product</TableCell>
              <TableCell align="right">Qty</TableCell>
              <MoneyHeaderCells label="Unit price" />
              <MoneyHeaderCells label="Total" />
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paged.map((s) => (
              <TableRow key={s.id} sx={s.status === 'voided' ? { opacity: 0.5 } : undefined}>
                <TableCell>{s.sale_date}</TableCell>
                <TableCell>
                  {s.product_name}
                  {s.status === 'voided' && <Chip label="Voided" size="small" sx={{ ml: 1 }} />}
                </TableCell>
                <TableCell align="right">{s.quantity}</TableCell>
                <MoneyCells cents={s.unit_price_incl_cents} />
                <MoneyCells cents={s.quantity * s.unit_price_incl_cents} />
                <TableCell align="right">
                  <VoidSaleButton sale={s} onVoid={onVoid} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {pagination}
    </Paper>
  )
}

SalesList.propTypes = {
  sales: PropTypes.arrayOf(merchSaleShape).isRequired,
  onVoid: PropTypes.func.isRequired,
}
