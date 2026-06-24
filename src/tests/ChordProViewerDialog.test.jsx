import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateSongChart } from '../api/songs.ts'
import { printChordPro } from '../utils/chordpro.ts'

let mockStacked = false
vi.mock('@mui/material/useMediaQuery', () => ({
  default: () => mockStacked,
}))

vi.mock('../components/chordpro/ChordProView.tsx', () => ({
  default: ({ source }) => <div>Rendered chart: {source}</div>,
}))

vi.mock('../api/songs.ts', () => ({
  updateSongChart: vi.fn(),
}))

// Keep MONO_FONT (used in editor styling) but stub the browser-print helper —
// it opens a window jsdom can't drive.
vi.mock('../utils/chordpro.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  printChordPro: vi.fn(),
}))

import ChordProViewerDialog from '../components/chordpro/ChordProViewerDialog.tsx'
import theme from '../theme.ts'

const CHART = {
  id: 10,
  name: 'Guitar',
  source: '[C]Hello',
}

function wrap(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ChordProViewerDialog
        open
        songId={1}
        chart={CHART}
        canWrite
        startInEdit
        onClose={() => {}}
        onChartChange={() => {}}
        {...props}
      />
    </ThemeProvider>,
  )
}

describe('ChordProViewerDialog', () => {
  beforeEach(() => {
    mockStacked = false
    updateSongChart.mockReset()
    updateSongChart.mockResolvedValue(CHART)
    vi.mocked(printChordPro).mockClear()
  })

  it('keeps the live preview next to the editor on wide screens', () => {
    wrap()

    expect(screen.getByLabelText(/chordpro source/i)).toBeInTheDocument()
    expect(screen.getByText('Rendered chart: [C]Hello')).toBeInTheDocument()
  })

  it('hides the edit-mode preview on compact screens until Preview is clicked', async () => {
    mockStacked = true
    const user = userEvent.setup()
    wrap()

    expect(screen.getByLabelText(/chordpro source/i)).toBeInTheDocument()
    expect(screen.queryByText('Rendered chart: [C]Hello')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^preview$/i }))

    expect(screen.getByText('Rendered chart: [C]Hello')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
  })

  it('opens the read-only chord finder without touching the chart', async () => {
    const user = userEvent.setup()
    wrap()

    expect(screen.queryByRole('group', { name: /guitar fretboard/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /toggle chord finder/i }))

    const board = screen.getByRole('group', { name: /guitar fretboard/i })
    // Use the finder to identify a chord — must not persist anything to the chart.
    await user.click(within(board).getByRole('button', { name: 'Set A string to fret 3' }))
    expect(updateSongChart).not.toHaveBeenCalled()
  })

  it('shows only seven fret columns in the compact chord finder', async () => {
    mockStacked = true
    const user = userEvent.setup()
    wrap()

    await user.click(screen.getByRole('button', { name: /toggle chord finder/i }))

    const board = screen.getByRole('group', { name: /guitar fretboard/i })
    expect(within(board).getByRole('button', { name: 'Set A string to fret 7' })).toBeInTheDocument()
    expect(within(board).queryByRole('button', { name: 'Set A string to fret 8' })).not.toBeInTheDocument()
  })

  it('auto-saves edits to the ChordPro source and propagates the result', async () => {
    const updated = { ...CHART, source: '[D]Yo' }
    updateSongChart.mockResolvedValue(updated)
    const onChartChange = vi.fn()
    wrap({ onChartChange })

    fireEvent.change(screen.getByLabelText(/chordpro source/i), { target: { value: '[D]Yo' } })

    await waitFor(
      () => expect(updateSongChart).toHaveBeenCalledWith(1, 10, { source: '[D]Yo' }),
      { timeout: 2000 }
    )
    await waitFor(() => expect(onChartChange).toHaveBeenCalledWith(updated))
  })

  it('auto-saves the chart name, trimmed', async () => {
    wrap()

    fireEvent.change(screen.getByPlaceholderText(/chart name/i), { target: { value: '  Piano  ' } })

    await waitFor(
      () => expect(updateSongChart).toHaveBeenCalledWith(1, 10, { name: 'Piano' }),
      { timeout: 2000 }
    )
  })

  it('does not save a blank chart name', async () => {
    wrap()

    fireEvent.change(screen.getByPlaceholderText(/chart name/i), { target: { value: '   ' } })
    // Let the debounce window pass; a blank name must never schedule a save.
    await new Promise((r) => setTimeout(r, 700))

    expect(updateSongChart).not.toHaveBeenCalled()
  })

  it('flushes a pending edit before closing', async () => {
    const updated = { ...CHART, source: '[E]Hey' }
    updateSongChart.mockResolvedValue(updated)
    const onClose = vi.fn()
    const user = userEvent.setup()
    wrap({ onClose })

    fireEvent.change(screen.getByLabelText(/chordpro source/i), { target: { value: '[E]Hey' } })
    // Close immediately, before the 600ms debounce would have fired: handleClose
    // flushes the pending save first, then calls onClose.
    await user.click(screen.getByRole('button', { name: /^close$/i }))

    expect(updateSongChart).toHaveBeenCalledWith(1, 10, { source: '[E]Hey' })
    expect(onClose).toHaveBeenCalled()
  })

  it('prints the rendered chart', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(screen.getByRole('button', { name: /print/i }))

    expect(printChordPro).toHaveBeenCalledWith(expect.anything(), '[C]Hello', 'Guitar')
  })

  it('deletes the chart after confirming, then closes', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const user = userEvent.setup()
    wrap({ onDelete, onClose })

    await user.click(screen.getByRole('button', { name: /delete chart/i }))
    const confirm = screen.getByRole('dialog', { name: /delete chart\?/i })
    await user.click(within(confirm).getByRole('button', { name: /^delete$/i }))

    expect(onDelete).toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('cancels deletion without calling onDelete', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    wrap({ onDelete })

    await user.click(screen.getByRole('button', { name: /delete chart/i }))
    const confirm = screen.getByRole('dialog', { name: /delete chart\?/i })
    await user.click(within(confirm).getByRole('button', { name: /cancel/i }))

    expect(onDelete).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /delete chart\?/i })).not.toBeInTheDocument()
    )
  })

  it('shows no delete affordance when onDelete is not provided', () => {
    wrap()
    expect(screen.queryByRole('button', { name: /delete chart/i })).not.toBeInTheDocument()
  })

  it('omits the Edit button and starts in view mode for readers', () => {
    wrap({ canWrite: false, startInEdit: true })

    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/chordpro source/i)).not.toBeInTheDocument()
    expect(screen.getByText('Rendered chart: [C]Hello')).toBeInTheDocument()
  })

  it('transposes the preview up and resets back to zero', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(screen.getByRole('button', { name: /transpose up/i }))
    expect(screen.getByRole('button', { name: /transpose 1 semitones, reset/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /transpose 1 semitones, reset/i }))
    expect(screen.getByRole('button', { name: /transpose 0 semitones/i })).toBeInTheDocument()
  })
})
