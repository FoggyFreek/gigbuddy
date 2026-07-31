import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { formatCurrency } from '../../utils/invoiceTotals.ts'
import type { VatReturnBox, VatReturnBoxValue } from '../../types/entities.ts'

const GRID_COLUMNS = '44px minmax(0, 1fr) 112px 112px'
const AMOUNT_SX = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}

interface Props {
  boxes: VatReturnBox[] | Record<string, VatReturnBoxValue>
  currency: string
}

export default function VatBoxesTable({ boxes, currency }: Readonly<Props>) {
  const { t } = useTranslation('vatReturns')
  const rows: VatReturnBox[] = Array.isArray(boxes)
    ? boxes
    : Object.entries(boxes).map(([box_code, value]) => ({ box_code, ...value }))

  return (
    <>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{t($ => $.workpaper.boxesTitle)}</Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: 420 }}>
          <Box
            data-testid="vat-box-column-headers"
            sx={{
              display: 'grid',
              gridTemplateColumns: GRID_COLUMNS,
              gap: 1,
              pb: 0.5,
              color: 'text.secondary',
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 600 }}>{t($ => $.workpaper.boxColumns.box)}</Typography>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>{t($ => $.workpaper.boxColumns.description)}</Typography>
            <Typography variant="caption" sx={{ ...AMOUNT_SX, fontWeight: 600 }}>{t($ => $.workpaper.boxColumns.turnover)}</Typography>
            <Typography variant="caption" sx={{ ...AMOUNT_SX, fontWeight: 600 }}>{t($ => $.workpaper.boxColumns.vat)}</Typography>
          </Box>
          {rows.map((box, index) => {
            const section = box.section
            const showSection = section?.id !== rows[index - 1]?.section?.id
            return (
              <Fragment key={box.box_code}>
                {section && showSection && (
                  <Box
                    data-testid={`vat-box-section-${section.id}`}
                    sx={{ mt: index === 0 ? 0.5 : 1.5, px: 1, py: 0.75, bgcolor: 'action.hover', borderRadius: 1 }}
                  >
                    <Typography component="h3" variant="subtitle2">{section.title}</Typography>
                  </Box>
                )}
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: GRID_COLUMNS,
                    gap: 1,
                    py: 0.5,
                    alignItems: 'baseline',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{box.box_code}</Typography>
                  <Typography variant="body2">{box.description || '—'}</Typography>
                  <Typography variant="body2" sx={AMOUNT_SX}>
                    {box.base_declared_euros == null
                      ? '—'
                      : formatCurrency(box.base_declared_euros * 100, currency)}
                  </Typography>
                  <Typography variant="body2" sx={AMOUNT_SX}>
                    {box.vat_declared_euros == null
                      ? '—'
                      : formatCurrency(box.vat_declared_euros * 100, currency)}
                  </Typography>
                </Box>
              </Fragment>
            )
          })}
        </Box>
      </Box>
    </>
  )
}
