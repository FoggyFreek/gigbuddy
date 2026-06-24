import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/songs.ts', () => ({
  createSongChart: vi.fn(),
  deleteSongChart: vi.fn(),
}))

// Stub the heavy fullscreen viewer; assert only that it opens for the right
// chart. Deletion is the viewer's responsibility now (it owns the confirm
// dialog), so expose its onDelete callback as a plain button for the section
// test to trigger.
vi.mock('../components/ChordProViewerDialog.tsx', () => ({
  default: ({ chart, startInEdit, onDelete }) => (
    <div data-testid="viewer">
      Viewer: {chart.name} {startInEdit ? '(edit)' : '(view)'}
      {onDelete && <button onClick={onDelete}>delete chart</button>}
    </div>
  ),
}))

import ChordProChartsSection from '../components/ChordProChartsSection.tsx'
import { createSongChart, deleteSongChart } from '../api/songs.ts'
import theme from '../theme.ts'

const CHARTS = [
  { id: 1, name: 'Guitar', source: '[C]Hi' },
  { id: 2, name: 'Piano', source: '[G]Yo' },
]

function wrap(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ChordProChartsSection songId={7} initialCharts={CHARTS} {...props} />
    </ThemeProvider>,
  )
}

describe('ChordProChartsSection', () => {
  beforeEach(() => {
    vi.mocked(createSongChart).mockReset()
    vi.mocked(deleteSongChart).mockReset()
  })

  it('lists the existing charts by name', () => {
    wrap()
    expect(screen.getByText('Guitar')).toBeInTheDocument()
    expect(screen.getByText('Piano')).toBeInTheDocument()
  })

  it('opens a chart in the viewer when its card is clicked', async () => {
    const user = userEvent.setup()
    wrap()
    await user.click(screen.getByRole('button', { name: 'Open Guitar' }))
    expect(screen.getByTestId('viewer')).toHaveTextContent('Viewer: Guitar (view)')
  })

  it('creates a blank chart and opens it in edit mode', async () => {
    const user = userEvent.setup()
    createSongChart.mockResolvedValue({ id: 99, name: 'New chart', source: '' })
    wrap()

    await user.click(screen.getByRole('button', { name: /new chart/i }))

    expect(createSongChart).toHaveBeenCalledWith(7, { name: 'New chart', source: '' })
    await waitFor(() =>
      expect(screen.getByTestId('viewer')).toHaveTextContent('Viewer: New chart (edit)')
    )
  })

  it('surfaces an error when chart creation fails', async () => {
    const user = userEvent.setup()
    createSongChart.mockRejectedValue(new Error('boom'))
    wrap()

    await user.click(screen.getByRole('button', { name: /new chart/i }))

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('deletes the open chart when the viewer requests deletion', async () => {
    const user = userEvent.setup()
    deleteSongChart.mockResolvedValue(undefined)
    wrap()

    await user.click(screen.getByRole('button', { name: 'Open Guitar' }))
    await user.click(within(screen.getByTestId('viewer')).getByRole('button', { name: /^delete chart$/i }))

    await waitFor(() => expect(deleteSongChart).toHaveBeenCalledWith(7, 1))
    await waitFor(() => expect(screen.queryByText('Guitar')).not.toBeInTheDocument())
    expect(screen.getByText('Piano')).toBeInTheDocument()
  })

  it('does not pass a delete action to the viewer when read-only', async () => {
    const user = userEvent.setup()
    wrap({ canWrite: false })
    expect(screen.queryByRole('button', { name: /new chart/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Guitar' }))
    expect(within(screen.getByTestId('viewer')).queryByRole('button', { name: /^delete chart$/i })).not.toBeInTheDocument()
  })
})
