import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// jsdom gives the chart no layout, so the real BarChart renders nothing
// assertable. Expose the series wiring instead — which categories earned a
// series, in which order, with which colour and stack.
vi.mock('@mui/x-charts/BarChart', () => ({
  BarChart: ({ series, dataset, yAxis, slotProps }) => (
    <div
      data-testid="linkpage-bar-chart"
      data-series={JSON.stringify(series.map((s) => ({
        key: s.dataKey, label: s.label, color: s.color, stack: s.stack,
      })))}
      data-dataset={JSON.stringify(dataset)}
      data-y-domain={yAxis[0].domainSeries}
      data-legend-toggle={String(slotProps?.legend?.toggleVisibilityOnClick)}
    />
  ),
}))

vi.mock('../../promotion/linkpage/linkpage.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  getLinkpageStats: vi.fn(),
  listLinkpagePages: vi.fn(),
  createLinkpageHandoff: vi.fn(),
}))

import LinkpageStatsTile from '../dashboard/components/LinkpageStatsTile.tsx'
import { getLinkpageStats, listLinkpagePages, createLinkpageHandoff } from '../../promotion/linkpage/linkpage.ts'
import theme from '../../theme.ts'

const PAGES = [
  { id: 8, slug: 'the-band', pageType: 'main', title: null, published: true },
  { id: 9, slug: 'the-band/new-single', pageType: 'release', title: 'New Single', published: true },
]

const STATS = {
  hasPage: true,
  pageId: 8,
  slug: 'the-band',
  days: 30,
  retentionDays: 30,
  enabled: true,
  totalViews: 1240,
  uniqueVisits: 810,
  totalClicks: 186,
  clickThroughRate: 15,
  byDay: [
    { day: '2026-08-01', views: 40, clicks: { platform: 6, shop: 2 } },
    { day: '2026-08-02', views: 55, clicks: { platform: 9 } },
  ],
}

const apiError = (status) => Object.assign(new Error('nope'), { status })

const wrap = (ui) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

const chartSeries = () =>
  JSON.parse(screen.getByTestId('linkpage-bar-chart').getAttribute('data-series'))

