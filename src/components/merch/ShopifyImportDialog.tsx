import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
import Paper from '@mui/material/Paper'
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
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { formatEur } from '../../utils/purchaseTotals.ts'
import type {
  Account, Product, ShopifyOrder, ShopifyLineItem, ShopifyLineMapping, ShopifyImportResult,
} from '../../types/entities.ts'

type Step = 'select' | 'map' | 'importing' | 'done'

const VAT_RATES = [21, 9, 0]

// The per-line import status keys the backend returns; their human labels live
// under shopify.lineStatus in the merch namespace.
const LINE_STATUS_KEYS = [
  'imported', 'skipped', 'skipped_duplicate', 'skipped_insufficient_stock',
  'skipped_refunded_line', 'skipped_invalid_mapping', 'skipped_invalid_account',
  'skipped_closed_period', 'skipped_cancelled', 'skipped_unsupported_currency',
  'skipped_unpaid', 'skipped_not_found', 'skipped_accounting_not_configured',
] as const

const ORDER_SKIP_KEYS = ['skipped_cancelled', 'skipped_unsupported_currency', 'skipped_unpaid'] as const

// Multi-row card shell for the compact (mobile) layout, matching the merch list cards.
const cardSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.5,
  p: 1.5,
  borderBottom: '1px solid',
  borderColor: 'divider',
  '&:last-of-type': { borderBottom: 'none' },
}

function lineMappable(line: ShopifyLineItem): boolean {
  return !line.skip_reason && !line.already_imported
}

// Maps a backend per-line status code to its localized label, falling back to
// the raw code for anything not in the known set.
function useLineStatusLabel(): (status: string) => string {
  const { t } = useTranslation('merch')
  return (status) => {
    const key = (LINE_STATUS_KEYS as readonly string[]).includes(status)
      ? (status as typeof LINE_STATUS_KEYS[number])
      : null
    return key ? t($ => $.shopify.lineStatus[key]) : status
  }
}

function useOrderSkipLabel(): (reason: string) => string {
  const { t } = useTranslation('merch')
  return (reason) => {
    const key = (ORDER_SKIP_KEYS as readonly string[]).includes(reason)
      ? (reason as typeof ORDER_SKIP_KEYS[number])
      : null
    return key ? t($ => $.shopify.orderSkip[key]) : reason
  }
}

// Turns a Shopify API failure into an actionable, localized message. The backend
// forwards Shopify's own error code/description (e.g. app_not_installed) in the body.
function useShopifyErrorMessage(): (err: unknown, fallback: string) => string {
  const { t } = useTranslation('merch')
  return (err, fallback) => {
    const body = (err as { body?: { error?: string; code?: string; message?: string } }).body
    switch (body?.code) {
      case 'app_not_installed':
        return t($ => $.shopify.errors.appNotInstalled)
      case 'invalid_client':
        return t($ => $.shopify.errors.invalidClient)
      default:
        break
    }
    if (body?.message) return body.message
    if (body?.error === 'shopify_rate_limited') return t($ => $.shopify.errors.rateLimited)
    return err instanceof Error && err.message ? err.message : fallback
  }
}

// The status pill shown for an order in both the table and the compact card.
function OrderStatusChip({ order }: { order: ShopifyOrder }) {
  const { t } = useTranslation('merch')
  const orderSkipLabel = useOrderSkipLabel()
  if (order.skip_reason) {
    return <Chip size="small" color="default" label={orderSkipLabel(order.skip_reason)} />
  }
  if (order.fully_imported) return <Chip size="small" color="success" label={t($ => $.shopify.imported)} />
  return <Chip size="small" variant="outlined" label={order.financial_status} />
}

// Default each mappable line to a product with a matching name, else skip.
function defaultMapping(line: ShopifyLineItem, products: Product[]): ShopifyLineMapping {
  const match = products.find(
    (p) => !p.archived_at && p.name?.toLowerCase() === line.title.toLowerCase(),
  )
  return match?.id != null ? { type: 'product', product_id: match.id } : { type: 'skip' }
}

interface ShopifyImportDialogProps {
  products: Product[]
  onClose: (imported: boolean) => void
}

