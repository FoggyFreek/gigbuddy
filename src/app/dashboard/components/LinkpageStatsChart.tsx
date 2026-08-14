import { useTranslation } from 'react-i18next'
import { useTheme } from '@mui/material/styles'
import { BarChart } from '@mui/x-charts/BarChart'
import type { BarItem, BarLabelContext } from '@mui/x-charts/BarChart'
import type { LinkpageClickKind, LinkpageStatsDay } from '../../../promotion/linkpage/linkpage.ts'
import type { ChartPalette } from '../../../theme.ts'

// Stacking order, and the slot each category owns. Colours follow the category
// *identity*, never its rank, so a quiet week can't repaint the series — and
// the slot order is the one the theme validated for adjacent-pair contrast.
const KIND_SLOTS: ReadonlyArray<readonly [LinkpageClickKind, keyof ChartPalette]> = [
  ['platform', 'c1'],
  ['song', 'c2'],
  ['link', 'c3'],
  ['embed', 'c4'],
  ['share', 'c5'],
  ['social', 'c6'],
  ['shop', 'c7'],
  ['other', 'c8'],
]
const KNOWN_KINDS = new Set(KIND_SLOTS.map(([kind]) => kind))

const CHART_HEIGHT = 230
// Roughly how many date ticks fit without colliding in a dashboard-width tile.
const MAX_TICKS = 6

type DatasetRow = { day: string } & Partial<Record<'views' | LinkpageClickKind, number>>

// One flat row per day — a stacked BarChart's dataset can't be nested. Clicks
// arrive keyed by kind; anything unrecognized folds into 'other' so a new kind
// shipped by the link page app still shows up rather than vanishing.
function toDataset(byDay: LinkpageStatsDay[]): DatasetRow[] {
  return byDay.map((entry) => {
    const row: DatasetRow = { day: entry.day, views: entry.views }
    for (const [kind, clicks] of Object.entries(entry.clicks)) {
      const key = KNOWN_KINDS.has(kind as LinkpageClickKind) ? (kind as LinkpageClickKind) : 'other'
      row[key] = (row[key] ?? 0) + clicks
    }
    return row
  })
}

interface Props {
  byDay: LinkpageStatsDay[]
}

/**
 * Views and outbound clicks per day, stacked by visit category. Lazily loaded
 * by the tile so @mui/x-charts stays off the dashboard's critical path.
 */
export default function LinkpageStatsChart({ byDay }: Readonly<Props>) {
  const { t, i18n } = useTranslation('dashboard')
  const theme = useTheme()
  const locale = i18n.resolvedLanguage ?? 'en'

  const dataset = toDataset(byDay)
  // Day buckets are 'YYYY-MM-DD'; parse at local midnight so the label can't
  // slip a day for a viewer behind UTC.
  const dayFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const formatDay = (day: string) => {
    const parsed = new Date(`${day}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? day : dayFormat.format(parsed)
  }

  // Only days with activity come back, so the axis is dense: thin the ticks and
  // count from the end, keeping the most recent day labelled.
  const tickStep = Math.max(1, Math.ceil(dataset.length / MAX_TICKS))

  // Views are the stack's baseline; a category earns a series (and a legend
  // entry) only once it actually happened inside the window.
  const series = [
    { dataKey: 'views' as const, label: t($ => $.linkpage.category.views), color: theme.palette.text.secondary },
    ...KIND_SLOTS
      .filter(([kind]) => dataset.some((row) => row[kind]))
      .map(([kind, slot]) => ({
        dataKey: kind,
        label: t($ => $.linkpage.category[kind]),
        color: theme.palette.chart[slot],
      })),
  ]

  return (
    <BarChart
      dataset={dataset}
      height={CHART_HEIGHT}
      grid={{ horizontal: true }}
      // The right margin is the room the last date tick needs: MUI ellipsizes a
      // tick label that would cross the drawing area's edge.
      margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
      xAxis={[{
        dataKey: 'day',
        scaleType: 'band',
        valueFormatter: formatDay,
        tickInterval: (_value, index) => (dataset.length - 1 - index) % tickStep === 0,
        disableTicks: true,
      }]}
      // domainSeries: 'visible' rescales the axis when a legend toggle hides a
      // stacked category — without it the axis keeps the height of bars that
      // are no longer drawn.
      yAxis={[{ width: 32, disableLine: true, disableTicks: true, tickMinStep: 1, domainSeries: 'visible' }]}
      // Clicking a legend entry isolates that category in the stack.
      slotProps={{ legend: { toggleVisibilityOnClick: true } }}
      series={series.map((entry) => ({
        ...entry,
        stack: 'day',
        // The day's view count, printed in the baseline segment when it has
        // room. Only that one: a number per click segment would clutter the
        // stack and sit on colours it can't stay legible against — those are
        // read from the tooltip and the legend.
        barLabel: entry.dataKey === 'views'
          ? (item: BarItem, context: BarLabelContext) => (
            context.bar.width >= 22 && context.bar.height >= 16 && item.value ? String(item.value) : null
          )
          : undefined,
      }))}
      borderRadius={3}
      sx={{
        '& .MuiBarChart-label': { fontSize: 11, fill: theme.palette.background.paper },
        '& .MuiChartsAxis-tickLabel': { fontSize: 11 },
        // A hairline of the card surface between stacked segments, so two
        // touching categories never blend into one block.
        '& .MuiBarChart-element': { stroke: theme.palette.background.paper, strokeWidth: 1 },
      }}
    />
  )
}
