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
}

function StatementCell({ label, amountCents, breakdown, emphasis = false }: Readonly<CellProps>) {
  return (
    // describeChild, so the breakdown lands on aria-describedby rather than
    // replacing the card's own name — a screen reader still reads the label and
    // the amount first, then the calculation behind them.
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
          borderColor: emphasis ? 'primary.main' : 'divider',
          bgcolor: emphasis ? 'action.hover' : undefined,
        }}
      >
        <Stack spacing={0.25}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
          <Typography variant="h6" sx={{ lineHeight: 1.2, fontWeight: emphasis ? 700 : 500 }}>
            {formatEur(amountCents)}
          </Typography>
        </Stack>
      </Card>
    </Tooltip>
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

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatementCell
            label={t($ => $.detail.deal.statement.grossFee)}
            amountCents={statement.grossFeeCents}
            breakdown={feeBreakdown}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatementCell
            label={t($ => $.detail.deal.statement.costs)}
            amountCents={statement.costsCents}
            breakdown={t($ => $.detail.deal.statement.breakdown.costs, { count: costLineCount })}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <StatementCell
            label={t($ => $.detail.deal.statement.nettFee)}
            amountCents={statement.nettFeeCents}
            breakdown={t($ => $.detail.deal.statement.breakdown.nettFee, {
              gross: formatEur(statement.grossFeeCents),
              costs: formatEur(statement.costsCents),
            })}
          />
        </Grid>

        <Grid size={{ xs: 6, sm: 3 }}>
          <StatementCell
            label={t($ => $.detail.deal.statement.bookingFee)}
            amountCents={statement.agencyFeeCents}
            breakdown={agencyBreakdown}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatementCell
            label={t($ => $.detail.deal.statement.commission)}
            amountCents={statement.commissionCents}
            breakdown={commissionBreakdown}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatementCell
            label={t($ => $.detail.deal.statement.dueToBooker)}
            amountCents={statement.dueToBookerCents}
            breakdown={t($ => $.detail.deal.statement.breakdown.dueToBooker, {
              bookingFee: formatEur(statement.agencyFeeCents),
              commission: formatEur(statement.commissionCents),
            })}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <StatementCell
            emphasis
            label={t($ => $.detail.deal.statement.dueToArtist)}
            amountCents={statement.dueToArtistCents}
            breakdown={artistBreakdown}
          />
        </Grid>
      </Grid>
    </Grid>
  )
}
