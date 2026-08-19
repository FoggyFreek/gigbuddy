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
}

function UpsideTile({ label, value, caption, breakdown, emphasis = false }: Readonly<TileProps>) {
  return (
    // describeChild keeps the tile's label and value as its accessible name;
    // the breakdown becomes its description instead of replacing it.
    <Tooltip title={breakdown} arrow describeChild>
      <Card
        variant="outlined"
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
          <Typography variant="h6" sx={{ lineHeight: 1.2, fontWeight: emphasis ? 700 : 500 }}>{value}</Typography>
          {caption && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{caption}</Typography>}
        </Stack>
      </Card>
    </Tooltip>
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

  return (
    <Grid size={12} data-testid="ticket-upside">
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 1, mb: 1 }}>
        {t($ => $.detail.deal.tickets.title)}
      </Typography>

      <Grid container spacing={1.5}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <UpsideTile
            label={t($ => $.detail.deal.tickets.sold)}
            value={soldValue}
            breakdown={t($ => $.detail.deal.tickets.breakdown.sold)}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <UpsideTile
            label={t($ => $.detail.deal.tickets.toBreakEven)}
            value={upside.breakEvenTickets === null ? unknown : String(upside.breakEvenTickets)}
            caption={upside.breakEvenCents === null ? undefined : formatEur(upside.breakEvenCents)}
            breakdown={t($ => $.detail.deal.tickets.breakdown[terms.deal_type])}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <UpsideTile
            label={t($ => $.detail.deal.tickets.expectedUpside)}
            value={scenarioValue(upside.expected)}
            caption={scenarioCaption(upside.expected)}
            breakdown={t($ => $.detail.deal.tickets.breakdown.expected, { percentage: upside.artistPercentage })}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <UpsideTile
            emphasis
            label={t($ => $.detail.deal.tickets.potentialUpside)}
            value={scenarioValue(upside.potential)}
            caption={scenarioCaption(upside.potential)}
            breakdown={t($ => $.detail.deal.tickets.breakdown.potential, { percentage: upside.artistPercentage })}
          />
        </Grid>
        <Grid size={12}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.detail.deal.tickets.actualUpside, {
              amount: upside.sold === null ? unknown : formatEur(upside.sold.artistShareCents),
            })}
          </Typography>
        </Grid>
      </Grid>
    </Grid>
  )
}
