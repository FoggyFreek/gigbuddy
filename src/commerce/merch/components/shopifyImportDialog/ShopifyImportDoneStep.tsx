import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'
import type { ShopifyImportResult } from '../../../../types/entities.ts'
import { formatEur } from '../../../../finance/purchases/purchaseTotals.ts'
import { shopifyImportCardSx } from './styles.ts'

const LINE_STATUS_KEYS = [
  'imported', 'skipped', 'skipped_duplicate', 'skipped_insufficient_stock',
  'skipped_refunded_line', 'skipped_invalid_mapping', 'skipped_invalid_account',
  'skipped_closed_period', 'skipped_cancelled', 'skipped_unsupported_currency',
  'skipped_unpaid', 'skipped_not_found', 'skipped_accounting_not_configured',
  'skipped_incomplete_mapping', 'skipped_order_total_mismatch',
] as const

function useLineStatusLabel(): (status: string) => string {
  const { t } = useTranslation('merch')
  return (status) => {
    const key = (LINE_STATUS_KEYS as readonly string[]).includes(status)
      ? (status as typeof LINE_STATUS_KEYS[number])
      : null
    return key ? t($ => $.shopify.lineStatus[key]) : status
  }
}

export function ShopifyImportDoneStep({ result }: Readonly<{ result: ShopifyImportResult }>) {
  const { t } = useTranslation('merch')
  const lineStatusLabel = useLineStatusLabel()
  const isCompact = useCompactLayout()
  const skippedReasons = result.results.filter((item) => item.status !== 'imported')

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
            {skippedReasons.map((item) => (
              <Box key={item.shopify_order_id} sx={{ ...shopifyImportCardSx, justifyContent: 'space-between' }}>
                <Typography
                  variant="body2"
                  sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {item.shopify_order_id} · {item.net_cents == null ? t($ => $.shopify.paypalFeesPending) : formatEur(item.net_cents)}
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  label={lineStatusLabel(item.status)}
                  sx={{ flexShrink: 0 }}
                />
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
              {skippedReasons.map((item) => (
                <TableRow key={item.shopify_order_id}>
                  <TableCell>
                    {item.shopify_order_id} · {item.net_cents == null ? t($ => $.shopify.paypalFeesPending) : formatEur(item.net_cents)}
                  </TableCell>
                  <TableCell>{lineStatusLabel(item.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      )}
    </>
  )
}
