import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'
import type { ShopifyOrder } from '../../../../types/entities.ts'
import { formatEur } from '../../../../finance/purchases/purchaseTotals.ts'
import { shopifyImportCardSx } from './styles.ts'

const ORDER_SKIP_KEYS = [
  'skipped_cancelled', 'skipped_unsupported_currency', 'skipped_unpaid',
  'skipped_incomplete_order', 'skipped_payment_pending', 'skipped_payment_mismatch',
  'skipped_test_order', 'skipped_legacy_partial_import', 'skipped_unsupported_payment_gateway',
] as const

interface Props {
  orders: ShopifyOrder[]
  selected: Set<string>
  onToggle: (id: string) => void
  nextCursor: string | null
  loadingMore: boolean
  onLoadMore: () => void
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

function OrderStatusChip({ order }: Readonly<{ order: ShopifyOrder }>) {
  const { t } = useTranslation('merch')
  const orderSkipLabel = useOrderSkipLabel()
  if (order.skip_reason) {
    return <Chip size="small" color="default" label={orderSkipLabel(order.skip_reason)} />
  }
  if (order.fully_imported) {
    return <Chip size="small" color="success" label={t($ => $.shopify.imported)} />
  }
  return <Chip size="small" variant="outlined" label={order.financial_status} />
}

export function ShopifyOrderSelectStep({
  orders,
  selected,
  onToggle,
  nextCursor,
  loadingMore,
  onLoadMore,
}: Readonly<Props>) {
  const { t } = useTranslation(['merch', 'common'])
  const isCompact = useCompactLayout()

  if (!orders.length) {
    return (
      <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
        {t($ => $.shopify.noOrders)}
      </Typography>
    )
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
          {orders.map((order) => {
            const disabled = !!order.skip_reason || order.fully_imported
            return (
              <Box
                key={order.id}
                component="label"
                sx={{ ...shopifyImportCardSx, cursor: disabled ? 'default' : 'pointer' }}
              >
                <Checkbox
                  sx={{ flexShrink: 0 }}
                  checked={selected.has(order.id)}
                  disabled={disabled}
                  onChange={() => onToggle(order.id)}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {order.name}
                    </Typography>
                    <OrderStatusChip order={order} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {order.created_at?.slice(0, 10)} · {t($ => $.shopify.lineCount, { count: order.line_items.length })} · {formatEur(order.total_incl_cents)}
                    {order.payment?.payment_gateway === 'paypal'
                      ? <>{' · '}{t($ => $.shopify.paypalFeesPending)}</>
                      : order.payment?.fee_cents != null && order.payment.net_cents != null
                        ? <>{' · '}{t($ => $.shopify.paymentSummary, { fee: formatEur(order.payment.fee_cents), net: formatEur(order.payment.net_cents) })}</>
                        : null}
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
          {orders.map((order) => {
            const disabled = !!order.skip_reason || order.fully_imported
            return (
              <TableRow key={order.id} hover selected={selected.has(order.id)}>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selected.has(order.id)}
                    disabled={disabled}
                    onChange={() => onToggle(order.id)}
                  />
                </TableCell>
                <TableCell>{order.name}</TableCell>
                <TableCell>{order.created_at?.slice(0, 10)}</TableCell>
                <TableCell><OrderStatusChip order={order} /></TableCell>
                <TableCell align="right">{order.line_items.length}</TableCell>
                <TableCell align="right">{formatEur(order.total_incl_cents)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {loadMore}
    </>
  )
}
