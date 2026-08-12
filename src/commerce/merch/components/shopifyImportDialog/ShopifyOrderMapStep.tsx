import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'
import type {
  Account,
  Product,
  ShopifyExtraComponent,
  ShopifyLineItem,
  ShopifyLineMapping,
  ShopifyOrder,
} from '../../../../types/entities.ts'
import {
  ShopifyLineMappingControl,
  type ShopifyLineMappingControlProps,
} from './ShopifyLineMappingControl.tsx'
import { shopifyImportCardSx } from './styles.ts'

interface Props {
  orders: ShopifyOrder[]
  products: Product[]
  revenueAccounts: Account[]
  mappings: Record<string, ShopifyLineMapping>
  onMappingSelect: ShopifyLineMappingControlProps['onMappingSelect']
  onVatChange: ShopifyLineMappingControlProps['onVatChange']
  onTaxChange: ShopifyLineMappingControlProps['onTaxChange']
}

function extraAsLine(extra: ShopifyExtraComponent): ShopifyLineItem {
  return {
    id: extra.key,
    title: extra.title,
    sku: null,
    quantity: 1,
    current_quantity: 1,
    price: (extra.amount_cents / 100).toFixed(2),
    total_discount: '0.00',
    already_imported: false,
    skip_reason: null,
  }
}

export function ShopifyOrderMapStep({
  orders,
  products,
  revenueAccounts,
  mappings,
  onMappingSelect,
  onVatChange,
  onTaxChange,
}: Readonly<Props>) {
  const { t } = useTranslation('merch')
  const isCompact = useCompactLayout()
  const activeProducts = products.filter((product) => !product.archived_at)
  const controlProps = {
    activeProducts,
    revenueAccounts,
    onMappingSelect,
    onVatChange,
    onTaxChange,
  }

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
                <Box key={line.id} sx={{ ...shopifyImportCardSx, flexDirection: 'column', alignItems: 'stretch' }}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{line.title}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {line.current_quantity} × €{line.price}
                    </Typography>
                  </Box>
                  <ShopifyLineMappingControl line={line} mapping={mappings[line.id]} compact {...controlProps} />
                </Box>
              ))}
              {(order.extra_components ?? []).map((extra) => {
                const line = extraAsLine(extra)
                return (
                  <Box key={extra.key} sx={{ ...shopifyImportCardSx, flexDirection: 'column', alignItems: 'stretch' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{extra.title}</Typography>
                    <ShopifyLineMappingControl
                      line={line}
                      mapping={mappings[extra.key]}
                      compact
                      allowProducts={false}
                      {...controlProps}
                    />
                  </Box>
                )
              })}
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
                        <ShopifyLineMappingControl line={line} mapping={mappings[line.id]} {...controlProps} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {(order.extra_components ?? []).map((extra) => {
                    const line = extraAsLine(extra)
                    return (
                      <TableRow key={extra.key}>
                        <TableCell>{extra.title}</TableCell>
                        <TableCell align="right">1</TableCell>
                        <TableCell>
                          <ShopifyLineMappingControl
                            line={line}
                            mapping={mappings[extra.key]}
                            allowProducts={false}
                            {...controlProps}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Paper>
          )}
        </Box>
      ))}
    </>
  )
}