describe('LinkpageStatsTile', () => {
  beforeEach(() => {
    getLinkpageStats.mockResolvedValue(STATS)
    // One page by default: nothing to pick between.
    listLinkpagePages.mockResolvedValue({ pages: [PAGES[0]] })
    createLinkpageHandoff.mockResolvedValue({ url: 'https://link.test/edit#gbtoken=abc' })
    vi.stubGlobal('open', vi.fn())
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows the four headline statistics for the default 30-day window', async () => {
    wrap(<LinkpageStatsTile />)

    expect(await screen.findByText('1,240')).toBeInTheDocument()
    expect(screen.getByText('Views')).toBeInTheDocument()
    expect(screen.getByText('810')).toBeInTheDocument()
    expect(screen.getByText('Est. unique visitors')).toBeInTheDocument()
    expect(screen.getByText('186')).toBeInTheDocument()
    expect(screen.getByText('Link clicks')).toBeInTheDocument()
    expect(screen.getByText('15%')).toBeInTheDocument()
    expect(screen.getByText('Click-through rate')).toBeInTheDocument()
    expect(getLinkpageStats).toHaveBeenCalledWith(30, null)
  })

  it('renders a dash rather than a rate when there were no views to divide by', async () => {
    getLinkpageStats.mockResolvedValue({ ...STATS, totalViews: 0, totalClicks: 0, clickThroughRate: null })
    wrap(<LinkpageStatsTile />)
    expect(await screen.findByText('—')).toBeInTheDocument()
  })

  it('stacks views with only the click categories that actually happened', async () => {
    wrap(<LinkpageStatsTile />)
    await screen.findByTestId('linkpage-bar-chart')

    expect(chartSeries()).toEqual([
      { key: 'views', label: 'Views', color: theme.palette.text.secondary, stack: 'day' },
      { key: 'platform', label: 'Streaming', color: theme.palette.chart.c1, stack: 'day' },
      { key: 'shop', label: 'Merch shop', color: theme.palette.chart.c7, stack: 'day' },
    ])
  })

  // Clicking a legend entry filters the stack to that category; the y-axis has
  // to rescale to what is still drawn, or hidden bars keep reserving height.
  it('lets the legend filter categories and rescales the axis to what is visible', async () => {
    wrap(<LinkpageStatsTile />)
    const chart = await screen.findByTestId('linkpage-bar-chart')

    expect(chart.getAttribute('data-legend-toggle')).toBe('true')
    expect(chart.getAttribute('data-y-domain')).toBe('visible')
  })

  // Colour follows the category, not its position: 'Merch shop' keeps slot c7
  // even when it is the only category left in the window.
  it('keeps a category on its own colour slot when the others drop out', async () => {
    getLinkpageStats.mockResolvedValue({
      ...STATS,
      byDay: [{ day: '2026-08-01', views: 40, clicks: { shop: 2 } }],
    })
    wrap(<LinkpageStatsTile />)
    await screen.findByTestId('linkpage-bar-chart')

    expect(chartSeries()).toEqual([
      { key: 'views', label: 'Views', color: theme.palette.text.secondary, stack: 'day' },
      { key: 'shop', label: 'Merch shop', color: theme.palette.chart.c7, stack: 'day' },
    ])
  })

  it('folds a click kind it does not recognize into "Other"', async () => {
    getLinkpageStats.mockResolvedValue({
      ...STATS,
      byDay: [{ day: '2026-08-01', views: 5, clicks: { newfangled: 3, other: 1 } }],
    })
    wrap(<LinkpageStatsTile />)
    await screen.findByTestId('linkpage-bar-chart')

    expect(chartSeries().map((s) => s.label)).toEqual(['Views', 'Other'])
    const dataset = JSON.parse(screen.getByTestId('linkpage-bar-chart').getAttribute('data-dataset'))
    expect(dataset).toEqual([{ day: '2026-08-01', views: 5, other: 4 }])
  })

  it('refetches when the window is switched to 7 days', async () => {
    const user = userEvent.setup()
    wrap(<LinkpageStatsTile />)
    await screen.findByTestId('linkpage-bar-chart')

    await user.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(getLinkpageStats).toHaveBeenCalledWith(7, null))
  })

  // Choosing the page is the tile's only setting, so a band with one page has
  // nothing to configure and gets no edit affordance.
  it('offers neither an edit button nor a picker for a single link page', async () => {
    wrap(<LinkpageStatsTile />)
    await screen.findByTestId('linkpage-bar-chart')
    expect(screen.queryByRole('button', { name: 'Choose page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('keeps the picker behind edit mode, and closes it again with the checkmark', async () => {
    const user = userEvent.setup()
    listLinkpagePages.mockResolvedValue({ pages: PAGES })
    wrap(<LinkpageStatsTile />)
    await screen.findByTestId('linkpage-bar-chart')

    // Resting state: the report only.
    expect(await screen.findByRole('button', { name: 'Choose page' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Choose page' }))
    expect(screen.getByRole('combobox')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('lets the member pick between pages while editing', async () => {
    const user = userEvent.setup()
    listLinkpagePages.mockResolvedValue({ pages: PAGES })
    wrap(<LinkpageStatsTile />)
    await screen.findByTestId('linkpage-bar-chart')

    await user.click(await screen.findByRole('button', { name: 'Choose page' }))
    // The main page is the resting selection, named by its slug.
    const picker = screen.getByRole('combobox')
    expect(picker).toHaveTextContent('the-band')

    await user.click(picker)
    // A release page is named by its release, not its slug.
    await user.click(await screen.findByRole('option', { name: 'New Single' }))
    await waitFor(() => expect(getLinkpageStats).toHaveBeenCalledWith(30, 9))
  })

  it('keeps the picker reachable when the selected page fails to load', async () => {
    const user = userEvent.setup()
    listLinkpagePages.mockResolvedValue({ pages: PAGES })
    getLinkpageStats.mockRejectedValue(apiError(502))
    wrap(<LinkpageStatsTile />)

    expect(await screen.findByText(/Couldn't load/)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Choose page' }))
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  // The editor can delete a page between the list read and the stats read.
  it('falls back to the main page when the selection no longer exists', async () => {
    listLinkpagePages.mockResolvedValue({ pages: PAGES })
    getLinkpageStats.mockImplementation((_days, pageId) => (
      pageId === 9 ? Promise.reject(apiError(404)) : Promise.resolve(STATS)
    ))
    const user = userEvent.setup()
    wrap(<LinkpageStatsTile />)
    await screen.findByTestId('linkpage-bar-chart')

    await user.click(await screen.findByRole('button', { name: 'Choose page' }))
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'New Single' }))

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('the-band'))
    expect(screen.getByTestId('linkpage-bar-chart')).toBeInTheDocument()
  })

  it('stays on the main page when the page list cannot be read', async () => {
    listLinkpagePages.mockRejectedValue(apiError(502))
    wrap(<LinkpageStatsTile />)

    await screen.findByTestId('linkpage-bar-chart')
    expect(screen.queryByRole('button', { name: 'Choose page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('invites the member to build a page when the tenant has none yet', async () => {
    getLinkpageStats.mockResolvedValue({ hasPage: false })
    wrap(<LinkpageStatsTile />)

    expect(await screen.findByText(/No link page yet/)).toBeInTheDocument()
    expect(screen.queryByTestId('linkpage-bar-chart')).not.toBeInTheDocument()
  })

  it('says so when the link page app has visit collection switched off', async () => {
    getLinkpageStats.mockResolvedValue({ ...STATS, enabled: false })
    wrap(<LinkpageStatsTile />)
    expect(await screen.findByText('Visit statistics are switched off')).toBeInTheDocument()
  })

  it('reports a period without any visits instead of an empty chart', async () => {
    getLinkpageStats.mockResolvedValue({ ...STATS, byDay: [] })
    wrap(<LinkpageStatsTile />)

    expect(await screen.findByText('No visits in this period')).toBeInTheDocument()
    expect(screen.queryByTestId('linkpage-bar-chart')).not.toBeInTheDocument()
  })

  it.each([503, 403])('renders nothing at all when the API answers %s', async (status) => {
    getLinkpageStats.mockRejectedValue(apiError(status))
    const { container } = wrap(<LinkpageStatsTile />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('shows the card error state when the link page app is unreachable', async () => {
    getLinkpageStats.mockRejectedValue(apiError(502))
    wrap(<LinkpageStatsTile />)
    expect(await screen.findByText(/Couldn't load/)).toBeInTheDocument()
  })

  it('opens the link page editor with a freshly minted handoff', async () => {
    const user = userEvent.setup()
    wrap(<LinkpageStatsTile />)
    await screen.findByTestId('linkpage-bar-chart')

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(window.open).toHaveBeenCalledWith(
      'https://link.test/edit#gbtoken=abc',
      '_blank',
      'noopener',
    ))
  })
})
