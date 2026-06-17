import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import ListSubheader from '@mui/material/ListSubheader'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import Link from '@mui/material/Link'
import { Link as RouterLink } from 'react-router-dom'
import { fetchShopifyOrders, importShopifyOrders } from '../../api/merch.ts'
import { listAccounts } from '../../api/accounts.ts'
import { formatEur } from '../../utils/purchaseTotals.ts'
import type {
  Account, Product, ShopifyOrder, ShopifyLineItem, ShopifyLineMapping, ShopifyImportResult,
} from '../../types/entities.ts'

type Step = 'select' | 'map' | 'importing' | 'done'

const VAT_RATES = [21, 9, 0]

// Human labels for the per-line import statuses the backend returns.
const STATUS_LABELS: Record<string, string> = {
  imported: 'Imported',
  skipped: 'Skipped',
  skipped_duplicate: 'Already imported',
  skipped_insufficient_stock: 'Not enough stock',
  skipped_refunded_line: 'Refunded',
  skipped_invalid_mapping: 'Invalid mapping',
  skipped_invalid_account: 'Invalid account',
  skipped_closed_period: 'Period closed',
  skipped_cancelled: 'Order cancelled',
  skipped_unsupported_currency: 'Unsupported currency',
  skipped_unpaid: 'Order unpaid',
  skipped_not_found: 'Order not found',
  skipped_accounting_not_configured: 'Accounting not configured',
}

const ORDER_SKIP_LABELS: Record<string, string> = {
  skipped_cancelled: 'Cancelled',
  skipped_unsupported_currency: 'Not EUR',
  skipped_unpaid: 'Unpaid',
}

function lineMappable(line: ShopifyLineItem): boolean {
  return !line.skip_reason && !line.already_imported
}

// Turns a Shopify API failure into an actionable message. The backend forwards
// Shopify's own error code/description (e.g. app_not_installed) in the body.
function shopifyErrorMessage(err: unknown, fallback: string): string {
  const body = (err as { body?: { error?: string; code?: string; message?: string } }).body
  switch (body?.code) {
    case 'app_not_installed':
      return "This app isn't installed on your Shopify store yet. Open your Shopify admin and install the app, then try again."
    case 'invalid_client':
      return 'Shopify rejected your app credentials. Check the Client ID and app secret in Settings → Integrations.'
    default:
      break
  }
  if (body?.message) return body.message
  if (body?.error === 'shopify_rate_limited') return 'Shopify is rate-limiting requests. Please wait a moment and try again.'
  return err instanceof Error && err.message ? err.message : fallback
}

// Default each mappable line to a product with a matching name, else skip.
function defaultMapping(line: ShopifyLineItem, products: Product[]): ShopifyLineMapping {
  const match = products.find(
    (p) => !p.archived_at && p.name && p.name.toLowerCase() === line.title.toLowerCase(),
  )
  return match?.id != null ? { type: 'product', product_id: match.id } : { type: 'skip' }
}

interface ShopifyImportDialogProps {
  products: Product[]
  onClose: (imported: boolean) => void
}

