import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Grid from '@mui/material/Grid'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { formatEur } from '../../../../../finance/invoices/invoiceTotals.ts'
import { computeArtistStatement, dealTypeHasTicketShare } from '../../../dealTerms.ts'
import type { GigDealTerms } from '../../../dealTerms.ts'

interface Props {
  terms: GigDealTerms
  costLineCount: number
}

interface CellProps {
  label: string
  amountCents: number
  breakdown: string
  emphasis?: boolean
  span?: number
}

function StatementCell({ label, amountCents, breakdown, emphasis = false, span = 1 }: Readonly<CellProps>) {
  return (
    <Grid size={span}>
      {/* describeChild, so the breakdown lands on aria-describedby rather than
          replacing the card's own name — a screen reader still reads the label
          and the amount first, then the calculation behind them. */}
      <Tooltip title={breakdown} arrow describeChild>
        <Card
          variant="outlined"
          // tabIndex so the breakdown is reachable without a pointer — the
          // tooltip is the only place the calculation is spelled out.
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
              {formatEur(amountCents)}
            </Typography>
          </Stack>
        </Card>
      </Tooltip>
    </Grid>
  )
}

// The deal, read back as money. Every figure is derived from the terms as
// typed — nothing here is stored, invoiced or posted.
export default function ArtistStatement({ terms, costLineCount }: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const statement = computeArtistStatement(terms)

  // The door pays on tickets already sold; an empty attendance is not a zero.
  // Ticket revenue has no tile of its own — it is folded into the gross fee,
  // so this sentence hangs off the gross fee's tooltip instead.
  const ticketBreakdown = (() => {
    if (!dealTypeHasTicketShare(terms.deal_type)) {
      return t($ => $.detail.deal.statement.breakdown.ticketRevenueFlatFee)
    }
    if (terms.tickets_sold == null) return t($ => $.detail.deal.statement.breakdown.ticketRevenueUnknown)
    return t($ => $.detail.deal.statement.breakdown.ticketRevenue, {
      count: Number(terms.tickets_sold),
      percentage: (Number(terms.percentage_of_sales) || 0).toFixed(1),
    })
  })()

  const grossFeeBreakdown = [
    t($ => $.detail.deal.statement.breakdown.grossFee, {
      guarantee: formatEur(statement.guaranteedFeeCents),
      tickets: formatEur(statement.ticketRevenueCents),
    }),
    ticketBreakdown,
  ].join(' ')

  const agencyBreakdown = (() => {
    if (terms.agency_fee_basis === 'percentage') {
      return t($ => $.detail.deal.statement.breakdown.percentageOfGross, {
        percentage: terms.agency_fee_percentage,
        base: formatEur(statement.bookingFeeBaseCents),
      })
    }
    if (terms.agency_fee_basis === 'amount') return t($ => $.detail.deal.statement.breakdown.fixedAmount)
    return t($ => $.detail.deal.statement.breakdown.notAgreed)
  })()

  const commissionBreakdown = (() => {
    if (terms.commission_basis === 'percentage') {
      return t($ => $.detail.deal.statement.breakdown.percentageOfNett, {
        percentage: terms.commission_percentage,
        base: formatEur(statement.commissionBaseCents),
      })
    }
    if (terms.commission_basis === 'amount') return t($ => $.detail.deal.statement.breakdown.fixedAmount)
    return t($ => $.detail.deal.statement.breakdown.notAgreed)
  })()

  const artistBreakdown = [
    t($ => $.detail.deal.statement.breakdown.dueToArtistInclusive),
    statement.costsPaidByArtistCents > 0
      ? t($ => $.detail.deal.statement.breakdown.dueToArtistWithCosts, {
        costs: formatEur(statement.costsPaidByArtistCents),
      })
      : null,
  ].filter(Boolean).join(' ')

  return (
    <Grid size={12} data-testid="artist-statement">
      <Typography variant="subtitle2" sx={{ fontWeight: 600,  mb: 1 }}>
        {t($ => $.detail.deal.statement.title)}
      </Typography>

      {/* One collapsed grid: the gross fee (ticket revenue folded into its
          tooltip) taken down to the nett fee via costs on the first row, the
          nett fee split on the second. The negative margins push the
          trailing hairlines under the wrapper's own border, which the
          overflow then clips. */}
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <Grid container spacing={0} columns={{ xs: 1, sm: 3 }} sx={{ mr: '-1px', mb: '-1px' }}>
          <StatementCell
            label={t($ => $.detail.deal.statement.grossFee)}
            breakdown={grossFeeBreakdown}
            amountCents={statement.grossFeeCents}
          />
          <StatementCell
            label={t($ => $.detail.deal.statement.costs)}
            amountCents={statement.costsCents}
            breakdown={t($ => $.detail.deal.statement.breakdown.costs, { count: costLineCount })}
          />
          <StatementCell
            label={t($ => $.detail.deal.statement.nettFee)}
            amountCents={statement.nettFeeCents}
            breakdown={t($ => $.detail.deal.statement.breakdown.nettFee, {
              gross: formatEur(statement.grossFeeCents),
              // What actually reaches the nett fee: only costs paid by
              // artist/agency do. Artist- and agency-only costs are deducted
              // later, when due to artist/due to booker are calculated, so
              // they are not in this figure even though they are in the
              // Costs tile above.
              costs: formatEur(statement.costsPaidByArtistAgencyCents),
            })}
          />
        </Grid>
        <Grid container spacing={0} columns={{ xs: 2, sm: 4 }} sx={{ mr: '-1px', mb: '-1px' }}>
          <StatementCell
            label={t($ => $.detail.deal.statement.bookingFee)}
            amountCents={statement.agencyFeeCents}
            breakdown={agencyBreakdown}
          />
          <StatementCell
            label={t($ => $.detail.deal.statement.commission)}
            amountCents={statement.commissionCents}
            breakdown={commissionBreakdown}
          />
          <StatementCell
            label={t($ => $.detail.deal.statement.dueToBooker)}
            amountCents={statement.dueToBookerCents}
            breakdown={statement.costsPaidByAgencyCents > 0
              ? t($ => $.detail.deal.statement.breakdown.dueToBookerWithCosts, {
                bookingFee: formatEur(statement.agencyFeeCents),
                commission: formatEur(statement.commissionCents),
                costs: formatEur(statement.costsPaidByAgencyCents),
              })
              : t($ => $.detail.deal.statement.breakdown.dueToBooker, {
                bookingFee: formatEur(statement.agencyFeeCents),
                commission: formatEur(statement.commissionCents),
              })}
          />
          <StatementCell
            emphasis
            label={t($ => $.detail.deal.statement.dueToArtist)}
            amountCents={statement.dueToArtistCents}
            breakdown={artistBreakdown}
          />
        </Grid>
      </Box>
    </Grid>
  )
}
