import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Grid from '@mui/material/Grid'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { formatEur } from '../../../../../finance/invoices/invoiceTotals.ts'
import { computeArtistStatement } from '../../../dealTerms.ts'
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

  const feeBreakdown = terms.deal_type === 'door_deal'
    ? t($ => $.detail.deal.statement.breakdown.grossFeeDoorDeal)
    : t($ => $.detail.deal.statement.breakdown.grossFee)

  const agencyBreakdown = (() => {
    if (terms.agency_fee_basis === 'percentage') {
      return t($ => $.detail.deal.statement.breakdown.percentageOfGross, {
        percentage: terms.agency_fee_percentage,
        base: formatEur(statement.grossFeeCents),
      })
    }
    if (terms.agency_fee_basis === 'amount') return t($ => $.detail.deal.statement.breakdown.fixedAmount)
    return t($ => $.detail.deal.statement.breakdown.notAgreed)
  })()

  const commissionBreakdown = (() => {
    if (terms.commission_basis === 'percentage') {
      return t($ => $.detail.deal.statement.breakdown.percentageOfNett, {
        percentage: terms.commission_percentage,
        base: formatEur(statement.nettFeeCents),
      })
    }
    if (terms.commission_basis === 'amount') return t($ => $.detail.deal.statement.breakdown.fixedAmount)
    return t($ => $.detail.deal.statement.breakdown.notAgreed)
  })()

  const artistBreakdown = terms.agency_fee_mode === 'inclusive' && terms.agency_fee_basis !== 'none'
    ? t($ => $.detail.deal.statement.breakdown.dueToArtistInclusive)
    : t($ => $.detail.deal.statement.breakdown.dueToArtistExclusive)

  return (
    <Grid size={12} data-testid="artist-statement">
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1, mb: 1 }}>
        {t($ => $.detail.deal.statement.title)}
      </Typography>

      {/* One collapsed grid: the fee build-up on the first row, the split of it
          on the second. The negative margins push the trailing hairlines under
          the wrapper's own border, which the overflow then clips. */}
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <Grid container spacing={0} columns={{ xs: 2, sm: 4 }} sx={{ mr: '-1px', mb: '-1px' }}>
          <StatementCell
            label={t($ => $.detail.deal.statement.grossFee)}
            amountCents={statement.grossFeeCents}
            breakdown={feeBreakdown}
          />
          <StatementCell
            label={t($ => $.detail.deal.statement.costs)}
            amountCents={statement.costsCents}
            breakdown={t($ => $.detail.deal.statement.breakdown.costs, { count: costLineCount })}
          />
          <StatementCell
            span={2}
            label={t($ => $.detail.deal.statement.nettFee)}
            amountCents={statement.nettFeeCents}
            breakdown={t($ => $.detail.deal.statement.breakdown.nettFee, {
              gross: formatEur(statement.grossFeeCents),
              costs: formatEur(statement.costsCents),
            })}
          />

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
            breakdown={t($ => $.detail.deal.statement.breakdown.dueToBooker, {
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