export default function ShopifyImportDialog({ products, onClose }: ShopifyImportDialogProps) {
  const [step, setStep] = useState<Step>('select')
  const [orders, setOrders] = useState<ShopifyOrder[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([])
  const [mappings, setMappings] = useState<Record<string, ShopifyLineMapping>>({})
  const [result, setResult] = useState<ShopifyImportResult | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchShopifyOrders({}), listAccounts()])
      .then(([page, accounts]) => {
        if (!active) return
        setOrders(page.orders)
        setNextCursor(page.nextCursor)
        setRevenueAccounts(accounts.filter((a) => a.type === 'revenue' && a.is_active !== false))
      })
      .catch((err: unknown) => {
        if (!active) return
        const body = (err as { body?: { error?: string } }).body
        if (body?.error === 'shopify_not_configured') setNotConfigured(true)
        else setError(shopifyErrorMessage(err, 'Failed to load orders'))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await fetchShopifyOrders({ cursor: nextCursor })
      setOrders((prev) => [...prev, ...page.orders])
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(shopifyErrorMessage(err, 'Failed to load more orders'))
    } finally {
      setLoadingMore(false)
    }
  }

  function toggleOrder(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  const selectedOrders = orders.filter((o) => selected.has(o.id))

  function goToMap() {
    // Seed default mappings for any mappable line not yet decided.
    setMappings((prev) => {
      const next = { ...prev }
      for (const order of selectedOrders) {
        for (const line of order.line_items) {
          if (lineMappable(line) && !next[line.id]) next[line.id] = defaultMapping(line, products)
        }
      }
      return next
    })
    setStep('map')
  }

  function setLineMapping(lineId: string, mapping: ShopifyLineMapping) {
    setMappings((prev) => ({ ...prev, [lineId]: mapping }))
  }

  // value encodes the choice: "product:<id>" | "revenue:<code>" | "skip"
  function mappingValue(m: ShopifyLineMapping | undefined): string {
    if (!m || m.type === 'skip') return 'skip'
    if (m.type === 'product') return `product:${m.product_id}`
    return `revenue:${m.account_code}`
  }

  function onMappingSelect(line: ShopifyLineItem, value: string) {
    if (value === 'skip') return setLineMapping(line.id, { type: 'skip' })
    if (value.startsWith('product:')) {
      return setLineMapping(line.id, { type: 'product', product_id: Number(value.slice(8)) })
    }
    const code = value.slice('revenue:'.length)
    const existing = mappings[line.id]
    const vat = existing?.type === 'revenue' ? existing.vat_rate : 21
    setLineMapping(line.id, { type: 'revenue', account_code: code, vat_rate: vat })
  }

  function importableLines() {
    const out: { shopify_order_id: string; shopify_line_id: string; mapping: ShopifyLineMapping }[] = []
    for (const order of selectedOrders) {
      for (const line of order.line_items) {
        const m = mappings[line.id]
        if (lineMappable(line) && m && m.type !== 'skip') {
          out.push({ shopify_order_id: order.id, shopify_line_id: line.id, mapping: m })
        }
      }
    }
    return out
  }

  const importable = importableLines()

  async function runImport() {
    setStep('importing')
    setError(null)
    // Group selected lines back under their orders for the request body.
    const byOrder = new Map<string, { shopify_line_id: string; mapping: ShopifyLineMapping }[]>()
    for (const l of importable) {
      const arr = byOrder.get(l.shopify_order_id) ?? []
      arr.push({ shopify_line_id: l.shopify_line_id, mapping: l.mapping })
      byOrder.set(l.shopify_order_id, arr)
    }
    const body = { orders: [...byOrder.entries()].map(([id, lines]) => ({ shopify_order_id: id, lines })) }
    try {
      setResult(await importShopifyOrders(body))
      setStep('done')
    } catch (err) {
      setError(shopifyErrorMessage(err, 'Import failed'))
      setStep('map')
    }
  }

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>Import orders from Shopify</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}

        {!loading && notConfigured && (
          <Alert severity="info">
            Shopify isn&apos;t connected yet. Add your API key and store domain in{' '}
            <Link component={RouterLink} to="/settings">Settings → Integrations</Link> first.
          </Alert>
        )}

        {!loading && !notConfigured && step === 'select' && (
          <SelectStep
            orders={orders}
            selected={selected}
            onToggle={toggleOrder}
            nextCursor={nextCursor}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
        )}

        {step === 'map' && (
          <MapStep
            orders={selectedOrders}
            products={products}
            revenueAccounts={revenueAccounts}
            mappings={mappings}
            mappingValue={mappingValue}
            onMappingSelect={onMappingSelect}
            onVatChange={(lineId, code, vat) => setLineMapping(lineId, { type: 'revenue', account_code: code, vat_rate: vat })}
          />
        )}

        {step === 'importing' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}

        {step === 'done' && result && <DoneStep result={result} />}
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose(!!result)}>{result ? 'Close' : 'Cancel'}</Button>
        {step === 'select' && !notConfigured && (
          <Button variant="contained" disabled={!selected.size} onClick={goToMap}>
            Next ({selected.size})
          </Button>
        )}
        {step === 'map' && (
          <>
            <Button onClick={() => setStep('select')}>Back</Button>
            <Button variant="contained" disabled={!importable.length} onClick={runImport}>
              Import {importable.length} line{importable.length === 1 ? '' : 's'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}

interface SelectStepProps {
  orders: ShopifyOrder[]
  selected: Set<string>
  onToggle: (id: string) => void
  nextCursor: string | null
  loadingMore: boolean
  onLoadMore: () => void
}

function SelectStep({ orders, selected, onToggle, nextCursor, loadingMore, onLoadMore }: SelectStepProps) {
  if (!orders.length) {
    return <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No recent orders found.</Typography>
  }
  return (
    <>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ '& th': { fontWeight: 600 } }}>
            <TableCell padding="checkbox" />
            <TableCell>Order</TableCell>
            <TableCell>Date</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Lines</TableCell>
            <TableCell align="right">Total</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {orders.map((o) => {
            const disabled = !!o.skip_reason || o.fully_imported
            return (
              <TableRow key={o.id} hover selected={selected.has(o.id)}>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selected.has(o.id)}
                    disabled={disabled}
                    onChange={() => onToggle(o.id)}
                  />
                </TableCell>
                <TableCell>{o.name}</TableCell>
                <TableCell>{o.created_at?.slice(0, 10)}</TableCell>
                <TableCell>
                  {o.skip_reason
                    ? <Chip size="small" color="default" label={ORDER_SKIP_LABELS[o.skip_reason] ?? o.skip_reason} />
                    : o.fully_imported
                      ? <Chip size="small" color="success" label="Imported" />
                      : <Chip size="small" variant="outlined" label={o.financial_status} />}
                </TableCell>
                <TableCell align="right">{o.line_items.length}</TableCell>
                <TableCell align="right">{formatEur(o.total_incl_cents)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {nextCursor && (
        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Button onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load older orders'}
          </Button>
        </Box>
      )}
    </>
  )
}

interface MapStepProps {
  orders: ShopifyOrder[]
  products: Product[]
  revenueAccounts: Account[]
  mappings: Record<string, ShopifyLineMapping>
  mappingValue: (m: ShopifyLineMapping | undefined) => string
  onMappingSelect: (line: ShopifyLineItem, value: string) => void
  onVatChange: (lineId: string, code: string, vat: number) => void
}

function MapStep({ orders, products, revenueAccounts, mappings, mappingValue, onMappingSelect, onVatChange }: MapStepProps) {
  const activeProducts = products.filter((p) => !p.archived_at)
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Map each line to a product (revenue uses the product&apos;s account and adjusts stock) or to a
        revenue account, or skip it. Already-imported and refunded lines are locked.
      </Typography>
      {orders.map((order) => (
        <Box key={order.id} sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {order.name} · {order.created_at?.slice(0, 10)}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                <TableCell>Item</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell>Map to</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {order.line_items.map((line) => {
                const locked = !lineMappable(line)
                const mapping = mappings[line.id]
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      {line.title}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {line.current_quantity} × €{line.price}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{line.current_quantity}</TableCell>
                    <TableCell>
                      {locked ? (
                        <Chip
                          size="small"
                          label={line.already_imported ? 'Imported' : 'Refunded'}
                          color={line.already_imported ? 'success' : 'default'}
                        />
                      ) : (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <FormControl size="small" sx={{ minWidth: 200 }}>
                            <Select
                              value={mappingValue(mapping)}
                              onChange={(e) => onMappingSelect(line, e.target.value)}
                            >
                              <MenuItem value="skip">Skip</MenuItem>
                              {activeProducts.length > 0 && <ListSubheader>Products</ListSubheader>}
                              {activeProducts.map((p) => (
                                <MenuItem key={String(p.id)} value={`product:${p.id}`}>{p.name}</MenuItem>
                              ))}
                              {revenueAccounts.length > 0 && <ListSubheader>Revenue accounts</ListSubheader>}
                              {revenueAccounts.map((a) => (
                                <MenuItem key={String(a.code)} value={`revenue:${a.code}`}>
                                  {a.code} — {a.name}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          {mapping?.type === 'revenue' && (
                            <FormControl size="small" sx={{ minWidth: 90 }}>
                              <InputLabel>VAT</InputLabel>
                              <Select
                                label="VAT"
                                value={mapping.vat_rate}
                                onChange={(e) => onVatChange(line.id, mapping.account_code, Number(e.target.value))}
                              >
                                {VAT_RATES.map((r) => <MenuItem key={r} value={r}>{r}%</MenuItem>)}
                              </Select>
                            </FormControl>
                          )}
                        </Box>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Box>
      ))}
    </>
  )
}

function DoneStep({ result }: { result: ShopifyImportResult }) {
  const skippedReasons = result.results.filter((r) => r.status !== 'imported')
  return (
    <>
      <Alert severity="success" sx={{ mb: 2 }}>
        Imported {result.imported} line{result.imported === 1 ? '' : 's'}
        {result.skipped > 0 ? `, skipped ${result.skipped}` : ''}.
      </Alert>
      {skippedReasons.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 600 } }}>
              <TableCell>Line</TableCell>
              <TableCell>Reason</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {skippedReasons.map((r) => (
              <TableRow key={r.shopify_line_id}>
                <TableCell>{r.shopify_line_id}</TableCell>
                <TableCell>{STATUS_LABELS[r.status] ?? r.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}