export default function ShopifyImportDialog({ products, onClose }: ShopifyImportDialogProps) {
  const { t } = useTranslation(['merch', 'common'])
  const shopifyErrorMessage = useShopifyErrorMessage()
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
        else setError(shopifyErrorMessage(err, t($ => $.shopify.errors.loadOrders)))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await fetchShopifyOrders({ cursor: nextCursor })
      setOrders((prev) => [...prev, ...page.orders])
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(shopifyErrorMessage(err, t($ => $.shopify.errors.loadMoreOrders)))
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
      setError(shopifyErrorMessage(err, t($ => $.shopify.errors.importFailed)))
      setStep('map')
    }
  }

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>{t($ => $.shopify.title)}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}

        {!loading && notConfigured && (
          <Alert severity="info">
            <Trans
              t={t}
              i18nKey={$ => $.shopify.notConnected}
              components={{ settingsLink: <Link component={RouterLink} to="/settings" /> }}
            />
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
        <Button onClick={() => onClose(!!result)}>
          {result ? t($ => $.common.actions.close) : t($ => $.common.actions.cancel)}
        </Button>
        {step === 'select' && !notConfigured && (
          <Button variant="contained" disabled={!selected.size} onClick={goToMap}>
            {t($ => $.shopify.next, { count: selected.size })}
          </Button>
        )}
        {step === 'map' && (
          <>
            <Button onClick={() => setStep('select')}>{t($ => $.common.actions.back)}</Button>
            <Button variant="contained" disabled={!importable.length} onClick={runImport}>
              {t($ => $.shopify.importLines, { count: importable.length })}
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
  const { t } = useTranslation(['merch', 'common'])
  const isCompact = useCompactLayout()

  if (!orders.length) {
    return <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>{t($ => $.shopify.noOrders)}</Typography>
  }

  const loadMore = nextCursor && (
    <Box sx={{ textAlign: 'center', mt: 2 }}>
      <Button onClick={onLoadMore} disabled={loadingMore}>
        {loadingMore ? t($ => $.common.state.loading) : t($ => $.shopify.loadMore)}
      </Button>
    </Box>
  )

  if (isCompact) {
    return (
      <>
        <Paper variant="outlined">
          {orders.map((o) => {
            const disabled = !!o.skip_reason || o.fully_imported
            const lines = o.line_items.length
            return (
              <Box key={o.id} component="label" sx={{ ...cardSx, cursor: disabled ? 'default' : 'pointer' }}>
                <Checkbox
                  sx={{ flexShrink: 0 }}
                  checked={selected.has(o.id)}
                  disabled={disabled}
                  onChange={() => onToggle(o.id)}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.name}
                    </Typography>
                    <OrderStatusChip order={o} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {o.created_at?.slice(0, 10)} · {t($ => $.shopify.lineCount, { count: lines })} · {formatEur(o.total_incl_cents)}
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </Paper>
        {loadMore}
      </>
    )
  }

  return (
    <>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ '& th': { fontWeight: 600 } }}>
            <TableCell padding="checkbox" />
            <TableCell>{t($ => $.shopify.table.order)}</TableCell>
            <TableCell>{t($ => $.shopify.table.date)}</TableCell>
            <TableCell>{t($ => $.shopify.table.status)}</TableCell>
            <TableCell align="right">{t($ => $.shopify.table.lines)}</TableCell>
            <TableCell align="right">{t($ => $.shopify.table.total)}</TableCell>
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
                <TableCell><OrderStatusChip order={o} /></TableCell>
                <TableCell align="right">{o.line_items.length}</TableCell>
                <TableCell align="right">{formatEur(o.total_incl_cents)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {loadMore}
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

interface LineMapControlProps {
  line: ShopifyLineItem
  mapping: ShopifyLineMapping | undefined
  activeProducts: Product[]
  revenueAccounts: Account[]
  mappingValue: (m: ShopifyLineMapping | undefined) => string
  onMappingSelect: (line: ShopifyLineItem, value: string) => void
  onVatChange: (lineId: string, code: string, vat: number) => void
  compact?: boolean
}

// The "Map to" control for a single line — locked chip, or a product/revenue
// select with an optional VAT picker. Shared by the table and the compact cards.
function LineMapControl({
  line, mapping, activeProducts, revenueAccounts, mappingValue, onMappingSelect, onVatChange, compact = false,
}: LineMapControlProps) {
  const { t } = useTranslation('merch')
  if (!lineMappable(line)) {
    return (
      <Chip
        size="small"
        label={line.already_imported ? t($ => $.shopify.imported) : t($ => $.shopify.refunded)}
        color={line.already_imported ? 'success' : 'default'}
      />
    )
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: compact ? 'column' : 'row', gap: 1, alignItems: compact ? 'stretch' : 'center' }}>
      <FormControl size="small" sx={compact ? { width: '100%' } : { minWidth: 200 }}>
        <Select
          value={mappingValue(mapping)}
          onChange={(e) => onMappingSelect(line, e.target.value)}
        >
          <MenuItem value="skip">{t($ => $.shopify.skip)}</MenuItem>
          {activeProducts.length > 0 && <ListSubheader>{t($ => $.shopify.productsGroup)}</ListSubheader>}
          {activeProducts.map((p) => (
            <MenuItem key={String(p.id)} value={`product:${p.id}`}>{p.name}</MenuItem>
          ))}
          {revenueAccounts.length > 0 && <ListSubheader>{t($ => $.shopify.revenueAccountsGroup)}</ListSubheader>}
          {revenueAccounts.map((a) => (
            <MenuItem key={String(a.code)} value={`revenue:${a.code}`}>
              {a.code} — {a.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {mapping?.type === 'revenue' && (
        <FormControl size="small" sx={compact ? { alignSelf: 'flex-start', minWidth: 120 } : { minWidth: 90 }}>
          <InputLabel>{t($ => $.shopify.vat)}</InputLabel>
          <Select
            label={t($ => $.shopify.vat)}
            value={mapping.vat_rate}
            onChange={(e) => onVatChange(line.id, mapping.account_code, Number(e.target.value))}
          >
            {VAT_RATES.map((r) => <MenuItem key={r} value={r}>{r}%</MenuItem>)}
          </Select>
        </FormControl>
      )}
    </Box>
  )
}

function MapStep({ orders, products, revenueAccounts, mappings, mappingValue, onMappingSelect, onVatChange }: MapStepProps) {
  const { t } = useTranslation('merch')
  const isCompact = useCompactLayout()
  const activeProducts = products.filter((p) => !p.archived_at)

  const controlProps = { activeProducts, revenueAccounts, mappingValue, onMappingSelect, onVatChange }

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t($ => $.shopify.mapIntro)}
      </Typography>
      {orders.map((order) => (
        <Box key={order.id} sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {order.name} · {order.created_at?.slice(0, 10)}
          </Typography>
          {isCompact ? (
            <Paper variant="outlined">
              {order.line_items.map((line) => (
                <Box key={line.id} sx={{ ...cardSx, flexDirection: 'column', alignItems: 'stretch' }}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{line.title}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {line.current_quantity} × €{line.price}
                    </Typography>
                  </Box>
                  <LineMapControl line={line} mapping={mappings[line.id]} compact {...controlProps} />
                </Box>
              ))}
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                    <TableCell>{t($ => $.shopify.mapTable.item)}</TableCell>
                    <TableCell align="right">{t($ => $.shopify.mapTable.qty)}</TableCell>
                    <TableCell>{t($ => $.shopify.mapTable.mapTo)}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {order.line_items.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        {line.title}
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {line.current_quantity} × €{line.price}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{line.current_quantity}</TableCell>
                      <TableCell>
                        <LineMapControl line={line} mapping={mappings[line.id]} {...controlProps} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )}
        </Box>
      ))}
    </>
  )
}

function DoneStep({ result }: { result: ShopifyImportResult }) {
  const { t } = useTranslation('merch')
  const lineStatusLabel = useLineStatusLabel()
  const isCompact = useCompactLayout()
  const skippedReasons = result.results.filter((r) => r.status !== 'imported')
  return (
    <>
      <Alert severity="success" sx={{ mb: 2 }}>
        {result.skipped > 0
          ? t($ => $.shopify.done.importedWithSkipped, { count: result.imported, skipped: result.skipped })
          : t($ => $.shopify.done.importedOnly, { count: result.imported })}
      </Alert>
      {skippedReasons.length > 0 && (
        isCompact ? (
          <Paper variant="outlined">
            {skippedReasons.map((r) => (
              <Box key={r.shopify_line_id} sx={{ ...cardSx, justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.shopify_line_id}
                </Typography>
                <Chip size="small" variant="outlined" label={lineStatusLabel(r.status)} sx={{ flexShrink: 0 }} />
              </Box>
            ))}
          </Paper>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                <TableCell>{t($ => $.shopify.done.line)}</TableCell>
                <TableCell>{t($ => $.shopify.done.reason)}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {skippedReasons.map((r) => (
                <TableRow key={r.shopify_line_id}>
                  <TableCell>{r.shopify_line_id}</TableCell>
                  <TableCell>{lineStatusLabel(r.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      )}
    </>
  )
}
