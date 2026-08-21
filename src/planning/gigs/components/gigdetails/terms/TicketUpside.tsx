import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Grid from '@mui/material/Grid'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { formatEur } from '../../../../../finance/invoices/invoiceTotals.ts'
import { computeTicketUpside, dealTypeHasTicketShare } from '../../../dealTerms.ts'
import type { GigDealTerms, TicketScenario } from '../../../dealTerms.ts'

interface Props {
  terms: GigDealTerms
}

interface TileProps {
  label: string
  value: string
  caption?: string
  breakdown: string
  emphasis?: boolean
  span?: number
}

function UpsideTile({ label, value, caption, breakdown, emphasis = false, span = 1 }: Readonly<TileProps>) {
  return (
    <Grid size={span}>
      {/* describeChild keeps the tile's label and value as its accessible name;
          the breakdown becomes its description instead of replacing it. */}
      <Tooltip title={breakdown} arrow describeChild>
        <Card
          variant="outlined"
          tabIndex={0}
          sx={{
            p: 1.5,
            height: '100%',
            cursor: 'help',
            borderRadius: 0,
            // Only the trailing edges are drawn, so neighbours share a single
            // hairline instead of stacking two; the wrapper clips the outermost
            // pair away.
            borderWidth: '0 1px 1px 0',
            borderColor: 'divider',
            bgcolor: emphasis ? 'action.hover' : undefined,
          }}
        >
          <Stack spacing={0.25}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
            <Typography
              variant="h6"
              sx={{ lineHeight: 1.2, fontWeight: emphasis ? 700 : 500, color: emphasis ? 'primary.main' : undefined }}
            >
              {value}
            </Typography>
            {caption && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{caption}</Typography>}
          </Stack>
        </Card>
      </Tooltip>
    </Grid>
  )
}

// What the door adds on top of the fee: what has been sold, what it takes to
// break even, and the share at expected and full attendance.
export default function TicketUpside({ terms }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const upside = computeTicketUpside(terms)
  const unknown = t($ => $.detail.deal.tickets.unknown)

  const scenarioValue = (scenario: TicketScenario | null) =>
    scenario === null ? unknown : formatEur(scenario.artistShareCents)

  const scenarioCaption = (scenario: TicketScenario | null) =>
    scenario === null ? undefined : t($ => $.detail.deal.tickets.atAttendance, { count: scenario.tickets })

  const soldValue = upside.sold === null
    ? unknown
    : t($ => $.detail.deal.tickets.soldOfCapacity, {
        sold: upside.sold.tickets,
        capacity: upside.potential === null ? '?' : upside.potential.tickets,
      })

  // The per-ticket price after VAT and copyright, next to what has actually
  // been earned from the tickets sold so far — folded into one caption rather
  // than spelled out as separate paragraphs below the grid.
  const soldCaption = t($ => $.detail.deal.tickets.soldCaption, {
    price: formatEur(upside.ticketPriceAfterCopyrightCents),
    revenue: upside.sold === null ? unknown : formatEur(upside.sold.artistShareCents),
  })

  // The VAT/copyright corrections behind that price, kept as a short aside
  // in the tile's tooltip rather than their own paragraphs below the grid.
  const soldBreakdown = [
    t($ => $.detail.deal.tickets.breakdown.sold),
    upside.ticketVatPercentage > 0
      ? t($ => $.detail.deal.tickets.breakdown.soldVat, { percentage: upside.ticketVatPercentage })
      : null,
    upside.copyrightPercentage > 0
      ? t($ => $.detail.deal.tickets.breakdown.soldCopyright, { percentage: upside.copyrightPercentage })
      : null,
  ].filter(Boolean).join(' ')

  if (!dealTypeHasTicketShare(terms.deal_type)) {
    return (
      <Grid size={12} data-testid="ticket-upside">
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1, mb: 1 }}>
          {t($ => $.detail.deal.tickets.title)}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t($ => $.detail.deal.tickets.flatFeeNote)}
        </Typography>
      </Grid>
    )
  }

  const guaranteeVariant = terms.guarantee_variant
  const breakEvenBreakdown = guaranteeVariant === null
    ? t($ => $.detail.deal.tickets.breakdown[terms.deal_type])
    : t($ => $.detail.deal.tickets.breakdown.guaranteeVariants[guaranteeVariant])

  return (
    <Grid size={12} data-testid="ticket-upside">
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1, mb: 1 }}>
        {t($ => $.detail.deal.tickets.title)}
      </Typography>

      {/* One collapsed grid, matching the statement above it. The negative
          margins push the trailing hairlines under the wrapper's own border,
          which the overflow then clips. */}
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <Grid container spacing={0} columns={{ xs: 2, sm: 4 }} sx={{ mr: '-1px', mb: '-1px' }}>
          <UpsideTile
            label={t($ => $.detail.deal.tickets.sold)}
            value={soldValue}
            caption={soldCaption}
            breakdown={soldBreakdown}
          />
          <UpsideTile
            label={t($ => $.detail.deal.tickets.toBreakEven)}
            value={upside.breakEvenTickets === null ? unknown : String(upside.breakEvenTickets)}
            caption={upside.breakEvenCents === null ? undefined : formatEur(upside.breakEvenCents)}
            breakdown={breakEvenBreakdown}
          />
          <UpsideTile
            label={t($ => $.detail.deal.tickets.expectedUpside)}
            value={scenarioValue(upside.expected)}
            caption={scenarioCaption(upside.expected)}
            breakdown={t($ => $.detail.deal.tickets.breakdown.expected, { percentage: upside.artistPercentage.toFixed(1) })}
          />
          <UpsideTile
            emphasis
            label={t($ => $.detail.deal.tickets.potentialUpside)}
            value={scenarioValue(upside.potential)}
            caption={scenarioCaption(upside.potential)}
            breakdown={t($ => $.detail.deal.tickets.breakdown.potential, { percentage: upside.artistPercentage.toFixed(1) })}
          />
        </Grid>
      </Box>
    </Grid>
  )
}
